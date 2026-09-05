/**
 * Serving a read from stored data when the backend cannot be reached.
 *
 * The service worker stores API responses keyed by their full URL, so it can
 * only answer the exact request it saw before. That is too strict to be
 * useful: an investigator who saved a case for offline use and then opened
 * page 2, sorted a column or ticked a filter got "no stored copy of this
 * query is available" from a device that was holding every row involved.
 *
 * This closes that gap. On a network failure it asks the worker for every
 * stored response on the same path and re-cuts the requested view out of the
 * widest one, using the same filter and sort rules the backend applies
 * (services/localQuery.js). Nothing is invented: the rows are backend output,
 * the response is flagged as stored so the UI keeps labelling it that way,
 * and when the stored copy cannot cover the request — a page beyond what was
 * saved, a filter over an already-filtered slice — it says so through
 * `offline_partial` instead of passing a short answer off as a complete one.
 */

import { matchStoredPath, isControlled } from './offline';
import { LIST_ENDPOINTS, queryList } from './localQuery';

/** Endpoints whose rows can answer a detail read for one entity. */
const DETAIL_FROM_LIST = {
  '/api/alerts': { list: '/api/alerts', key: 'alerts', idField: 'alert_id', label: 'alert' },
  '/api/wallets': { list: '/api/wallets', key: 'wallets', idField: 'address', label: 'wallet' },
  '/api/transactions': { list: '/api/transactions', key: 'transactions', idField: 'txid', label: 'transaction' },
};

const splitPath = (url) => String(url || '').split('?')[0];

/**
 * The stored table for a path, held for as long as the app stays offline.
 *
 * Fetching it means shipping every stored row across a MessageChannel, and a
 * page of a table costs several reads (rows, then the record behind a click).
 * Doing that per request made paging offline visibly slower than paging
 * online. Any live response drops the memo, so reconnecting never leaves a
 * stale table in play.
 */
const memo = new Map();

export const clearOfflineMemo = () => memo.clear();

/** The rows and backend total held for a list path, from the widest copy. */
async function storedRows(path) {
  if (!isControlled()) return null;
  if (memo.has(path)) return memo.get(path);

  let result;
  try { result = await matchStoredPath(path); } catch { return null; }
  const entries = result?.entries || [];
  if (!entries.length) return null;

  const key = LIST_ENDPOINTS[path]?.key;
  if (!key) return null;

  // Prefer the copy holding the most rows; among equals the freshest, which
  // the worker already ordered for us.
  let best = null;
  for (const entry of entries) {
    const rows = entry.body?.[key];
    if (!Array.isArray(rows)) continue;
    // A stored response for a *filtered* query describes a different result
    // set, and re-filtering it would silently narrow what the caller asked
    // for. Only unfiltered copies are a safe base.
    const params = new URLSearchParams(entry.url.split('?')[1] || '');
    const filtered = [...params.keys()].some(
      (k) => !['page', 'page_size', 'sort_by', 'sort_order'].includes(k),
    );
    if (filtered) continue;
    if (!best || rows.length > best.rows.length) {
      best = { rows, total: entry.body.total ?? rows.length, cachedAt: entry.cachedAt, url: entry.url };
    }
  }
  if (best) memo.set(path, best);
  return best;
}

/** A list read, re-cut from stored rows. */
async function listFallback(path, params) {
  const held = await storedRows(path);
  if (!held) return null;

  const body = queryList(path, held.rows, params, held.total);
  if (!body) return null;

  // The device holds `rows.length` of the backend's `total`. Say so whenever
  // the difference could change what the caller sees.
  const key = LIST_ENDPOINTS[path].key;
  const short = held.rows.length < held.total;
  if (short) {
    body.offline_partial = true;
    body.offline_rows_available = held.rows.length;
    body.offline_backend_total = held.total;
  }
  if (!body[key].length && body.page > 1) {
    body.offline_partial = true;
    body.offline_rows_available = held.rows.length;
    body.offline_backend_total = held.total;
  }
  return { body, cachedAt: held.cachedAt };
}

/** A single record, looked up in the rows stored for its list endpoint. */
async function detailFallback(listPath, id) {
  const spec = DETAIL_FROM_LIST[listPath];
  if (!spec) return null;
  const held = await storedRows(spec.list);
  if (!held) return null;
  const row = held.rows.find((r) => r?.[spec.idField] === id);
  if (!row) return null;
  return { body: row, cachedAt: held.cachedAt };
}

/**
 * Try to answer a failed GET from stored data.
 *
 * Returns `{ body, cachedAt }` or null when nothing stored can answer it —
 * in which case the caller's original error stands, because an unanswerable
 * read must stay unanswerable rather than resolve to an empty result that
 * reads as "there is nothing there".
 */
export async function offlineFallback(config) {
  if (!config || String(config.method || 'get').toLowerCase() !== 'get') return null;
  const path = splitPath(config.url);
  const params = config.params || {};

  if (LIST_ENDPOINTS[path]) return listFallback(path, params);

  for (const listPath of Object.keys(DETAIL_FROM_LIST)) {
    const prefix = `${listPath}/`;
    if (!path.startsWith(prefix)) continue;
    // /api/alerts/export is an endpoint, not an alert id.
    const id = decodeURIComponent(path.slice(prefix.length));
    if (!id || id === 'export') return null;
    return detailFallback(listPath, id);
  }
  return null;
}
