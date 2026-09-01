import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
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
export const getSubgraph = (entityId, hops = 2) => api.get(`/api/graph/subgraph/${entityId}?hops=${hops}`);
export const getGraphStats = () => api.get('/api/graph/stats');
export const getClusters = () => api.get('/api/graph/clusters');
export const searchGraph = (q) => api.get(`/api/graph/search?q=${q}`);

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

// ─── Settings ────────────────────────────────────────────────
export const getSettings = () => api.get('/api/settings');
export const updateSettings = (updates) => api.put('/api/settings', updates);
export const resetSettings = () => api.post('/api/settings/reset');
export const purgeCache = () => api.post('/api/settings/purge-cache');

export default api;
