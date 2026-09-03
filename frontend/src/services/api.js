import axios from 'axios';
import { demoAdapter, isDemoMode } from './demoAdapter';

export const getApiBaseUrl = () => {
  return localStorage.getItem('CT_API_URL') || import.meta.env.VITE_API_URL || '';
};

export const setApiBaseUrl = (url) => {
  if (url) {
    localStorage.setItem('CT_API_URL', url.replace(/\/+$/, ''));
  } else {
    localStorage.removeItem('CT_API_URL');
  }
};

const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  // Demo mode is resolved per request rather than at module load, so toggling
  // it in Settings takes effect on the next call instead of the next reload.
  config.adapter = isDemoMode() ? demoAdapter : undefined;
  return config;
});

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

export default api;
