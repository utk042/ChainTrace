/**
 * Hand-authored stroke-icon set (24x24, currentColor) so the UI never relies
 * on unicode/emoji glyphs standing in for meaning, and so an air-gapped
 * install pulls no icon font over the network.
 *
 * Every entry is either one path string or an array of subpaths. Geometry
 * must stay inside the 0-24 box with room for the stroke: anything that
 * spills is silently clipped by the viewBox and renders as a broken glyph.
 * `npm run check:icons` enforces that.
 */
const PATHS = {
  // ─── Navigation ───────────────────────────────────────────────
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  alertTriangle: 'M12 3.5 21.5 20h-19zM12 9.5v5M12 17.5h.01',
  wallet: 'M3.5 8A2.5 2.5 0 0 1 6 5.5h11a1.5 1.5 0 0 1 1.5 1.5v1.5M3.5 8v9A2.5 2.5 0 0 0 6 19.5h11.5a1.5 1.5 0 0 0 1.5-1.5V15M15.8 11h4a.7.7 0 0 1 .7.7v2.6a.7.7 0 0 1-.7.7h-4a2 2 0 0 1 0-4z',
  graph: 'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.6 8.3 10.5 17M17.4 8.3 13.5 17M8 5h8',
  swap: 'm4 8 4-4 4 4M8 4v13M20 16l-4 4-4-4M16 20V7',
  uploadCloud: 'M7 18a4 4 0 0 1-1-7.9 5 5 0 0 1 9.8-1.7A4.5 4.5 0 0 1 17 18H7zM12 11v7M9 14l3-3 3 3',

  // A gear ring around a hub. The previous path was a mangled copy whose
  // arcs ran to y=-1, so the top tooth was clipped off by the viewBox and
  // the icon rendered as a broken smear at nav size.
  settings: [
    'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
    'M10.6 3.2a.9.9 0 0 1 .9-.7h1a.9.9 0 0 1 .9.7l.3 1.7a7.4 7.4 0 0 1 1.7.7l1.4-1a.9.9 0 0 1 1.1.1l.7.7a.9.9 0 0 1 .1 1.1l-1 1.4a7.4 7.4 0 0 1 .7 1.7l1.7.3a.9.9 0 0 1 .7.9v1a.9.9 0 0 1-.7.9l-1.7.3a7.4 7.4 0 0 1-.7 1.7l1 1.4a.9.9 0 0 1-.1 1.1l-.7.7a.9.9 0 0 1-1.1.1l-1.4-1a7.4 7.4 0 0 1-1.7.7l-.3 1.7a.9.9 0 0 1-.9.7h-1a.9.9 0 0 1-.9-.7l-.3-1.7a7.4 7.4 0 0 1-1.7-.7l-1.4 1a.9.9 0 0 1-1.1-.1l-.7-.7a.9.9 0 0 1-.1-1.1l1-1.4a7.4 7.4 0 0 1-.7-1.7l-1.7-.3a.9.9 0 0 1-.7-.9v-1a.9.9 0 0 1 .7-.9l1.7-.3a7.4 7.4 0 0 1 .7-1.7l-1-1.4a.9.9 0 0 1 .1-1.1l.7-.7a.9.9 0 0 1 1.1-.1l1.4 1a7.4 7.4 0 0 1 1.7-.7z',
  ],

  // ─── Generic ──────────────────────────────────────────────────
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  chevronLeft: 'M14.5 5 8 12l6.5 7',
  chevronRight: 'M9.5 5 16 12l-6.5 7',
  chevronDown: 'M5 9.5 12 16l7-6.5',
  chevronUp: 'M5 14.5 12 8l7 6.5',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 19h16',
  play: 'M6.5 4.5v15l13-7.5z',
  sparkles: 'M11 3l1.2 3.4L15.5 7.7l-3.3 1.3L11 12.5l-1.2-3.5L6.5 7.7l3.3-1.3zM18 14l.8 2.3 2.2.9-2.2.9-.8 2.3-.8-2.3-2.2-.9 2.2-.9z',
  rotateCcw: 'M4 4v6h6M4.5 13.5A8 8 0 1 0 6 6.3L4 10',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M4 12.5l5 5L20 6.5',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  circleDot: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 12h.01',
  flag: 'M5 21V4M5 4h13l-3 4 3 4H5',
  globe: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.75h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  trash: 'M3.5 6.5h17M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M18.5 6.5v13a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-13M10 11v6M14 11v6',
  database: 'M12 3c-4 0-7 1.2-7 2.6S8 8.2 12 8.2s7-1.2 7-2.6S16 3 12 3zM5 5.6v12.8C5 19.8 8 21 12 21s7-1.2 7-2.6V5.6M5 12c0 1.4 3 2.6 7 2.6s7-1.2 7-2.6',
  zap: 'M13 2.5 4.5 14h6.5l-1 7.5L19.5 10H13z',

  // ─── Connectivity / offline ───────────────────────────────────
  wifi: 'M2.5 9a15.5 15.5 0 0 1 19 0M5.5 12.5a11 11 0 0 1 13 0M8.5 16a6.5 6.5 0 0 1 7 0M12 19.5h.01',
  wifiOff: 'M2 2l20 20M16.7 11.1A10.6 10.6 0 0 1 19 12.6M5 12.6a10.6 10.6 0 0 1 5.2-2.4M10.7 5.1A15.5 15.5 0 0 1 21.5 9M2.5 9a15.4 15.4 0 0 1 3.6-2.3M8.5 16a6.5 6.5 0 0 1 7 0M12 19.5h.01',
  cloudOff: 'M20.4 16.2A4.3 4.3 0 0 0 16.8 9.6h-1.1A6.6 6.6 0 0 0 10.2 4.6M6.3 7.2A6.6 6.6 0 0 0 7.6 19.6h9.2a4.3 4.3 0 0 0 1.6-.3M2.6 2.6l18.8 18.8',
  boxDown: 'M12 3v9M8.5 8.5 12 12l3.5-3.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  shieldCheck: 'M12 3l8 3v5.5c0 4.4-3.2 8.2-8 9.5-4.8-1.3-8-5.1-8-9.5V6zM8.5 12l2.5 2.5 4.5-4.5',

  // ─── Graph explorer ───────────────────────────────────────────
  crosshair: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v4M12 17v4M3 12h4M17 12h4',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  route: 'M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 8v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v.5',
  expand: 'M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6',
  layers: 'M12 3 3 8l9 5 9-5zM3 12.8l9 5 9-5M3 17.3l9 5 9-5',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3 3L15.5 10 20 14.5M9 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  link: 'M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3',
  pin: 'M12 21v-7M8.5 4h7l-1 6 2.5 2.5v1.5H7v-1.5L9.5 10z',
  refresh: 'M20 5v6h-6M4 19v-6h6M19.4 9A8 8 0 0 0 5.7 6.3L4 8M4.6 15a8 8 0 0 0 13.7 2.7L20 16',

  // ─── Workstation chrome ───────────────────────────────────────
  menu: 'M4 7h16M4 12h16M4 17h16',
  folder: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h3.6l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
  briefcase: 'M4 8h16v11H4zM9 8V6.2A1.7 1.7 0 0 1 10.7 4.5h2.6A1.7 1.7 0 0 1 15 6.2V8M4 12.5h16',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  table: 'M4 5h16v14H4zM4 10h16M10 5v14',
  columns: 'M4 5h16v14H4zM10 5v14M15 5v14',
  panelRight: 'M4 5h16v14H4zM15 5v14',
  barChart: 'M4 19.5h16M7 16.5V9.5M12 16.5V5.5M17 16.5v-5',
  fileText: 'M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4M9.5 12.5h5M9.5 16h5',
  terminal: 'M4 5h16v14H4zM8 10l2.5 2L8 14M13.5 15h3.5',
  sliders: 'M4 8h9M17 8h3M4 16h3M11 16h9M15 5.5v5M9 13.5v5',
  star: 'M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.9l5.4-.8z',
  share: 'M17.5 7.5a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM6.5 14.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM17.5 21.3a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM8.6 10.8l6.8-3.4M8.6 13.2l6.8 3.4',
  user: 'M12 11.6a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6zM4.6 20a7.4 7.4 0 0 1 14.8 0',
  eye: 'M12 6c-4.5 0-8 6-8 6s3.5 6 8 6 8-6 8-6-3.5-6-8-6zM12 14.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z',
  save: 'M5 4h11l3 3v13H5zM8.5 4v5h7V4M8.5 20v-6h7v6',
  sortAsc: 'M12 19.5v-15M6.5 10L12 4.5 17.5 10',
  sortDesc: 'M12 4.5v15M6.5 14l5.5 5.5 5.5-5.5',
  arrowRight: 'M4 12h15.5M13.5 6l6 6-6 6',
  externalLink: 'M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  moreHorizontal: 'M6 12h.01M12 12h.01M18 12h.01',
  collapseLeft: 'M11 5.5 5.5 12 11 18.5M19 5.5 13.5 12 19 18.5',
  collapseRight: 'M13 5.5 18.5 12 13 18.5M5 5.5 10.5 12 5 18.5',
};

/** Names whose geometry is a solid shape rather than a stroked outline. */
const FILLED = new Set(['play', 'zap']);

export const ICON_NAMES = Object.keys(PATHS);

/**
 * `title` promotes the icon to an image with an accessible name; without it
 * the icon is decorative and hidden from assistive tech, which is correct
 * when it sits next to a visible label.
 */
export default function Icon({ name, size = 16, strokeWidth = 1.75, style, className, title }) {
  const d = PATHS[name];
  if (!d) {
    if (import.meta.env.DEV) console.warn(`<Icon>: no glyph named "${name}".`);
    return null;
  }
  const subpaths = Array.isArray(d) ? d : [d];
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {subpaths.map((sub) => <path key={sub} d={sub} />)}
    </svg>
  );
}
