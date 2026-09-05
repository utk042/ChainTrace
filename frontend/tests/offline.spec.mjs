/**
 * Acceptance test for the offline-first promise.
 *
 * Run: npm run build && npm run test:offline    (against the bundled snapshot)
 *      npm run test:offline -- --backend http://127.0.0.1:8000
 *
 * Needs a Chromium for Playwright: `npx playwright install chromium` once,
 * or set CHROMIUM_EXECUTABLE to one that is already on the machine (CI
 * images and this repo's dev containers usually ship one).
 *
 * The scenario is one long sequence — install the worker, warm the cache,
 * lose the network, come back — so it is a script with an assertion helper
 * rather than a suite of independent cases. Splitting it into isolated tests
 * would mean re-installing a service worker per case for no extra coverage.
 *
 * The server is KILLED to simulate being offline. Playwright's
 * context.setOffline() only cuts the page's own network, not fetches the
 * service worker makes on its behalf: with the server still up, an
 * "offline" page keeps receiving live data and the test passes without
 * proving anything. That mistake is easy to repeat, hence this paragraph.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from './support/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SNAPSHOT = join(ROOT, 'src/demo/snapshot.json');
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = ['/', '/alerts', '/wallets', '/graph', '/transactions', '/ingest', '/settings'];

const backendFlag = process.argv.indexOf('--backend');
const BACKEND = backendFlag === -1 ? null : process.argv[backendFlag + 1];

// Playwright insists on the exact browser build its version shipped with.
// An image that already has a working Chromium should be able to say so
// rather than downloading a second copy of it.
const LAUNCH = process.env.CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
  : {};

if (!existsSync(join(DIST, 'sw.js'))) {
  console.error('dist/sw.js not found — run `npm run build` first.');
  process.exit(1);
}

const failures = [];
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

const listen = (server) => new Promise((resolve) => server.listen(PORT, resolve));

async function startServer() {
  const server = createServer({ dist: DIST, snapshotPath: SNAPSHOT, backend: BACKEND });
  await listen(server);
  return server;
}

const stopServer = (server) => new Promise((resolve) => {
  // Destroy live sockets too: a keep-alive connection would otherwise let the
  // browser keep talking to a server we are trying to make unreachable.
  server.closeAllConnections?.();
  server.close(resolve);
});

/** The shell is up and the route produced page-level content. */
async function rendered(page) {
  const shell = await page.locator('.rail').count();
  const content = await page.locator('.page, .graph-page, canvas').count();
  return shell === 1 && content >= 1;
}

let server = await startServer();
const browser = await chromium.launch({ args: ['--no-sandbox'], ...LAUNCH });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors = [];
// "Failed to load resource" is the browser reporting a request that got no
// answer, which is what being offline *is* — the test drives reads that are
// not stored verbatim on purpose, so those lines are the expected path, not a
// fault. Anything the app itself logs or throws still counts.
const isExpectedOffline = (text) => /Failed to load resource/i.test(text);
page.on('console', (m) => {
  if (m.type() === 'error' && !isExpectedOffline(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

try {
  // ── Online ────────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.rail', { timeout: 20000 });
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(route === '/graph' ? 3500 : 700);
    check(await rendered(page), `online ${route} renders`);
  }

  // ── The worker installs and precaches the shell ───────────────────
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 80 && !navigator.serviceWorker.controller; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return Boolean(navigator.serviceWorker.controller);
  });
  check(controlled, 'service worker controls the page');

  const shellEntries = await page.evaluate(async () => {
    const name = (await caches.keys()).find((n) => n.startsWith('ct-shell-'));
    return name ? (await (await caches.open(name)).keys()).length : 0;
  });
  check(shellEntries >= 20, 'app shell is precached', `${shellEntries} entries`);

  // ── Warm the API cache through the Settings control ───────────────
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Offline & data/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Save for offline/i }).click();
  await page.waitForTimeout(6000);
  const stored = await page.locator('.notice')
    .filter({ hasText: /Stored \d+/ }).first().textContent().catch(() => null);
  check(/Stored \d+ datasets for offline/.test(stored || ''), 'save-for-offline stores datasets', stored?.trim());

  // ── Cut the machine off ───────────────────────────────────────────
  await stopServer(server);
  server = null;
  await context.setOffline(true);
  errors.length = 0;

  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(route === '/graph' ? 4000 : 1800);
    check(await rendered(page), `OFFLINE ${route} renders`);
  }

  // A view the app never requested while online. The worker keys stored
  // responses by their exact URL, so paging, sorting or filtering offline used
  // to miss the cache and render "no stored copy of this query is available"
  // on a device that was holding every row involved. These now come out of
  // the stored table, re-cut locally.
  await page.goto(`${BASE}/wallets`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  const firstPage = await page.locator('tbody tr').count();
  check(firstPage > 0, 'OFFLINE wallets table has rows', `${firstPage} rows`);

  await page.getByRole('button', { name: /Next/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);
  const secondPage = await page.locator('tbody tr').count();
  const pageLabel = await page.locator('.page-info').first().textContent().catch(() => '');
  check(secondPage > 0 && /Page 2/.test(pageLabel || ''),
    'OFFLINE page 2 is served from stored rows', `${secondPage} rows, ${pageLabel?.trim()}`);

  await page.getByRole('button', { name: /^Critical$/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);
  const filtered = await page.locator('tbody tr').count();
  const failedPanel = await page.locator('.notice-error, .failed').count().catch(() => 0);
  check(filtered > 0 && failedPanel === 0,
    'OFFLINE filtering re-runs against stored rows', `${filtered} rows`);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3200);

  // Stored data must never read as live.
  const banner = await page.locator('.conn-banner-offline').textContent().catch(() => null);
  check(/stored results/i.test(banner || ''), 'banner labels the data as stored',
    banner?.replace(/\s+/g, ' ').trim().slice(0, 90));
  const pill = await page.locator('.statusbar-group').first().textContent().catch(() => null);
  check(/OFFLINE/.test(pill || ''), 'status bar reports offline', pill?.trim());

  const kpi = await page.locator('.stat-value').first().textContent().catch(() => null);
  check(kpi && !['0', '—', '-'].includes(kpi.trim()), 'dashboard shows stored figures', kpi?.trim());

  await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(5000);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check(canvases > 0, 'graph canvas renders offline', `${canvases} canvases`);

  check(errors.length === 0, 'no console errors while offline', errors.slice(0, 3).join(' | '));

  // ── Reconnect ─────────────────────────────────────────────────────
  await context.setOffline(false);
  server = await startServer();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3200);
  check(await page.locator('.conn-banner').count() === 0, 'banner clears when the backend answers');
  check(/CONNECTED/.test(await page.locator('.statusbar-group').first().textContent().catch(() => '')),
    'status bar returns to connected');
} finally {
  await browser.close();
  if (server) await stopServer(server);
}

console.log(failures.length
  ? `\n${failures.length} FAILURES:\n  - ${failures.join('\n  - ')}`
  : '\nAll offline checks passed.');
process.exit(failures.length ? 1 : 0);
