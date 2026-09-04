import { useState, useEffect, useCallback } from 'react';
import { getAlerts, exportAlerts } from '../services/api';
import Icon from '../components/Icon';

const PAGE_SIZE = 20;

/** RFC 4180 quoting: a description with a comma or a quote must survive. */
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const CSV_COLUMNS = [
  ['alert_id', 'Alert ID'], ['entity_id', 'Entity ID'], ['entity_type', 'Entity type'],
  ['risk_tier', 'Risk tier'], ['confidence', 'Confidence'], ['model', 'Model'],
  ['status', 'Status'], ['description', 'Description'], ['timestamp', 'Timestamp'],
];

const rowsToCsv = (rows) => [
  CSV_COLUMNS.map(([, label]) => csvCell(label)).join(','),
  ...rows.map((row) => CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(',')),
].join('\r\n');

/** Hand a blob to the browser as a download, then release it. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Firefox ignores click() on an element outside the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    risk_tier: '', min_confidence: 0, search: '', sort_by: 'confidence', sort_order: 'desc',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportNote, setExportNote] = useState(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, page_size: PAGE_SIZE, ...filters };
      Object.keys(params).forEach(k => !params[k] && params[k] !== 0 && delete params[k]);
      const res = await getAlerts(params);
      setAlerts(res.data.alerts || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      // Silently swallowing this left an empty table that looked like a
      // clean result set rather than a failed request.
      setAlerts([]);
      setTotal(0);
      setError(e.response
        ? `The backend returned ${e.response.status} for /api/alerts.`
        : 'Could not reach the backend, and no stored copy of this query is available offline.');
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  /** Changing a filter invalidates the page number: page 3 of the old result
   *  set is usually past the end of the new one, which read as "no alerts". */
  const updateFilters = useCallback((update) => {
    setPage(1);
    setFilters(update);
  }, []);

  const handleExport = async () => {
    setExportNote(null);
    try {
      const res = await exportAlerts();
      saveBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), 'chaintrace_alerts.csv');
      return;
    } catch { /* no server-side export: build it here instead */ }

    // Snapshot mode and offline sessions have the rows but no export
    // endpoint. Export what is actually available and say what that was.
    try {
      const res = await getAlerts({ page: 1, page_size: 10000, ...filters });
      const rows = res.data?.alerts || [];
      if (!rows.length) { setExportNote('There is nothing to export.'); return; }
      saveBlob(new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'chaintrace_alerts.csv');
      setExportNote(`Exported ${rows.length.toLocaleString()} alerts from stored data — the backend's export endpoint was not reachable.`);
    } catch {
      setExportNote('Export failed: the backend is unreachable and no stored alerts are available.');
    }
  };

  const tiers = ['', 'Critical', 'High', 'Elevated'];

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Active Alerts <span className="count">{total.toLocaleString()}</span></h1>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={handleExport}><Icon name="download" size={13} /> Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-panel">
        <div className="filter-panel-title">Filters & Parameters</div>
        <div style={{ display: 'flex', gap: 'var(--space-xl)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>
              ENTITY SEARCH
            </label>
            <div className="search-bar" style={{ width: 220 }}>
              <Icon name="search" size={14} style={{ opacity: 0.5 }} />
              <input
                type="text" placeholder="TXID, Address, Cluster..."
                value={filters.search}
                onChange={e => updateFilters({ ...filters, search: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>
              RISK TIER
            </label>
            <div className="filter-group">
              {tiers.map(t => (
                <span
                  key={t || 'all'}
                  className={`filter-chip ${filters.risk_tier === t ? 'selected' : ''}`}
                  onClick={() => updateFilters({ ...filters, risk_tier: t })}
                >
                  {t ? (
                    <><span style={{ display: 'inline-block', width: 8, height: 8,
                      background: t === 'Critical' ? 'var(--accent-critical)' : t === 'High' ? 'var(--accent-high)' : 'var(--accent-elevated)',
                      marginRight: 4 }} />{t}</>
                  ) : 'All'}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>
              MIN CONFIDENCE
            </label>
            <div className="slider-control" style={{ width: 180 }}>
              <input
                type="range" min="0" max="100" step="5"
                value={filters.min_confidence}
                onChange={e => updateFilters({ ...filters, min_confidence: Number(e.target.value) })}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', width: 40 }}>
                {filters.min_confidence}%
              </span>
            </div>
          </div>

          <button className="btn btn-primary" onClick={fetchAlerts}>Apply Filters</button>
        </div>
      </div>

      {exportNote && (
        <div className="card" style={{ marginBottom: 'var(--space-lg)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {exportNote}
        </div>
      )}

      {/* Table */}
      {error ? (
        <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          <b style={{ color: 'var(--accent-critical)' }}>Could not load alerts.</b> {error}
        </div>
      ) : loading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Entity ID</th>
                  <th>Model</th>
                  <th>Confidence</th>
                  <th>Description</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {alerts.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-xl)' }}>
                      No alerts match these filters.
                    </td>
                  </tr>
                )}
                {alerts.map((alert) => (
                  <tr key={alert.alert_id}>
                    <td>
                      <Icon
                        name="alertTriangle"
                        size={15}
                        style={{
                          color: alert.risk_tier === 'Critical' ? 'var(--accent-critical)'
                            : alert.risk_tier === 'High' ? 'var(--accent-high)' : 'var(--accent-elevated)',
                        }}
                      />
                    </td>
                    <td>
                      <span className={`badge ${alert.risk_tier?.toLowerCase()}`}>
                        {alert.risk_tier}
                      </span>
                    </td>
                    <td className="mono">
                      {alert.entity_id?.length > 20
                        ? `${alert.entity_id.slice(0, 8)}...${alert.entity_id.slice(-6)}`
                        : alert.entity_id}
                    </td>
                    <td style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)' }}>
                      {alert.model}
                    </td>
                    <td>
                      <span style={{ color: alert.confidence >= 90 ? 'var(--accent-critical)' : alert.confidence >= 70 ? 'var(--accent-high)' : 'var(--accent-elevated)' }}>
                        {alert.confidence?.toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-sans)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {alert.description?.slice(0, 80)}{alert.description?.length > 80 ? '...' : ''}
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>
                      {alert.timestamp?.replace('T', ' ').slice(0, 19)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><Icon name="chevronLeft" size={13} /> Prev</button>
            <span className="page-info">Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <button disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next <Icon name="chevronRight" size={13} /></button>
          </div>
        </>
      )}
    </div>
  );
}
