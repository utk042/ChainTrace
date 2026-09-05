/**
 * Colour values for the places CSS can't reach: the WebGL graph canvas and
 * the ECharts options objects. Mirrors the tokens in index.css.
 *
 * The palette follows the Palantir Gotham workstation: a five-step neutral
 * ramp under a single blue that means "interactive or selected", with the
 * severity ramp kept in warm hues so selection and risk can never be
 * confused for one another.
 *
 * The graph derives node colour from type and risk here rather than trusting
 * the colour a payload carried, so a palette change reaches live data and the
 * bundled snapshot alike with no re-export.
 */

export const SURFACE = {
  base: '#111418',          // application ground
  chrome: '#1c2127',        // title bar, menu bar, rail, status bar
  raised: '#252a31',        // panels
  inset: '#2f343c',         // wells, table headers, nested chips
  border: '#404854',        // panel seams
  borderStrong: '#5f6b7c',  // focus and hover affordances
};

export const TEXT = {
  primary: '#f6f7f9',
  secondary: '#abb3bf',
  tertiary: '#8f99a8',
  muted: '#738091',
};

export const ACCENT = '#4c90f0';

export const TYPE_COLORS = {
  wallet: '#4c90f0',       // blue: the primary entity
  transaction: '#8f99a8',  // neutral: connective tissue
  ip: '#7961db',           // violet: the network layer
  unknown: '#5f6b7c',
};

// Red -> orange -> gold, spaced far enough apart to stay distinguishable at
// an 8px legend dot.
export const RISK_COLORS = {
  Critical: '#e76a6e',
  High: '#ec9a3c',
  Elevated: '#d1980b',
  Low: '#32a467',
  Normal: '#5f6b7c',
};

/** Canvas colours that aren't entity data. */
export const CANVAS = {
  // The graph ground, so an exported PNG matches what is on screen.
  background: '#111418',
  dimNode: '#2f343c',
  dimEdge: '#20252b',
  edge: '#5f6b7c',
  highlight: ACCENT,
  path: '#ec9a3c',
  label: '#c5cbd3',
  hoverBg: 'rgba(28, 33, 39, 0.97)',
  hoverBorder: SURFACE.border,
  hoverText: TEXT.primary,
};

/**
 * Edge colours by relationship.
 *
 * Kept near-neutral and light rather than saturated: on a dark canvas the
 * links are the connective tissue, and a graph drawn in six competing hues
 * reads as decoration. Each is a tint of the neutral ramp, distinguishable
 * side by side without any of them fighting the nodes for attention.
 */
export const EDGE_COLORS = {
  co_input: '#8579c9',      // co-ownership inference — the one real inference
  wallet_input: '#6b7f9e',
  wallet_output: '#5f8a75',
  ip_observed_tx: '#6b7280',
  unknown: '#525c69',
};

export const nodeColor = (nodeType, riskTier) =>
  RISK_COLORS[riskTier] || TYPE_COLORS[nodeType] || TYPE_COLORS.unknown;

export const edgeColor = (edgeType) => EDGE_COLORS[edgeType] || EDGE_COLORS.unknown;

/** Legend rows, in the order the eye should learn them. */
export const TYPE_LEGEND = [
  { key: 'wallet', label: 'Wallet', color: TYPE_COLORS.wallet },
  { key: 'transaction', label: 'Transaction', color: TYPE_COLORS.transaction },
  { key: 'ip', label: 'IP address', color: TYPE_COLORS.ip },
];

export const RISK_LEGEND = [
  { label: 'Critical', color: RISK_COLORS.Critical },
  { label: 'High', color: RISK_COLORS.High },
  { label: 'Elevated', color: RISK_COLORS.Elevated },
];

const FONT_MONO = 'IBM Plex Mono';

/** Shared ECharts axis/grid/tooltip styling. */
export const chartAxis = (extra = {}) => ({
  axisLine: { lineStyle: { color: SURFACE.border } },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: { color: TEXT.tertiary, fontSize: 10, fontFamily: FONT_MONO },
  ...extra,
});

export const chartValueAxis = (extra = {}) => ({
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: 'rgba(143, 153, 168, 0.16)' } },
  axisLabel: { color: TEXT.tertiary, fontSize: 10, fontFamily: FONT_MONO },
  ...extra,
});

export const chartTooltip = (extra = {}) => ({
  backgroundColor: SURFACE.chrome,
  borderColor: SURFACE.border,
  borderWidth: 1,
  padding: [6, 10],
  textStyle: { color: TEXT.primary, fontSize: 11, fontFamily: FONT_MONO },
  ...extra,
});
