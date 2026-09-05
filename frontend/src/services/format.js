/**
 * Display formatting shared by every pane.
 *
 * These used to be re-declared per page with slightly different rules, so
 * the same address appeared with three different truncations depending on
 * where you were looking at it. One definition each, here.
 */

/** Middle-elide a long identifier. The full value belongs in a title/tooltip. */
export function shortId(id, head = 10, tail = 8) {
  if (!id) return '—';
  const text = String(id);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

export function fmtInt(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

export function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtBtc(value, digits = 4) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  })} BTC`;
}

export function fmtPct(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

/** ISO timestamp -> "2024-05-02 15:37:04", the form the whole UI uses. */
export function fmtTimestamp(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

export function fmtDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

/** "3 minutes ago" for anything within a day; the timestamp beyond that. */
export function fmtRelative(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return fmtTimestamp(value);
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0 || seconds > 86_400) return fmtTimestamp(value);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** Tier -> CSS custom property, so JS-set colours match the stylesheet. */
export function riskVar(tier) {
  switch (tier) {
    case 'Critical': return 'var(--risk-critical)';
    case 'High': return 'var(--risk-high)';
    case 'Elevated': return 'var(--risk-elevated)';
    case 'Low': return 'var(--status-ok)';
    default: return 'var(--text-tertiary)';
  }
}

/** The same ramp keyed by a 0-100 score rather than by tier. */
export function scoreVar(score) {
  if (score >= 90) return 'var(--risk-critical)';
  if (score >= 70) return 'var(--risk-high)';
  if (score >= 40) return 'var(--risk-elevated)';
  return 'var(--accent)';
}

/** RFC 4180 quoting: a description with a comma or a quote must survive. */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns, rows) {
  return [
    columns.map(([, label]) => csvCell(label)).join(','),
    ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(',')),
  ].join('\r\n');
}
