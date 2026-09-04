/**
 * Fails the build if any icon's geometry escapes the 24x24 viewBox.
 *
 * A path that spills is not a visible error — SVG clips it silently — so a
 * mangled glyph ships looking like a smudge. This walks every path in
 * src/components/Icon.jsx and computes a real bounding box: exact extremes
 * for cubic/quadratic segments, and endpoint-to-centre parameterisation for
 * arcs, so a bulging arc is measured rather than guessed at.
 *
 * Run: npm run check:icons
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 24;
// Half of the widest stroke the component draws (2.0), so a path that only
// just touches the edge is reported before the stroke is shaved.
const MARGIN = 1.0;

const source = readFileSync(join(ROOT, 'src/components/Icon.jsx'), 'utf8');
const block = source.slice(source.indexOf('const PATHS'), source.indexOf('const FILLED'));

/** name -> [subpath, ...]; array entries are flattened onto one name. */
function parseIcons(text) {
  const icons = [];
  const entry = /^\s{2}([A-Za-z][A-Za-z0-9]*):\s*(\[[\s\S]*?\]|'[^']*')/gm;
  for (const m of text.matchAll(entry)) {
    const subpaths = [...m[2].matchAll(/'([^']*)'/g)].map((s) => s[1]);
    icons.push([m[1], subpaths]);
  }
  return icons;
}

class Box {
  constructor() { this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity; }
  add(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y);
  }
}

const cubicAt = (a, b, c, d, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** Extremes of one cubic coordinate: endpoints plus roots of the derivative. */
function cubicExtremes(a, b, c, d) {
  const out = [a, d];
  const ca = -a + 3 * b - 3 * c + d;
  const cb = 2 * (a - 2 * b + c);
  const cc = -a + b;
  const push = (t) => { if (t > 0 && t < 1) out.push(cubicAt(a, b, c, d, t)); };
  if (Math.abs(ca) < 1e-12) {
    if (Math.abs(cb) > 1e-12) push(-cc / cb);
  } else {
    const disc = cb * cb - 4 * ca * cc;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      push((-cb + r) / (2 * ca));
      push((-cb - r) / (2 * ca));
    }
  }
  return out;
}

/** Endpoint -> centre parameterisation (SVG spec F.6.5), then sample extremes. */
function arcBounds(box, x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) { box.add(x2, y2); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;

  // Scale up radii that are too small to span the chord (spec F.6.6).
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const onArc = (t) => {
    // Normalise into the swept range, whichever direction it runs.
    let d = t - theta1;
    while (d < 0) d += 2 * Math.PI;
    while (d > 2 * Math.PI) d -= 2 * Math.PI;
    return delta >= 0 ? d <= delta + 1e-9 : d - 2 * Math.PI >= delta - 1e-9;
  };
  const at = (t) => [
    cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP,
    cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP,
  ];

  box.add(x1, y1);
  box.add(x2, y2);
  // Parameter angles where dx/dt or dy/dt vanish — the arc's own extremes.
  const tx = Math.atan2(-ry * sinP, rx * cosP);
  const ty = Math.atan2(ry * cosP, rx * sinP);
  for (const base of [tx, ty]) {
    for (const t of [base, base + Math.PI]) {
      if (onArc(t)) box.add(...at(t));
    }
  }
}

function boundsOf(d) {
  const box = new Box();
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0, startX = 0, startY = 0;
  let prevCx = null, prevCy = null, prevQx = null, prevQy = null;
  const take = (n) => { const a = []; for (let k = 0; k < n; k++) a.push(parseFloat(tokens[i++])); return a; };

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ax = rel ? x : 0, ay = rel ? y : 0;
    let isCubic = false, isQuad = false;

    if (C === 'Z') { x = startX; y = startY; box.add(x, y); continue; }
    if (C === 'M') {
      const [px, py] = take(2); x = ax + px; y = ay + py; startX = x; startY = y; box.add(x, y);
      cmd = rel ? 'l' : 'L';                       // subsequent pairs are implicit lineto
    } else if (C === 'L') {
      const [px, py] = take(2); x = ax + px; y = ay + py; box.add(x, y);
    } else if (C === 'H') {
      const [px] = take(1); x = ax + px; box.add(x, y);
    } else if (C === 'V') {
      const [py] = take(1); y = ay + py; box.add(x, y);
    } else if (C === 'C' || C === 'S') {
      const v = take(C === 'C' ? 6 : 4);
      const c1x = C === 'C' ? ax + v[0] : (prevCx === null ? x : 2 * x - prevCx);
      const c1y = C === 'C' ? ay + v[1] : (prevCy === null ? y : 2 * y - prevCy);
      const c2x = ax + v[C === 'C' ? 2 : 0], c2y = ay + v[C === 'C' ? 3 : 1];
      const ex = ax + v[C === 'C' ? 4 : 2], ey = ay + v[C === 'C' ? 5 : 3];
      for (const px of cubicExtremes(x, c1x, c2x, ex)) box.add(px, y);
      for (const py of cubicExtremes(y, c1y, c2y, ey)) box.add(x, py);
      for (const px of cubicExtremes(x, c1x, c2x, ex)) {
        for (const py of cubicExtremes(y, c1y, c2y, ey)) box.add(px, py);
      }
      prevCx = c2x; prevCy = c2y; x = ex; y = ey; isCubic = true;
    } else if (C === 'Q' || C === 'T') {
      const v = take(C === 'Q' ? 4 : 2);
      const qx = C === 'Q' ? ax + v[0] : (prevQx === null ? x : 2 * x - prevQx);
      const qy = C === 'Q' ? ay + v[1] : (prevQy === null ? y : 2 * y - prevQy);
      const ex = ax + v[C === 'Q' ? 2 : 0], ey = ay + v[C === 'Q' ? 3 : 1];
      // Raise to a cubic so one extremes routine covers both.
      for (const px of cubicExtremes(x, x + (2 / 3) * (qx - x), ex + (2 / 3) * (qx - ex), ex)) box.add(px, y);
      for (const py of cubicExtremes(y, y + (2 / 3) * (qy - y), ey + (2 / 3) * (qy - ey), ey)) box.add(x, py);
      prevQx = qx; prevQy = qy; x = ex; y = ey; isQuad = true;
    } else if (C === 'A') {
      const v = take(7);
      const ex = ax + v[5], ey = ay + v[6];
      arcBounds(box, x, y, v[0], v[1], v[2], v[3] !== 0, v[4] !== 0, ex, ey);
      x = ex; y = ey;
    } else {
      i++;                                          // unknown token: skip
      continue;
    }
    if (!isCubic) { prevCx = null; prevCy = null; }
    if (!isQuad) { prevQx = null; prevQy = null; }
  }
  return box;
}

const icons = parseIcons(block);
if (icons.length === 0) {
  console.error('check-icons: parsed no icons — has the PATHS table moved?');
  process.exit(1);
}

const problems = [];
for (const [name, subpaths] of icons) {
  const box = new Box();
  for (const d of subpaths) {
    const b = boundsOf(d);
    box.add(b.minX, b.minY);
    box.add(b.maxX, b.maxY);
  }
  const spills = box.minX < -0.001 || box.minY < -0.001 || box.maxX > SIZE + 0.001 || box.maxY > SIZE + 0.001;
  const tight = box.minX < MARGIN || box.minY < MARGIN
    || box.maxX > SIZE - MARGIN || box.maxY > SIZE - MARGIN;
  const report = `${name.padEnd(15)} x:[${box.minX.toFixed(2)}, ${box.maxX.toFixed(2)}]  y:[${box.minY.toFixed(2)}, ${box.maxY.toFixed(2)}]`;
  if (spills) problems.push(`  CLIPPED  ${report}`);
  else if (tight) problems.push(`  TIGHT    ${report}  (stroke may be shaved at the edge)`);
}

if (problems.length) {
  console.error(`check-icons: ${problems.length} of ${icons.length} icons are outside the safe area.\n`);
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-icons: ${icons.length} icons fit inside 24x24 with a ${MARGIN} unit margin.`);
