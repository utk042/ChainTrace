/**
 * Filtering, sorting and pagination applied on the client.
 *
 * The backend does all of this in SQL. Two situations have no backend to ask:
 * snapshot mode, which reads a bundled pipeline run, and an offline session
 * re-slicing a response the service worker stored earlier. Both need the
 * *same* semantics as the server, because a filter panel that behaves one way
 * online and another way offline is worse than no offline mode at all — so
 * the rules live here once rather than being written twice and drifting.
 *
 * Nothing here invents data. Every function takes rows that came from the
 * pipeline and returns a subset of them.
 */

export const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const lower = (v) => String(v ?? '').toLowerCase();

/** Sort rows the way the backend's ORDER BY would. */
export function sortRows(rows, params = {}, fallbackKey) {
  const key = params.sort_by || fallbackKey;
  if (!key) return [...rows];
  const dir = String(params.sort_order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a?.[key];
    const y = b?.[key];
    if (x === y) return 0;
    // Nulls sort last in either direction: a missing value is not a small one.
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
}

/**
 * Cut the requested page out of `rows`.
 *
 * `total` is the size of the result set the caller is paging through, which
 * is not always `rows.length`: an offline re-slice knows the backend's own
 * total from the stored response and must report that rather than the size of
 * what happens to be on this device.
 */
export function paginate(rows, params = {}, key, total = rows.length) {
  const page = Math.max(1, num(params.page, 1));
  const size = Math.max(1, num(params.page_size, 20));
  const start = (page - 1) * size;
  return {
    [key]: rows.slice(start, start + size),
    total,
    page,
    page_size: size,
  };
}

// ─── Per-table filters, mirroring the routers ────────────────────

/** GET /api/alerts */
export function filterAlerts(rows, params = {}) {
  const needle = params.search ? lower(params.search) : null;
  return rows.filter((a) => {
    if (params.risk_tier && a.risk_tier !== params.risk_tier) return false;
    if (params.status && a.status !== params.status) return false;
    if (params.entity_type && a.entity_type !== params.entity_type) return false;
    if (params.model && a.model !== params.model) return false;
    if (num(params.min_confidence) > 0 && num(a.confidence) < num(params.min_confidence)) return false;
    // The backend searches the description as well as the entity id.
    if (needle && !`${a.entity_id || ''} ${a.description || ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** GET /api/wallets */
export function filterWallets(rows, params = {}) {
  const needle = params.search ? lower(params.search) : null;
  return rows.filter((w) => {
    if (params.risk_tier && w.risk_tier !== params.risk_tier) return false;
    if (needle && !lower(w.address).includes(needle)) return false;
    if (num(params.min_score) > 0 && num(w.anomaly_score) < num(params.min_score)) return false;
    if (params.pattern === 'peel_chain' && !num(w.peel_chain_depth)) return false;
    if (params.pattern === 'mixer' && !num(w.mixer_interaction_count)) return false;
    if (params.pattern === 'watchlist' && w.darknet_proximity_hops === null) return false;
    return true;
  });
}

/** GET /api/transactions */
export function filterTransactions(rows, params = {}) {
  const needle = params.search ? lower(params.search) : null;
  return rows.filter((t) => {
    if (params.script_type && t.script_type !== params.script_type) return false;
    if (needle && !`${t.txid || ''} ${t.src_ip || ''} ${t.dst_ip || ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * The three paginated list endpoints, described once: which key holds the
 * rows, how they are filtered, and what the backend orders them by when the
 * caller does not say.
 */
export const LIST_ENDPOINTS = {
  '/api/alerts': { key: 'alerts', filter: filterAlerts, defaultSort: 'confidence', idField: 'alert_id' },
  '/api/wallets': { key: 'wallets', filter: filterWallets, defaultSort: 'anomaly_score', idField: 'address' },
  '/api/transactions': { key: 'transactions', filter: filterTransactions, defaultSort: 'timestamp', idField: 'txid' },
};

/** Params that select a slice of a result set rather than narrow it. */
const PAGING_PARAMS = new Set(['page', 'page_size', 'sort_by', 'sort_order']);

export const isFilteredQuery = (params = {}) => Object.entries(params)
  .some(([k, v]) => !PAGING_PARAMS.has(k) && v !== '' && v !== null && v !== undefined);

/** Apply a list endpoint's filter, sort and page to rows held locally. */
export function queryList(path, rows, params = {}, total) {
  const spec = LIST_ENDPOINTS[path];
  if (!spec) return null;
  const filtered = spec.filter(rows, params);
  const sorted = sortRows(filtered, params, spec.defaultSort);
  // Only an unfiltered view may borrow the backend's own count. A filter that
  // happens to match every row held here has still not been run against the
  // rows that are not — reporting the whole table's total for it would claim
  // a result set this device never saw.
  const borrowTotal = total != null && !isFilteredQuery(params);
  return paginate(sorted, params, spec.key, borrowTotal ? total : filtered.length);
}
