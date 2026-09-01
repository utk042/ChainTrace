import { useState, useEffect } from 'react';
import { getDashboardStats } from '../../services/api';

export default function StatusBar() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getDashboardStats().then(res => setStats(res.data)).catch(() => {});
  }, []);

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>System: {stats?.system_health || 'CONNECTING...'}</span>
        <span>|</span>
        <span>Model: {stats?.model_name || '—'}</span>
        <span>|</span>
        <span>Flagged: {stats?.flagged_entities?.toLocaleString() || '0'}</span>
      </div>
      <div className="statusbar-right">
        <span>Documentation</span>
        <span>API Status</span>
        <span>Support</span>
      </div>
    </div>
  );
}
