/**
 * Chrome and controls: the parts of the interface that are easy to break
 * without noticing, because they only show up under a pointer.
 *
 * Run: npm run build && npm run test:ui
 *
 * Each case here is a bug that shipped:
 *
 *   - the search hint read ⌘K on every platform, telling Windows and Linux
 *     operators to press a key their keyboard does not have;
 *   - the File menu was drawn *under* the icon rail, because a z-index
 *     inside the menu bar's own stacking context cannot outrank one in the
 *     root;
 *   - the filter dropdowns were native <select>s, so the open list was the
 *     operating system's widget — light text on light on a dark interface;
 *   - Help → Keyboard shortcuts was greyed out everywhere except the Graph
 *     Explorer, which was the only view that registered the command;
 *   - the timeline tooltip was drawn past the bottom of its own panel and
 *     clipped, and its hover band covered the bars either side of the one
 *     it described.
 *
 * Needs a Chromium: `npx playwright install chromium`, or set
 * CHROMIUM_EXECUTABLE to one already on the machine.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from './support/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = 8901;
const BASE = `http://127.0.0.1:${PORT}`;

const LAUNCH = process.env.CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
  : {};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const failures = [];
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

const server = createServer({ dist: DIST, snapshotPath: join(ROOT, 'src/demo/snapshot.json') });
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ args: ['--no-sandbox'], ...LAUNCH });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.rail', { timeout: 20000 });
  await page.waitForTimeout(2500);

  // ── The accelerator is named for the platform running it ──────────
  const hint = (await page.locator('.titlebar-search kbd').textContent())?.trim();
  const expected = process.platform === 'darwin' ? '⌘K' : 'Ctrl+K';
  check(hint === expected, 'the search hint names this platform\'s modifier', `${hint} on ${process.platform}`);

  // ── A menu is drawn above the rail, not under it ──────────────────
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const surface = document.querySelector('.menu-surface');
    const rail = document.querySelector('.rail');
    if (!surface || !rail) return { error: 'menu or rail missing' };
    const m = surface.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    const overlapping = m.left < r.right && m.right > r.left && m.top < r.bottom && m.bottom > r.top;
    // A point inside both: whatever is on top there is the winner.
    const x = Math.min(m.left + 8, r.right - 2);
    const top = document.elementFromPoint(x, m.top + 20);
    return {
      portalled: surface.parentElement === document.body,
      overlapping,
      menuOnTop: surface.contains(top),
    };
  });
  check(menu.portalled, 'the menu surface is portalled out of the menu bar');
  check(!menu.overlapping || menu.menuOnTop, 'the menu paints above the icon rail',
    menu.overlapping ? 'they overlap and the menu wins' : 'no overlap at this size');
  await page.keyboard.press('Escape');

  // ── Help → Keyboard shortcuts, from a view that is not the graph ──
  await page.goto(`${BASE}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.waitForTimeout(300);
  const item = page.getByRole('button', { name: /Keyboard shortcuts/ });
  check(!(await item.isDisabled()), 'Help → Keyboard shortcuts is enabled off the graph page');
  await item.click();
  await page.waitForTimeout(400);
  check(await page.locator('.modal').count() === 1, 'the shortcuts dialog opens');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.locator('.modal').count() === 0, 'the shortcuts dialog closes on Escape');
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(400);
  check(await page.locator('.modal').count() === 1, '"?" opens the shortcuts dialog');
  await page.keyboard.press('Escape');

  // ── Dropdowns are the app's own, on every view that has one ───────
  let nativeTotal = 0;
  let customTotal = 0;
  for (const route of ['/alerts', '/wallets', '/transactions', '/graph']) {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(route === '/graph' ? 5000 : 2200);
    nativeTotal += await page.locator('select').count();
    customTotal += await page.locator('.select-trigger').count();
  }
  check(nativeTotal === 0, 'no native <select> is left in the filter panels', `${nativeTotal} found`);
  check(customTotal >= 5, 'the custom dropdown is in use', `${customTotal} controls`);

  // It has to work, not just look right.
  await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const scriptType = page.locator('.select-trigger').nth(1);
  await scriptType.click();
  await page.waitForTimeout(300);
  check(await page.locator('.select-option').count() > 1, 'the dropdown opens its options');
  await page.getByRole('option', { name: 'P2TR' }).click();
  await page.waitForTimeout(1200);
  check((await scriptType.textContent()).includes('P2TR'), 'choosing an option updates the control',
    (await scriptType.textContent()).trim());

  // The keyboard has to reach it too.
  const sortBy = page.locator('.select-trigger').nth(0);
  await sortBy.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  check(await page.locator('.select-option').count() > 1, 'ArrowDown opens the dropdown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check(await page.locator('.select-option').count() === 0, 'Enter picks an option and closes it');

  // ── The timeline tooltip stays inside its own panel ───────────────
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const box = await page.locator('canvas').first().boundingBox();
  let escaped = 0;
  let seen = 0;
  for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.85], [0.96, 0.5], [0.96, 0.85], [0.96, 0.15]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(400);
    const rect = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.echarts-for-react div')]
        .find((d) => /Transactions/.test(d.textContent || '') && d.style.position);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    });
    if (!rect) continue;
    seen += 1;
    const inside = rect.x >= box.x - 1 && rect.y >= box.y - 1
      && rect.right <= box.x + box.width + 1 && rect.bottom <= box.y + box.height + 1;
    if (!inside) escaped += 1;
  }
  check(seen > 0 && escaped === 0, 'the chart tooltip never leaves the chart',
    `${seen} positions, ${escaped} escaped`);

  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
}

console.log(failures.length
  ? `\n${failures.length} FAILURES:\n  - ${failures.join('\n  - ')}`
  : '\nAll UI checks passed.');
process.exit(failures.length ? 1 : 0);
