import { useEffect, useState } from 'react';
import { useSession } from '../../state/SessionProvider';
import { fmtInt, fmtRelative } from '../../services/format';

/** Connection states, with the colour each one is allowed to use. */
const CONNECTION = {
  checking: { label: 'CONNECTING', color: 'var(--text-tertiary)' },
  demo: { label: 'SNAPSHOT', color: 'var(--accent)' },
  ready: { label: 'CONNECTED', color: 'var(--status-ok)' },
  empty: { label: 'CONNECTED · NO DATA', color: 'var(--risk-elevated)' },
  degraded: { label: 'DATABASE ERROR', color: 'var(--risk-critical)' },
  stale: { label: 'BACKEND OUT OF DATE', color: 'var(--risk-critical)' },
  offline: { label: 'OFFLINE · STORED DATA', color: 'var(--risk-elevated)' },
  down: { label: 'BACKEND OFFLINE', color: 'var(--risk-critical)' },
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The bottom band: connection, the counters describing the loaded dataset,
 * and a UTC clock.
 *
 * Timestamps in this tool are UTC throughout, so the clock is too — reading
 * a local time next to a UTC event log is how an hour goes missing from a
 * timeline.
 */
export default function StatusBar() {
  const { status, stats, statsError, statsLoading, provenance, demo } = useSession();
  const now = useClock();
  const connection = CONNECTION[status] || CONNECTION.checking;

  const counters = [
    ['TXNS', stats?.total_transactions],
    ['WALLETS', stats?.total_wallets],
    ['IPS', stats?.total_ips],
    ['CLUSTERS', stats?.clusters_detected],
  ];

  return (
    <footer className="statusbar">
      <span className="statusbar-group" style={{ color: connection.color }} title={
        demo
          ? 'Reading a bundled snapshot. No backend is attached.'
          : status === 'ready'
            ? 'The backend answered its last health check.'
            : 'See the banner at the top of the workspace for what to do about this.'
      }>
        <span className="pulse-dot" style={{ background: connection.color }} />
        {connection.label}
      </span>

      {counters.map(([label, value]) => (
        <span className="statusbar-group" key={label}>
          <span className="statusbar-label">{label}</span>
          <span className="statusbar-value">
            {statsLoading && value === undefined ? '…' : fmtInt(value)}
          </span>
        </span>
      ))}

      {stats?.total_alerts > 0 && (
        <span className="statusbar-group" style={{ color: 'var(--risk-critical)' }}>
          <span className="statusbar-label">Alerts</span>
          <span className="statusbar-value" style={{ color: 'inherit' }}>
            {fmtInt(stats.total_alerts)}
          </span>
        </span>
      )}

      {/* An em dash on every counter would otherwise read as "nothing
          ingested" when in fact the request failed. */}
      {statsError && (
        <span className="statusbar-group" style={{ color: 'var(--risk-critical)' }} title={statsError}>
          counters unavailable
        </span>
      )}

      <span className="statusbar-spacer" />

      {provenance.cachedAt && (
        <span className="statusbar-group" title={`Stored copy fetched ${provenance.cachedAt}`}>
          <span className="statusbar-label">Stored</span>
          <span className="statusbar-value">{fmtRelative(provenance.cachedAt)}</span>
        </span>
      )}

      <span className="statusbar-clock" title="All timestamps in this tool are UTC">
        {now.toISOString().replace('T', ' ').slice(0, 19)} UTC
      </span>
    </footer>
  );
}
