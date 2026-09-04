import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardStats, getApiBaseUrl, isDemoMode } from '../../services/api';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { formatCachedAt } from './ConnectionBanner';

/** How the analysis backend is currently answering, in one word. */
function sourceLabel(status, demo) {
  if (demo) return { text: 'SNAPSHOT', color: 'var(--accent)' };
  if (status === 'down') return { text: 'UNREACHABLE', color: 'var(--accent-critical)' };
  if (status === 'offline') return { text: 'STORED', color: 'var(--accent-elevated)' };
  if (status === 'checking') return { text: 'CONNECTING…', color: 'var(--text-tertiary)' };
  return { text: 'LIVE', color: 'var(--accent-green)' };
}

export default function StatusBar() {
  const [stats, setStats] = useState(null);
  const { status, health, cachedAt } = useBackendStatus();
  const demo = isDemoMode();
  const source = sourceLabel(status, demo);
  const apiUrl = getApiBaseUrl();

  useEffect(() => {
    getDashboardStats().then((res) => setStats(res.data)).catch(() => {});
  }, []);

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>DATA <b style={{ color: source.color }}>{source.text}</b></span>
        {status === 'offline' && cachedAt && (
          <>
            <span className="topbar-sep">|</span>
            <span title={cachedAt}>AS OF {formatCachedAt(cachedAt).toUpperCase()}</span>
          </>
        )}
        <span className="topbar-sep">|</span>
        <span>MODEL {stats?.model_name || '—'}</span>
        {health?.light_mode && (
          <>
            <span className="topbar-sep">|</span>
            <span title="Low-memory analysis backends are active (CT_LIGHT_MODE)">
              PROFILE <b style={{ color: 'var(--accent-elevated)' }}>LIGHT</b>
            </span>
          </>
        )}
        <span className="topbar-sep">|</span>
        <span>FLAGGED {stats?.flagged_entities?.toLocaleString() || '0'}</span>
      </div>
      <div className="statusbar-right">
        {/* Real destinations only. Three inert words styled as links is worse
            than no links: it reads as a broken build. */}
        {apiUrl && !demo && (
          <a href={`${apiUrl.replace(/\/+$/, '')}/docs`} target="_blank" rel="noreferrer">API reference</a>
        )}
        <Link to="/settings">Offline &amp; connection</Link>
      </div>
    </div>
  );
}
