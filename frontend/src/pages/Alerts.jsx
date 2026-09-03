import { useState, useEffect, useCallback } from 'react';
import { getAlerts, exportAlerts } from '../services/api';
import Icon from '../components/Icon';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    risk_tier: '', min_confidence: 0, search: '', sort_by: 'confidence', sort_order: 'desc',
  });
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20, ...filters };
      Object.keys(params).forEach(k => !params[k] && params[k] !== 0 && delete params[k]);
      const res = await getAlerts(params);
      setAlerts(res.data.alerts || []);
      setTotal(res.data.total || 0);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleExport = async () => {
    try {
      const res = await exportAlerts();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url;
      a.download = 'chaintrace_alerts.csv'; a.click();
    } catch (e) { console.error(e); }
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
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
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
                  onClick={() => setFilters(f => ({ ...f, risk_tier: t }))}
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
                onChange={e => setFilters(f => ({ ...f, min_confidence: Number(e.target.value) }))}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', width: 40 }}>
                {filters.min_confidence}%
              </span>
            </div>
          </div>

          <button className="btn btn-primary" onClick={fetchAlerts}>Apply Filters</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
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
            <span className="page-info">Page {page} of {Math.max(1, Math.ceil(total / 20))}</span>
            <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Next <Icon name="chevronRight" size={13} /></button>
          </div>
        </>
      )}
    </div>
  );
}
