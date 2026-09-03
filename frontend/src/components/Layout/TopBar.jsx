import { useState, useEffect } from 'react';
import { getDashboardStats } from '../../services/api';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { isDemoMode } from '../../services/api';
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
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * The status pill previously read "OFFLINE MODE" unconditionally — a design
 * statement about the product, not a report of anything. It now says whether
 * this frontend is actually talking to a backend, which is the one thing a
 * blank-looking deployment needs it to say.
 */
const CONNECTION = {
  checking: { label: 'CONNECTING', color: 'var(--accent-elevated)' },
  demo: { label: 'OFFLINE SNAPSHOT', color: 'var(--accent-purple)' },
  ready: { label: 'CONNECTED · LOCAL', color: 'var(--accent-green)' },
  empty: { label: 'CONNECTED · NO DATA', color: 'var(--accent-elevated)' },
  down: { label: 'BACKEND OFFLINE', color: 'var(--accent-critical)' },
};

export default function TopBar() {
  const [stats, setStats] = useState(null);
  const { status: liveStatus } = useBackendStatus();
  // Snapshot mode answers /api/health from bundled data, so the live check
  // would otherwise report a healthy backend that isn't there.
  const status = isDemoMode() ? 'demo' : liveStatus;
  const now = useClock();

  useEffect(() => {
    getDashboardStats().then(res => setStats(res.data)).catch(() => {});
  }, []);

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
        <div className="topbar-status" style={{ color: CONNECTION[status].color }}>
          <span className="pulse-dot" style={{ background: CONNECTION[status].color }} />
          {CONNECTION[status].label}
        </div>
      </div>

      <div className="topbar-right">
        <span className="topbar-clock">{formatUTC(now)}</span>
        <div className="search-bar" style={{ width: 220 }}>
          <Icon name="search" size={14} style={{ opacity: 0.5 }} />
          <input type="text" placeholder="Search entity, hash, IP..." />
        </div>
      </div>
    </div>
  );
}
