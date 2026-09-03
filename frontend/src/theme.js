/**
 * Colour values for the places CSS can't reach: the WebGL graph canvas and
 * the ECharts options objects. Mirrors the tokens in index.css.
 *
 * The graph derives node colour from type and risk here rather than trusting
 * the colour a payload carried, so a palette change reaches live data and the
 * bundled snapshot alike with no re-export.
 *
 * Two non-overlapping vocabularies — entity type, and risk tier. Risk wins
 * where both apply. The violet accent means interactive or selected and
 * never encodes anything about the data.
 */

export const SURFACE = {
  base: '#000000',
  chrome: '#08080b',
  raised: '#0d0d13',
  inset: '#121219',
  border: '#1b1b24',
  borderStrong: '#2e2e3c',
};

export const TEXT = {
  primary: '#e8e8ef',
  secondary: '#9494a6',
  tertiary: '#63636f',
  muted: '#45454f',
};

export const ACCENT = '#8b7cf6';

export const TYPE_COLORS = {
  wallet: '#8b7cf6',       // violet: the primary entity
  transaction: '#4a4a5c',  // recessive: connective tissue
  ip: '#5a8ca8',           // steel: the network layer
  unknown: '#3f3f4c',
};

// Red -> orange -> yellow, spaced far enough apart to stay distinguishable
// at an 8px legend dot.
export const RISK_COLORS = {
  Critical: '#f0484f',
  High: '#e8913a',
  Elevated: '#d8c33f',
  Low: '#3da35d',
  Normal: '#33333f',
};

/** Canvas colours that aren't entity data. */
export const CANVAS = {
  dimNode: '#191922',
  dimEdge: '#101016',
  edge: '#1c1c26',
  highlight: ACCENT,
  path: '#e8913a',
  label: '#c8c8d6',
  hoverBg: 'rgba(13, 13, 19, 0.96)',
  hoverBorder: SURFACE.borderStrong,
  hoverText: TEXT.primary,
};

/** Edge colours by relationship, muted enough to stay context. */
export const EDGE_COLORS = {
  co_input: '#5a4560',      // co-ownership inference
  wallet_input: '#2c3a52',
  wallet_output: '#2b4a3e',
  ip_observed_tx: '#33304a',
  unknown: '#1c1c26',
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
  splitLine: { lineStyle: { color: SURFACE.border } },
  axisLabel: { color: TEXT.tertiary, fontSize: 10, fontFamily: FONT_MONO },
  ...extra,
});

export const chartTooltip = (extra = {}) => ({
  backgroundColor: SURFACE.raised,
  borderColor: SURFACE.borderStrong,
  borderWidth: 1,
  padding: [6, 10],
  textStyle: { color: TEXT.primary, fontSize: 11, fontFamily: FONT_MONO },
  ...extra,
});
