import { useState, useEffect } from 'react';
import { getDashboardStats } from '../../services/api';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { isDemoMode } from '../../services/api';

export default function StatusBar() {
  const [stats, setStats] = useState(null);
  const { status, health } = useBackendStatus();

  useEffect(() => {
    getDashboardStats().then(res => setStats(res.data)).catch(() => {});
  }, []);

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>SYSTEM <b style={{
          color: status === 'down' ? 'var(--accent-critical)'
            : isDemoMode() ? 'var(--accent-purple)' : 'var(--accent-green)',
        }}>
          {status === 'down' ? 'UNREACHABLE'
            : isDemoMode() ? 'SNAPSHOT'
            : stats?.system_health || 'CONNECTING...'}
        </b></span>
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
        <span>Documentation</span>
        <span>API Status</span>
        <span>Support</span>
      </div>
    </div>
  );
}
