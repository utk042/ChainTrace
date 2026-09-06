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
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from './support/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = 8901;
const BASE = `http://127.0.0.1:${PORT}`;

/** The snapshot's most-connected entity: certain to be drawn, and centred by ?q=. */
const GRAPH_PROBE_NODE = JSON.parse(
  readFileSync(join(ROOT, 'src/demo/snapshot.json'), 'utf8'),
).graph.nodes.reduce((best, n) => (
  (n.metadata?.degree || 0) > (best.metadata?.degree || 0) ? n : best
)).id;

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

// What /api/ingest/status answers, changed from inside the test so the app
// sees a run start and finish under it.
const pipeline = { current: { status: 'completed', progress: 100, message: 'Idle.' } };

// A tiny hand-made entity graph, served when the app asks for the collapsed
// view. The bundled snapshot predates entities — it still carries co_input
// edges — so the grouped view has to be stubbed to be exercised at all.
const ENTITY_ID = 'entity:bc1qtestactor0000000000000000000001';
const ENTITY_MEMBERS = Array.from(
  { length: 12 }, (_, i) => `bc1qtestactor${String(i).padStart(20, '0')}`,
);

const entityGraph = {
  ready: true,
  grouped: 'entity',
  entity_summary: { addresses: 20, entities: 9, multi_address_entities: 1, largest_entity: 12 },
  nodes: [
    {
      id: ENTITY_ID, label: 'bc1qtest…000001 +11', node_type: 'entity',
      x: 0, y: 0, size: 12, color: '#2d9d78', risk_tier: 'High', anomaly_score: 81,
      metadata: { degree: 2, entity_size: 12 },
    },
    {
      id: 'txstub0000000000000000000000000000000001', label: 'txstub…000001',
      node_type: 'transaction', x: 120, y: 40, size: 4, color: '#8f99a8',
      metadata: { degree: 2 },
    },
    {
      id: 'bc1qlonewallet00000000000000000000000001', label: 'bc1qlone…000001',
      node_type: 'wallet', x: -110, y: 60, size: 5, color: '#4c90f0',
      metadata: { degree: 1 },
    },
  ],
  edges: [
    {
      id: 'ee0', source: ENTITY_ID, target: 'txstub0000000000000000000000000000000001',
      edge_type: 'wallet_input', weight: 1, color: '#3A6E7A',
      metadata: { amount: 3.5, directed: true },
    },
    {
      id: 'ee1', source: 'txstub0000000000000000000000000000000001',
      target: 'bc1qlonewallet00000000000000000000000001',
      edge_type: 'wallet_output', weight: 1, color: '#3A6E55',
      metadata: { amount: 3.4, directed: true },
    },
  ],
  clusters: {},
  stats: {
    total_nodes: 3, total_edges: 2, wallet_count: 1, entity_count: 1,
    ip_count: 0, tx_count: 1, cluster_count: 0, truncated: false,
  },
};

const entityDetail = {
  found: true, id: ENTITY_ID, node_type: 'entity', degree: 1,
  entity_size: 12, members: ENTITY_MEMBERS, members_truncated: false,
  cospend_witnesses: ['txstub0000000000000000000000000000000001'],
  risk_tier: 'High', anomaly_score: 81, cluster_id: 3,
  neighbor_types: { transaction: 1 }, counterparties: [], alerts: [],
  member_scores: ENTITY_MEMBERS.slice(0, 4).map((address, i) => ({
    address, anomaly_score: 81 - i * 7, risk_tier: i ? 'Elevated' : 'High',
  })),
  features: {
    address_count: 12, tx_count: 30, total_received: 4.2, total_sent: 3.5,
    worst_address: ENTITY_MEMBERS[0], risk_tier: 'High', anomaly_score: 81,
  },
  summary: {
    what_it_is: ['This is one actor holding 12 addresses, grouped by the '
      + 'common-input-ownership heuristic.'],
    why_flagged: [], caveat: 'It describes behaviour, not intent.',
  },
  attributes: {},
};

const server = createServer({
  dist: DIST,
  snapshotPath: join(ROOT, 'src/demo/snapshot.json'),
  overrides: {
    '/api/ingest/status': () => pipeline.current,
    // Only the collapsed view is stubbed; the address view still comes from
    // the snapshot, so the two are genuinely different graphs here.
    '/api/graph/data': (params) => (params.get('group') === 'entity' ? entityGraph : undefined),
    [`/api/graph/node/${ENTITY_ID}`]: () => entityDetail,
  },
});
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

  // ── The Graph Explorer's new controls ─────────────────────────────
  // Opened on a specific entity, so the canvas centres it and the pointer
  // has a node to find rather than a sampled guess.
  await page.goto(`${BASE}/graph?q=${encodeURIComponent(GRAPH_PROBE_NODE)}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // Located by its label, not its position: the toolbar has gained controls
  // before, and an index quietly starts testing whichever dropdown moved into
  // the slot instead.
  const shape = page.locator('.select-trigger[aria-label="Node shape"]');
  await shape.click();
  await page.waitForTimeout(300);
  const shapes = (await page.locator('.select-option').allTextContents()).map((t) => t.trim());
  check(shapes.length === 3 && shapes.includes('Plain dot'),
    'the node shape control offers every registered program', shapes.join(', '));
  await page.getByRole('option', { name: 'Plain dot' }).click();
  await page.waitForTimeout(1500);
  check((await shape.textContent()).includes('Plain dot'), 'choosing a node shape applies it');
  check(await page.evaluate(() => document.querySelectorAll('canvas').length) > 0,
    'the canvas survives a shape change');

  // Right-clicking a node opens the app's menu, not the browser's.
  const canvasBox = await page.locator('canvas').first().boundingBox();
  let opened = false;
  // The selected node is centred, so the centre is the reliable target; the
  // rest are a small hedge against the camera settling a pixel or two off.
  for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.49], [0.49, 0.5], [0.51, 0.51]]) {
    await page.mouse.move(canvasBox.x + canvasBox.width * fx, canvasBox.y + canvasBox.height * fy);
    await page.waitForTimeout(300);
    await page.mouse.click(canvasBox.x + canvasBox.width * fx, canvasBox.y + canvasBox.height * fy,
      { button: 'right' });
    await page.waitForTimeout(500);
    if (await page.locator('.node-context-menu').count()) { opened = true; break; }
    await page.keyboard.press('Escape');
  }
  if (opened) {
    const items = await page.locator('.node-context-menu .menu-item-label').allTextContents();
    check(items.length >= 5 && items.some((i) => /note/i.test(i)),
      'right-click offers the node actions, including notes', items.join(', '));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(await page.locator('.node-context-menu').count() === 0,
      'the context menu closes on Escape');
  } else {
    check(false, 'right-click opens the node menu', 'no node found at the centred selection');
  }

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

  // ── Co-spending addresses can be drawn as the actor they are ─────
  //
  // The co-input heuristic used to be stored as an edge between every pair of
  // co-spending addresses, so one 224-input consolidation put 24,976 links on
  // the canvas and a 500-transaction pull from the live chain was an
  // unreadable mat. It is a partition now, and this is the view that uses it.
  await page.goto(`${BASE}/graph`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(3000);

  check(!/Entity/.test(await page.locator('.graph-footer').innerText()),
    'the entity legend row is hidden while addresses are drawn');

  const grouping = page.locator('.select-trigger[aria-label="Grouping"]');
  check(await grouping.count() === 1, 'the toolbar offers a grouping control');
  await grouping.click();
  await page.waitForTimeout(300);
  const groupings = (await page.locator('.select-option').allTextContents()).map((t) => t.trim());
  check(groupings.includes('Addresses') && groupings.includes('Entities'),
    'both groupings are offered', groupings.join(', '));
  await page.getByRole('option', { name: 'Entities' }).click();

  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.histogram-row, .hist-row')]
      .map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return rows.some((r) => /^Entity [1-9]/.test(r));
  }, null, { timeout: 30000 });
  check(true, 'switching to entities loads the collapsed graph');
  check(/Entity/.test(await page.locator('.graph-footer').innerText()),
    'the entity legend row appears with it');
  check(await page.evaluate(() => document.querySelectorAll('canvas').length) > 0,
    'the canvas survives the switch');

  // Opening an actor: what it holds, and what the grouping rests on.
  await page.goto(`${BASE}/graph?q=${encodeURIComponent(ENTITY_ID)}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const inspector = await page.locator('.inspector').innerText().catch(() => '');
  check(/Entity · 12 addresses/.test(inspector), 'the inspector names the actor and its size');
  check(/Member addresses/.test(inspector), 'it lists the addresses the actor holds');
  check(/Grouped by/.test(inspector), 'it names the transaction the grouping rests on');
  check(!/entity:/.test(inspector),
    'the internal handle is never shown — it means nothing outside this process');
  check(/common-input-ownership/.test(inspector),
    'the summary calls the grouping a heuristic rather than asserting ownership');

  // ── A link layer can be switched off ─────────────────────────────
  //
  // The snapshot predates entities and still carries co_input edges, which is
  // exactly the case the filter exists for.
  await page.goto(`${BASE}/graph`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Filters/i }).first().click();
  await page.waitForTimeout(500);
  const panel = await page.locator('.graph-float').innerText();
  check(/link types/i.test(panel), 'the filter panel offers link types');
  for (const layer of ['Payments', 'IP observations', 'Co-spend links']) {
    check(panel.includes(layer), `"${layer}" is separately switchable`);
  }
  const drawnBefore = await page.evaluate(() =>
    Number((document.body.innerText.match(/Edges drawn\s+([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0));
  await page.locator('.graph-float label', { hasText: 'Co-spend links' }).locator('input').click();
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.querySelectorAll('canvas').length) > 0,
    'hiding a link layer does not tear down the canvas', `${drawnBefore} edges before`);
  await page.keyboard.press('Escape');

  // ── Reloading the graph does not flash the canvas ────────────────
  //
  // The loading panel used to be opaque and immediate, so every reload of the
  // graph — a re-layout, a reset, an exit from isolation — blanked a drawn
  // canvas for the length of one request. Over a graph that is already there
  // it now waits, and comes up translucent.
  await page.goto(`${BASE}/graph`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__overlays = { opaque: 0, soft: 0, canvasRemoved: 0 };
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.removedNodes) {
          if (n.nodeName === 'CANVAS') window.__overlays.canvasRemoved += 1;
        }
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1 || !n.classList?.contains('graph-overlay')) continue;
          if (n.classList.contains('graph-overlay-soft')) window.__overlays.soft += 1;
          else window.__overlays.opaque += 1;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: /^Reset$/ }).click();
  await page.waitForTimeout(3000);
  // Hovering and selecting must not rebuild the graph either — that resets the
  // camera, which is the same flash by another route.
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(420 + i * 14, 300 + (i % 9) * 11);
    await page.waitForTimeout(60);
  }
  const overlays = await page.evaluate(() => window.__overlays);
  check(overlays.opaque === 0, 'reloading a drawn graph never blanks the canvas',
    JSON.stringify(overlays));
  check(overlays.canvasRemoved === 0, 'the canvas survives a reload and a hover',
    JSON.stringify(overlays));

  // ── The data views are held back while the pipeline runs ─────────
  //
  // The pipeline clears every table before it refills them, so a wallet list,
  // an alert queue or a graph drawn during a run belongs to no dataset that
  // ever existed. These used to keep polling and drawing straight through one.
  pipeline.current = {
    status: 'running',
    progress: 40,
    run_id: 'RUN-TEST0001',
    stage: 'load',
    message: 'Loading into database...',
    stages: [
      { key: 'clear', label: 'Clear existing data', status: 'done' },
      { key: 'parse', label: 'Parse data file', status: 'done' },
      { key: 'load', label: 'Load into DuckDB', status: 'running' },
      { key: 'analyse', label: 'Run ML analysis', status: 'pending' },
    ],
  };

  await page.goto(`${BASE}/wallets`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ingest-gate', { timeout: 20000 });
  check(true, 'a data view is held back while a run is on');
  check(await page.locator('tbody tr').count() === 0,
    'no rows from the old dataset are painted first');
  check(/Loading into database/.test(await page.locator('.ingest-gate').innerText()),
    'the gate says where the run has got to');

  for (const [path, label] of [['/', 'Overview'], ['/alerts', 'Alerts'],
    ['/transactions', 'Transactions'], ['/graph', 'Graph']]) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    check(await page.locator('.ingest-gate').count() > 0, `${label} is held back too`);
  }

  // Ingest itself stays open — it is where the run is — but takes no more data.
  await page.goto(`${BASE}/ingest`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  check(await page.locator('.ingest-gate').count() === 0, 'Ingest stays open during a run');
  check(await page.locator('.dropzone.disabled').count() > 0,
    'the dropzone refuses files during a run');
  check(await page.locator('input[type=file]').isDisabled(),
    'the file picker is disabled during a run');
  check(await page.getByRole('button', { name: /Upload file/i }).isDisabled(),
    'Upload is disabled during a run');
  check(await page.getByRole('button', { name: /Generate sample/i }).isDisabled(),
    'Generate sample is disabled during a run');

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  check(await page.locator('.ingest-gate').count() === 0,
    'Settings stays open during a run — it reads nothing from the dataset');

  // ── And they come back, with the new data, when it finishes ──────
  await page.goto(`${BASE}/wallets`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ingest-gate', { timeout: 20000 });
  pipeline.current = { status: 'completed', progress: 100, message: 'Pipeline complete.' };
  await page.waitForFunction(() => document.querySelector('.ingest-gate') === null,
    null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  check(await page.locator('tbody tr').count() > 0,
    'the view loads the dataset once the run finishes',
    `${await page.locator('tbody tr').count()} rows`);

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
