// High-quality take: headed Chromium on Xvfb :99 at 2560x1440 (1600x900 CSS
// at 1.6x), captured with ffmpeg x11grab using wall-clock timestamps. Every
// action is logged as an epoch time so the edit can warp the footage onto
// the narration.
import { chromium } from '/home/user/ChainTrace/frontend/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
const D = '/tmp/claude-0/-home-user-ChainTrace/90241886-fc26-53e4-b44f-427ab377937d/scratchpad/hq/';
fs.mkdirSync(D, { recursive: true });
const W = 'bc1qc662a6c4236057c60aec7ac74786', T = 'bc1q8f00fe31c79c296b85dcd39e01ae';
const MARKS = {};
const mark = (s) => { MARKS[s] = Date.now() / 1000; console.log('mark', s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: false,
  args: ['--window-position=0,0', '--window-size=1600,900', '--force-device-scale-factor=1.6', '--hide-scrollbars'] });
const ctx = await b.newContext({ viewport: null });
await ctx.addInitScript(() => {
  // Keep the export's file save from raising Chrome's fullscreen download bubble.
  const oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) return; return oc.call(this); };

  const mk = () => { if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(255,200,40,.35);border:2px solid #ffc828;box-shadow:0 0 6px rgba(0,0,0,.5);pointer-events:none;left:-50px;top:-50px;transform:translate(-50%,-50%);transition:transform .08s';
    document.documentElement.appendChild(c); };
  addEventListener('mousemove', (e) => { mk(); const c = document.getElementById('__cur'); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { const c = document.getElementById('__cur'); if (c) c.style.transform = 'translate(-50%,-50%) scale(.6)'; }, true);
  addEventListener('mouseup', () => { const c = document.getElementById('__cur'); if (c) c.style.transform = 'translate(-50%,-50%) scale(1)'; }, true);
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const { windowId } = await cdp.send('Browser.getWindowForTarget');
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await wait(3000);
await p.mouse.move(800, 450);

const ff = process.env.NOCAP ? {stdin:{write(){}},on(e,f){f()}} : spawn(process.env.FF, ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30',
  '-use_wallclock_as_timestamps', '1', '-video_size', '2560x1440', '-i', ':99',
  '-copyts', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10',
  '-pix_fmt', 'yuv420p', D + 'take.mkv'], { stdio: ['pipe', 'inherit', 'inherit'] });
await wait(2500);

const go = async (loc, steps = 20) => { const bb = await loc.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps }); };
const click = async (loc) => { await go(loc); await wait(200); await p.mouse.down(); await p.mouse.up(); };

if(process.env.GRAPH_ONLY){await p.goto('http://localhost:5173/alerts',{waitUntil:'networkidle'});await wait(1500);} else {
// ---- Overview
mark('screen start');
await p.mouse.move(180, 150, { steps: 40 }); await wait(1500);
await p.mouse.move(850, 150, { steps: 40 }); await wait(1500);
await p.mouse.move(600, 650, { steps: 50 }); await wait(2500);
await p.mouse.move(400, 700, { steps: 30 }); await wait(1500);
// ---- Alerts
mark('alerts nav');
await click(p.getByLabel('Alerts').first());
await wait(1000);
const q = p.getByPlaceholder('Entity id or finding text');
await click(q); await q.pressSequentially(W.slice(0, 16), { delay: 60 });
await wait(1000);
await click(p.locator('tbody tr').first());
mark('alert open');
await wait(1800);
await click(p.locator('.tabs [role=tab]', { hasText: /^Explanation/ })); mark('explanation');
await wait(6000);
await click(p.locator('.tabs [role=tab]', { hasText: /^Overview$/ }));
await wait(500);
await p.getByText('Disposition', { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {});
await go(p.locator('.chip[title^="Mark this alert"]', { hasText: 'investigating' }));
await wait(300); await p.mouse.down(); await p.mouse.up();
mark('decision');
await wait(3000);
mark('decision end');
}
// ---- Graph (reload is cut out in the edit)
await p.goto('http://localhost:5173/graph', { waitUntil: 'networkidle' });
await p.getByText('sample of').waitFor({ timeout: 60000 }); await p.waitForLoadState('networkidle'); await wait(5000);
await p.mouse.move(300, 400); await wait(800);
mark('graph take');
const f = p.getByLabel('Find in graph');
await click(f); await f.pressSequentially(W, { delay: 25 });
await wait(600);
await f.press('Enter');
await p.locator('.isolation-banner', { hasText: '(10 nodes' }).waitFor({ timeout: 15000 });
mark('graph found');
await wait(300);
const nodeXY = async (prefix) => p.evaluate((pre) => {
  let s = null;
  for (const el of document.querySelectorAll('canvas')) { let key; for (const k of Object.keys(el.parentElement)) if (k.startsWith('__reactFiber')) key = k;
    if (!key) continue; let fib = el.parentElement[key], i = 0;
    while (fib && i++ < 400) { let st = fib.memoizedState, j = 0; while (st && typeof st === 'object' && j++ < 40) { const m = st.memoizedState; if (m && typeof m === 'object' && typeof m.getGraph === 'function' && typeof m.graphToViewport === 'function') { s = m; break; } st = st.next; } if (s) break; fib = fib.return; }
    if (s) break; }
  if (!s) return null;
  const g = s.getGraph(); const id = g.nodes().find((n) => n.startsWith(pre)); if (!id) return null;
  const v = s.framedGraphToViewport(s.getNodeDisplayData(id)); const r = s.getContainer().getBoundingClientRect();
  return { x: v.x + r.left, y: v.y + r.top }; }, prefix);
const clickNode = async (prefix) => { const c = await nodeXY(prefix); if (!c) { await p.screenshot({path:D+'fail.png'}); console.log(await p.evaluate(()=>document.querySelector('.isolation-banner')?.textContent)); throw new Error('node ' + prefix);}
  await p.mouse.move(c.x, c.y, { steps: 20 }); await wait(150); await p.mouse.down(); await p.mouse.up(); };
const fit = async () => { await click(p.getByRole('button', { name: 'Fit', exact: true })); await wait(600);
  await click(p.locator('.tool-btn[title^="Zoom out"]').first()); await wait(700); };
await click(p.getByLabel('Clear search'));
for (let i = 0; i < 3; i++) {       // the default graph can land late and replace the isolation
  await wait(700);
  if (await nodeXY('bc1qc662a6c4')) break;
  console.log('isolation lost, searching again');
  await f.fill(W); await f.press('Enter');
  await p.locator('.isolation-banner', { hasText: '(10 nodes' }).waitFor({ timeout: 15000 });
  await wait(500); await click(p.getByLabel('Clear search'));
}
await fit();
await clickNode('bc1qc662a6c4'); mark('wallet selected');
await p.mouse.move(900, 700, { steps: 15 }); await wait(800);
await fit();
await clickNode('147.234.127.');
await p.mouse.move(900, 720, { steps: 10 });
await p.keyboard.press('e'); mark('E 1');
await wait(1500);
await fit();
await clickNode('bc1qc662a6c4');
await wait(400); mark('trace start');
await click(p.locator('.tool-btn', { hasText: 'Trace' }));
await wait(500);
const to = p.getByPlaceholder('Paste an address, txid or IP');
await click(to); await to.pressSequentially(T, { delay: 15 });
await wait(400);
await go(p.getByRole('button', { name: 'Find shortest path' })); await wait(150);
mark('find'); await p.mouse.down(); await p.mouse.up();
await wait(2500);
await go(p.getByRole('button', { name: 'Export' })); await wait(150);
mark('export'); await p.mouse.down(); await p.mouse.up();
await wait(700);
await click(p.getByText('Export canvas as PNG'));
await wait(4000);
mark('end');
ff.stdin.write('q'); await new Promise((r) => ff.on('close', r));
await b.close();
fs.writeFileSync(D + 'marks.json', JSON.stringify(MARKS, null, 1));
console.log('done');
