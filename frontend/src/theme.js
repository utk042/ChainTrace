/**
 * Colour values for the places CSS can't reach: the WebGL graph canvas and
 * the ECharts options objects. Mirrors the tokens in index.css.
 *
 * Monochrome. With no hue to spend, the graph separates entity types by
 * luminance and risk by luminance plus node size, and every legend row is
 * labelled in text. Risk wins where both apply.
 */

export const SURFACE = {
  base: '#000000',
  chrome: '#0A0A0A',
  raised: '#0A0A0A',
  inset: '#141414',
  border: '#262626',
  borderStrong: '#404040',
};

export const TEXT = {
  primary: '#F5F5F5',
  secondary: '#A3A3A3',
  tertiary: '#737373',
  muted: '#525252',
};

export const ACCENT = '#F5F5F5';

export const TYPE_COLORS = {
  wallet: '#8A8A8A',       // the primary entity, mid-gray
  transaction: '#3D3D3D',  // recessive: connective tissue
  ip: '#5E5E5E',           // the network layer
  unknown: '#333333',
};

// Severity by luminance: the worse it is, the brighter it burns against
// the black ground. Labels carry the tier name everywhere it is shown.
export const RISK_COLORS = {
  Critical: '#FFFFFF',
  High: '#B0B0B0',
  Elevated: '#7D7D7D',
  Low: '#4A4A4A',
  Normal: '#2E2E2E',
};

/** Canvas colours that aren't entity data. */
export const CANVAS = {
  dimNode: '#1C1C1C',
  dimEdge: '#111111',
  edge: '#242424',
  highlight: ACCENT,
  path: '#FFFFFF',
  label: '#C8C8C8',
  hoverBg: 'rgba(10, 10, 10, 0.96)',
  hoverBorder: SURFACE.borderStrong,
  hoverText: TEXT.primary,
};

/** Edge colours by relationship, muted enough to stay context. */
export const EDGE_COLORS = {
  co_input: '#4A4A4A',      // co-ownership inference, the loudest edge
  wallet_input: '#303030',
  wallet_output: '#303030',
  ip_observed_tx: '#242424',
  unknown: '#1C1C1C',
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
