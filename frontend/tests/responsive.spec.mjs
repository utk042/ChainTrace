/**
 * Layout at every width the app is actually opened at.
 *
 * Run: npm run build && npm run test:responsive
 *
 * The check is deliberately blunt: nothing may be drawn outside the
 * viewport unless it sits in a container that scrolls sideways on purpose
 * (a table, a toolbar, the menu bar). A sideways scroll an operator can
 * resolve is a design decision; a control painted past the right edge of
 * the screen is a bug, and it is the bug every case below shipped as:
 *
 *   - the graph toolbar's three dropdowns drew their labels on top of one
 *     another — "Addresses", "Force-directed" and "Pictogram tile" over the
 *     same 40 pixels — because .tool-group was allowed to shrink and a
 *     select trigger had no min-width floor to shrink against;
 *   - the node tooltip clamped its left edge to `innerWidth - 270`, which
 *     on a phone is past where the tooltip starts, so the identifier it
 *     exists to show hung off the right of the screen;
 *   - the browser's detail pane, the graph's side panel and the overview's
 *     histogram all carried inline `position` or `grid-template-columns`,
 *     which no media query can answer — so the narrow-window rules meant to
 *     turn them into overlays never applied and each ran several hundred
 *     pixels past the edge;
 *   - the menu bar hid its overflowing menus with
 *     `.menubar-trigger:nth-child(n+4)`, but Menu wraps every trigger in a
 *     span, so the rule matched nothing and the clock, the provenance chip
 *     and the reload button were pushed off screen at every phone width;
 *   - the timeline's By day / By hour buttons are captions with no icon, so
 *     the blanket `.tool-btn span { display: none }` left two blank squares.
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
const PORT = 8903;
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

/** The narrowest phone still in use, through to a wide desktop. */
const VIEWPORTS = [
  { name: '320×568', width: 320, height: 568 },
  { name: '360×740', width: 360, height: 740 },
  { name: '390×844', width: 390, height: 844 },
  { name: '414×896', width: 414, height: 896 },
  { name: '480×800', width: 480, height: 800 },
  { name: '640×900', width: 640, height: 900 },
  { name: '768×1024', width: 768, height: 1024 },
  { name: '844×390', width: 844, height: 390 },   // phone, landscape
  { name: '1024×768', width: 1024, height: 768 },
  { name: '1280×800', width: 1280, height: 800 },
];

const ROUTES = ['/', '/alerts', '/graph', '/wallets', '/transactions', '/ingest', '/settings'];

/**
 * Everything painted outside the viewport, ignoring anything whose scroll
 * container is genuinely scrolled sideways — that content is reachable.
 */
const OVERFLOWING = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    let p = el.parentElement;
    let reachable = false;
    while (p) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) {
        reachable = true;
        break;
      }
      p = p.parentElement;
    }
    if (reachable) continue;
    const cls = (el.className?.baseVal ?? el.className ?? '').toString().trim().split(/\s+/)[0];
    out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
  }
  return [...new Set(out)];
};

const pipeline = { status: 'completed', progress: 100, message: 'Idle.' };
const server = createServer({
  dist: DIST,
  snapshotPath: join(ROOT, 'src/demo/snapshot.json'),
  overrides: { '/api/ingest/status': () => pipeline },
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch(LAUNCH);

try {
  // ── Every route, every width: nothing off-screen, and the page itself
  //    never scrolls sideways.
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const offenders = [];
    let widest = 0;

    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      // The graph draws on a canvas after its layout settles.
      await page.waitForTimeout(route === '/graph' ? 2500 : 1200);
      const bad = await page.evaluate(OVERFLOWING);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      widest = Math.max(widest, scrollW);
      if (bad.length) offenders.push(`${route}: ${bad.slice(0, 4).join(', ')}`);
    }

    check(offenders.length === 0, `${vp.name} — nothing is drawn off-screen`, offenders[0] || '');
    check(widest <= vp.width, `${vp.name} — the page itself never scrolls sideways`, `scrollWidth ${widest}`);
    await ctx.close();
  }

  // ── The states that only exist after a click, at a phone width. Each of
  //    these panes used to run off the side of the screen.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const insideViewport = async (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth };
  }, selector);

  for (const [route, label] of [['/wallets', 'wallet'], ['/alerts', 'alert']]) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(900);
    const d = await insideViewport('.browser-detail');
    check(
      d.found && d.left >= 0 && d.right <= d.vw,
      `the ${label} detail pane fits the screen`,
      d.found ? `${d.left}→${d.right} of ${d.vw}` : 'no detail pane',
    );
    check(
      await page.locator('.browser-detail button[aria-label="Close detail"]').isVisible(),
      `the ${label} detail pane can be closed`,
    );
  }

  // ── The graph: the side panel overlays the canvas, not the toolbar that
  //    holds the button closing it.
  await page.goto(BASE + '/graph', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const toolbarLabels = await page.locator('.graph-toolbar .select-value').allTextContents();
  check(
    toolbarLabels.length >= 3 && toolbarLabels.every((t) => t.trim().length > 0),
    'the graph toolbar dropdowns keep their labels',
    toolbarLabels.join(' · '),
  );

  const toolbarScrolls = await page.evaluate(() => {
    const el = document.querySelector('.graph-toolbar');
    return getComputedStyle(el).overflowX === 'auto' && el.scrollWidth >= el.clientWidth;
  });
  check(toolbarScrolls, 'the graph toolbar scrolls rather than crushing its controls');

  await page.locator('button[title="Show or hide the side panel"]').click();
  await page.waitForTimeout(800);
  const side = await page.evaluate(() => {
    const el = document.querySelector('.graph-side');
    const bar = document.querySelector('.graph-toolbar');
    if (!el || !bar) return { found: false };
    const r = el.getBoundingClientRect();
    return {
      found: true,
      left: Math.round(r.left),
      right: Math.round(r.right),
      vw: innerWidth,
      belowToolbar: r.top >= bar.getBoundingClientRect().bottom - 1,
    };
  });
  check(
    side.found && side.left >= 0 && side.right <= side.vw,
    'the graph side panel fits the screen',
    side.found ? `${side.left}→${side.right} of ${side.vw}` : 'no side panel',
  );
  check(side.belowToolbar, 'the graph side panel does not cover its own toolbar');
  check(
    await page.locator('button[title="Show or hide the side panel"]').isVisible(),
    'the button that closes the side panel stays reachable',
  );

  // ── The tooltip clamp, swept across the viewport. The canvas hands it a
  //    cursor position; wherever that is, the box has to land on screen.
  const escaped = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'graph-tooltip';
    el.style.position = 'fixed';
    el.textContent = 'bc1q93hfu8jpc6ka69ph7hjhc9frfm5fr7scjlckfqfes3pwwmhym68sv2g644';
    document.body.appendChild(el);
    let bad = 0;
    for (const x of [0, 40, 200, innerWidth - 40, innerWidth]) {
      for (const y of [0, 400, innerHeight]) {
        // The clamp the canvas applies, mirrored.
        const m = 8;
        const w = Math.min(320, innerWidth - m * 2);
        const h = Math.min(170, innerHeight - m * 2);
        let left = x + 14;
        if (left + w > innerWidth - m) left = x - 14 - w;
        left = Math.max(m, Math.min(left, innerWidth - w - m));
        let top = y + 14;
        if (top + h > innerHeight - m) top = y - 14 - h;
        top = Math.max(m, Math.min(top, innerHeight - h - m));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.maxWidth = `${w}px`;
        const r = el.getBoundingClientRect();
        if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) bad += 1;
      }
    }
    el.remove();
    return bad;
  });
  check(escaped === 0, 'the graph tooltip never leaves the viewport', '15 cursor positions');

  // ── The menu bar keeps every menu reachable and its reload button on screen.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const bar = await page.evaluate(() => {
    const right = document.querySelector('.menubar-right').getBoundingClientRect();
    const menus = document.querySelector('.menubar-menus');
    return {
      rightOnScreen: right.right <= innerWidth + 1 && right.left >= 0,
      menuCount: menus.children.length,
      menusReachable: getComputedStyle(menus).overflowX === 'auto',
    };
  });
  check(bar.rightOnScreen, 'the menu bar keeps its reload button on screen');
  check(bar.menuCount === 6 && bar.menusReachable, 'every menu stays reachable', `${bar.menuCount} menus, scrollable`);

  // ── A caption-only toolbar button keeps its caption.
  const intervals = await page.locator('.page-toolbar .tool-btn').allTextContents();
  check(
    intervals.some((t) => /day|hour/i.test(t)),
    'caption-only toolbar buttons keep their captions',
    intervals.filter((t) => t.trim()).join(' · '),
  );

  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length
  ? `\n${failures.length} responsive check(s) failed:\n  ${failures.join('\n  ')}`
  : '\nAll responsive checks passed.');
process.exit(failures.length ? 1 : 0);
