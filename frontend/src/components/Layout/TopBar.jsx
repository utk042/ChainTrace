import { useState, useEffect } from 'react';
import { getDashboardStats } from '../../services/api';

export default function TopBar({ onToggleSidebar }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getDashboardStats().then(res => setStats(res.data)).catch(() => {});
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-btn"
          onClick={onToggleSidebar}
          aria-label="Open menu"
        >
          ☰
        </button>
        <div className="topbar-meta">
          <div className="topbar-meta-item">
            <span className="topbar-meta-label">Dataset</span>
            <span className="topbar-meta-value">
              {stats ? `${stats.total_transactions.toLocaleString()} TX` : '—'}
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
      </div>

      <div className="topbar-right">
        <div className="search-bar" style={{ width: 240 }}>
          <span style={{ opacity: 0.4 }}>🔍</span>
          <input type="text" placeholder="Search entity, hash, IP..." />
        </div>
      </div>
    </div>
  );
}
