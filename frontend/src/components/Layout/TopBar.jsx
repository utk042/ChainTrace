import { useState, useEffect } from 'react';
import { getDashboardStats } from '../../services/api';

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

export default function TopBar() {
  const [stats, setStats] = useState(null);
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
              {stats ? stats.total_transactions.toLocaleString() : '—'}
            </span>
          </div>
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">Wallets</span>
            <span className="topbar-meta-value">
              {stats ? stats.total_wallets.toLocaleString() : '—'}
            </span>
          </div>
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">IPs</span>
            <span className="topbar-meta-value">
              {stats ? stats.total_ips.toLocaleString() : '—'}
            </span>
          </div>
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">Flagged</span>
            <span className="topbar-meta-value" style={{ color: stats?.flagged_entities > 0 ? 'var(--accent-critical)' : undefined }}>
              {stats ? stats.flagged_entities.toLocaleString() : '—'}
            </span>
          </div>
        </div>
        <div className="topbar-status" style={{ color: 'var(--accent-elevated)' }}>
          <span className="pulse-dot" style={{ background: 'var(--accent-elevated)' }} />
          OFFLINE MODE
        </div>
      </div>

      <div className="topbar-right">
        <span className="topbar-clock">{formatUTC(now)}</span>
        <div className="search-bar" style={{ width: 220 }}>
          <span style={{ opacity: 0.4 }}>⌕</span>
          <input type="text" placeholder="Search entity, hash, IP..." />
        </div>
      </div>
    </div>
  );
}
