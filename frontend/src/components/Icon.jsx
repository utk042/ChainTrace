// Minimal hand-authored stroke-icon set (24x24, currentColor) so the UI
// never relies on unicode/emoji glyphs standing in for meaning.
const PATHS = {
  // Nav
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  alertTriangle: 'M12 3.5 21.5 20h-19zM12 9.5v5M12 17.5h.01',
  wallet: 'M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4M3 7v0M16 13h3.5a1.5 1.5 0 0 1 0 3H16a1.5 1.5 0 0 1 0-3z',
  graph: 'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.6 8.3 10.5 17M17.4 8.3 13.5 17M8 5h8',
  swap: 'm4 8 4-4 4 4M8 4v13M20 16l-4 4-4-4M16 20V7',
  uploadCloud: 'M7 18a4 4 0 0 1-1-7.9 5 5 0 0 1 9.8-1.7A4.5 4.5 0 0 1 17 18H7zM12 11v7M9 14l3-3 3 3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 17.6a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 13 1.65 1.65 0 0 0 3.16 12H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 7a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 2.68 1.65 1.65 0 0 0 10 1.16V1a2 2 0 1 1 4 0v.09c0 .68.4 1.28 1 1.51.6.24 1.32.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.46.5-.57 1.22-.33 1.82.23.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.68 0-1.28.4-1.51 1z',

  // Generic
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  chevronLeft: 'M14.5 5 8 12l6.5 7',
  chevronRight: 'M9.5 5 16 12l-6.5 7',
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

  // Graph explorer
  crosshair: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v4M12 17v4M3 12h4M17 12h4',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  route: 'M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 8v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v.5',
  expand: 'M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3 3L15.5 10 20 14.5M9 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  link: 'M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.75h.01',
  chevronDown: 'M5 9.5 12 16l7-6.5',
  chevronUp: 'M5 14.5 12 8l7 6.5',
  pin: 'M12 21v-7M8.5 4h7l-1 6 2.5 2.5v1.5H7v-1.5L9.5 10z',
  refresh: 'M20 5v6h-6M4 19v-6h6M19.4 9A8 8 0 0 0 5.7 6.3L4 8M4.6 15a8 8 0 0 0 13.7 2.7L20 16',
};

const FILLED = new Set(['play']);

export default function Icon({ name, size = 16, strokeWidth = 1.5, style, className, title }) {
  const d = PATHS[name];
  if (!d) return null;
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
