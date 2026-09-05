import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardStats, isDemoMode } from '../../services/api';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import Icon from '../Icon';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatUTC(date) {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/** Connection states for the status pill. */
const CONNECTION = {
  checking: { label: 'CONNECTING', color: 'var(--accent-elevated)' },
  demo: { label: 'OFFLINE SNAPSHOT', color: 'var(--accent)' },
  ready: { label: 'CONNECTED · LIVE', color: 'var(--accent-green)' },
  empty: { label: 'CONNECTED · NO DATA', color: 'var(--accent-elevated)' },
  degraded: { label: 'CONNECTED · DB ERROR', color: 'var(--accent-critical)' },
  offline: { label: 'OFFLINE · STORED DATA', color: 'var(--accent-elevated)' },
  down: { label: 'BACKEND OFFLINE', color: 'var(--accent-critical)' },
};

export default function TopBar() {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [query, setQuery] = useState('');
  const { status: liveStatus } = useBackendStatus();
  const navigate = useNavigate();
  // Snapshot mode answers /api/health from bundled data, which would
  // otherwise report a healthy backend that isn't there.
  const status = isDemoMode() ? 'demo' : liveStatus;
  const connection = CONNECTION[status] || CONNECTION.checking;
  const now = useClock();

  // Refetched whenever the backend's state changes, not once on mount: the
  // counters used to be read a single time and, if that read failed, every
  // figure stayed as an em dash for the life of the page — beside pages that
  // were listing thousands of rows from the same backend.
  useEffect(() => {
    if (status === 'checking') return undefined;
    let cancelled = false;
    getDashboardStats()
      .then((res) => { if (!cancelled) { setStats(res.data); setStatsError(null); } })
      .catch((e) => {
        if (cancelled) return;
        setStats(null);
        setStatsError(e.response ? `stats: HTTP ${e.response.status}` : 'stats unavailable');
      });
    return () => { cancelled = true; };
  }, [status]);

  // The graph explorer is the one view that resolves an arbitrary identifier
  // — address, txid or IP — so global search hands off to it.
  const runSearch = (event) => {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    navigate(`/graph?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-meta">
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">TXNS</span>
            <span className="topbar-meta-value">
              {stats?.total_transactions?.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">Wallets</span>
            <span className="topbar-meta-value">
              {stats?.total_wallets?.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">IPs</span>
            <span className="topbar-meta-value">
              {stats?.total_ips?.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">Flagged</span>
            <span className="topbar-meta-value" style={{ color: stats?.flagged_entities > 0 ? 'var(--accent-critical)' : undefined }}>
              {stats?.flagged_entities?.toLocaleString() ?? '—'}
            </span>
          </div>
        </div>
        {/* An em dash for every counter reads as "nothing ingested". When the
            figures are missing because the request failed, say so. */}
        {statsError && (
          <span
            className="topbar-meta-label"
            style={{ color: 'var(--accent-critical)' }}
            title="The dashboard statistics request failed; the counters above are unknown, not zero."
          >
            {statsError}
          </span>
        )}
        <div className="topbar-status" style={{ color: connection.color }}>
          <span className="pulse-dot" style={{ background: connection.color }} />
          {connection.label}
        </div>
      </div>

      <div className="topbar-right">
        <span className="topbar-clock">{formatUTC(now)}</span>
        <form className="search-bar" style={{ width: 220 }} onSubmit={runSearch} role="search">
          <Icon name="search" size={14} style={{ opacity: 0.5 }} />
          <input
            type="search"
            placeholder="Search entity, hash, IP..."
            aria-label="Search the entity graph"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      </div>
    </div>
  );
}
