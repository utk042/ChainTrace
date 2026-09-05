import axios from 'axios';
import { demoAdapter, isDemoMode } from './demoAdapter';
import { offlineFallback, clearOfflineMemo } from './offlineFallback';

export const getApiBaseUrl = () => {
  try {
    const stored = localStorage.getItem('CT_API_URL');
    if (stored) return stored;
  } catch { /* storage unavailable (private mode) — fall through */ }
  return import.meta.env.VITE_API_URL || '';
};

export const setApiBaseUrl = (url) => {
  try {
    if (url) localStorage.setItem('CT_API_URL', url.replace(/\/+$/, ''));
    else localStorage.removeItem('CT_API_URL');
  } catch { /* ignore */ }
};

const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  // Resolved per request, so toggling it in Settings takes effect on the
  // next call rather than the next reload.
  config.adapter = isDemoMode() ? demoAdapter : undefined;
  return config;
});

// ─── Data provenance ─────────────────────────────────────────────
//
// The service worker serves the last stored copy of a GET when the backend
// cannot be reached, and stamps it with when it was fetched. A forensic tool
// must never let that pass for the live state, so every response records
// where it came from and the UI reads it back from here.

const provenanceListeners = new Set();

let provenance = { source: 'unknown', cachedAt: null, at: null };

export const getProvenance = () => provenance;

export function subscribeProvenance(fn) {
  provenanceListeners.add(fn);
  return () => provenanceListeners.delete(fn);
}

function setProvenance(next) {
  provenance = next;
  provenanceListeners.forEach((fn) => { try { fn(next); } catch { /* listener's problem */ } });
}

api.interceptors.response.use(
  (response) => {
    // Synthesised by the service worker, so the header survives CORS.
    const hit = response.headers?.['x-chaintrace-cache'] === 'hit';
    const cachedAt = response.headers?.['x-chaintrace-cached-at'] || null;
    response.fromCache = hit;
    response.cachedAt = hit ? cachedAt : null;
    // The backend answered, so anything the offline path is holding is now
    // the older copy of two.
    if (!hit) clearOfflineMemo();
    setProvenance({
      source: isDemoMode() ? 'snapshot' : hit ? 'cache' : 'live',
      cachedAt: response.cachedAt,
      at: new Date().toISOString(),
    });
    return response;
  },
  async (error) => {
    // A response — 404, 500, anything the backend actually said — is an
    // answer, and stored data must never be used to paper over it. Only a
    // read that never reached a server falls back.
    if (error.response || isDemoMode()) return Promise.reject(error);

    let fallback = null;
    try { fallback = await offlineFallback(error.config); } catch { /* no worker */ }
    if (!fallback) return Promise.reject(error);

    const response = {
      data: fallback.body,
      status: 200,
      statusText: 'OK (stored)',
      headers: {
        'x-chaintrace-cache': 'hit',
        'x-chaintrace-cached-at': fallback.cachedAt || '',
      },
      config: error.config,
      request: error.request,
      fromCache: true,
      cachedAt: fallback.cachedAt || null,
    };
    setProvenance({
      source: 'cache',
      cachedAt: response.cachedAt,
      at: new Date().toISOString(),
    });
    return response;
  },
);

// ─── Dashboard ───────────────────────────────────────────────
export const getDashboardStats = () => api.get('/api/dashboard/stats');
export const getTimeline = (interval = 'day') => api.get(`/api/dashboard/timeline?interval=${interval}`);
export const getRiskDistribution = () => api.get('/api/dashboard/risk-distribution');
export const getTopAlerts = (limit = 5) => api.get(`/api/dashboard/top-alerts?limit=${limit}`);

// ─── Alerts ──────────────────────────────────────────────────
export const getAlerts = (params = {}) => api.get('/api/alerts', { params });
export const getAlertDetail = (id) => api.get(`/api/alerts/${id}`);
export const exportAlerts = () => api.get('/api/alerts/export', { responseType: 'blob' });
export const updateAlertStatus = (id, status) => api.put(`/api/alerts/${id}/status?new_status=${status}`);

// ─── Graph ───────────────────────────────────────────────────
export const getGraphData = (params = {}) => api.get('/api/graph/data', { params });
export const getSubgraph = (entityId, hops = 2) =>
  api.get(`/api/graph/subgraph/${encodeURIComponent(entityId)}`, { params: { hops } });
export const getGraphStats = () => api.get('/api/graph/stats');
export const getClusters = () => api.get('/api/graph/clusters');
export const searchGraph = (q, params = {}) =>
  api.get('/api/graph/search', { params: { q, ...params } });
export const getNodeDetail = (entityId) =>
  api.get(`/api/graph/node/${encodeURIComponent(entityId)}`);
export const getNeighbors = (entityId, limit = 60) =>
  api.get(`/api/graph/neighbors/${encodeURIComponent(entityId)}`, { params: { limit } });
export const findPath = (source, target) =>
  api.get('/api/graph/path', { params: { source, target } });

// ─── Health ──────────────────────────────────────────────────
export const getHealth = () => api.get('/api/health', { timeout: 15000 });

// ─── Wallets ─────────────────────────────────────────────────
export const getWallets = (params = {}) => api.get('/api/wallets', { params });
export const getWalletDetail = (address) => api.get(`/api/wallets/${address}`);

// ─── Transactions ────────────────────────────────────────────
export const getTransactions = (params = {}) => api.get('/api/transactions', { params });
export const getTransactionDetail = (txid) => api.get(`/api/transactions/${txid}`);

// ─── Ingest ──────────────────────────────────────────────────
export const uploadFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/api/ingest/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
export const runPipeline = (params = {}) => api.post('/api/ingest/run', null, { params });
export const getPipelineStatus = () => api.get('/api/ingest/status');
export const getPipelineLogs = (runId = null, limit = 300) =>
  api.get('/api/ingest/logs', { params: { ...(runId ? { run_id: runId } : {}), limit } });
export const getServerLogs = (limit = 200) => api.get('/api/logs', { params: { limit } });
export const generateSampleData = (count = 5000) => api.post(`/api/ingest/generate-sample?count=${count}`);
export const fetchRealData = (maxTransactions = 500, maxBlocks = 10) =>
  api.post(`/api/ingest/fetch-real?max_transactions=${maxTransactions}&max_blocks=${maxBlocks}`, null, { timeout: 300000 });

// ─── Settings ────────────────────────────────────────────────
export const getSettings = () => api.get('/api/settings');
export const updateSettings = (updates) => api.put('/api/settings', updates);
export const resetSettings = () => api.post('/api/settings/reset');
export const purgeCache = () => api.post('/api/settings/purge-cache');

// ─── Seed / Watchlist Wallets (risk propagation) ────────────────
export const getSeedWallets = () => api.get('/api/settings/seed-wallets');
export const addSeedWallet = (address, label = '') =>
  api.post(`/api/settings/seed-wallets?address=${encodeURIComponent(address)}&label=${encodeURIComponent(label)}`);
export const removeSeedWallet = (address) =>
  api.delete(`/api/settings/seed-wallets/${encodeURIComponent(address)}`);

export { isDemoMode, setDemoMode, preloadSnapshot } from './demoAdapter';

/**
 * How many rows of each table to pull down for offline use. High enough to
 * hold the datasets this tool is built for whole, and bounded by the
 * routers' own `page_size` ceiling of 10,000.
 */
export const OFFLINE_TABLE_ROWS = 5000;

/**
 * The reads worth having stored before going offline: everything a first
 * pass over a case touches. Used by Settings -> "Save for offline".
 */
export const OFFLINE_PREFETCH_PATHS = [
  '/api/health',
  '/api/dashboard/stats',
  '/api/dashboard/timeline?interval=day',
  '/api/dashboard/risk-distribution',
  '/api/dashboard/top-alerts?limit=5',
  // Whole tables, not the first page of each. The worker keys entries by
  // their exact URL, so a stored `page_size=20` answered exactly one of the
  // views the app can ask for and every other page, sort or filter came back
  // as "not stored" on a device that had the rows. Pulling the tables once
  // lets services/offlineFallback.js cut any of those views locally.
  `/api/alerts?page=1&page_size=${OFFLINE_TABLE_ROWS}&sort_by=confidence&sort_order=desc`,
  `/api/wallets?page=1&page_size=${OFFLINE_TABLE_ROWS}&sort_by=anomaly_score&sort_order=desc`,
  `/api/transactions?page=1&page_size=${OFFLINE_TABLE_ROWS}&sort_by=timestamp&sort_order=desc`,
  // Also the exact first view of each table, so the default page is an
  // outright cache hit rather than a re-slice.
  '/api/alerts?page=1&page_size=25&sort_by=confidence&sort_order=desc',
  '/api/wallets?page=1&page_size=25&sort_by=anomaly_score&sort_order=desc',
  '/api/transactions?page=1&page_size=25&sort_by=timestamp&sort_order=desc',
  // Param order matters for the same reason: axios serialises the object it
  // is given, and this is the order the Graph Explorer sends.
  '/api/graph/data?layout=spring&max_nodes=1500',
  '/api/graph/stats',
  '/api/graph/clusters',
  '/api/ingest/status',
  '/api/settings',
  '/api/settings/seed-wallets',
];

/**
 * Absolute URLs for the above, joined the way axios joins them, so the
 * prefetched entries land under the exact cache keys the app will look up.
 */
export const offlinePrefetchUrls = () => {
  const base = (getApiBaseUrl() || window.location.origin).replace(/\/+$/, '');
  return OFFLINE_PREFETCH_PATHS.map((path) => `${base}${path}`);
};

export default api;
