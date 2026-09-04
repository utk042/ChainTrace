import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { isDemoMode, setDemoMode } from '../../services/api';

/** "20 min ago" / "2026-09-04 12:14 UTC" — enough to judge staleness at a glance. */
function formatCachedAt(iso) {
  if (!iso) return 'an earlier session';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'an earlier session';
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'moments ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${then.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * One line across the top of the app when the session isn't a normal
 * connected one, naming the problem and the page that fixes it.
 */
export default function ConnectionBanner() {
  const { status, apiUrl, error, recheck, cachedAt, online } = useBackendStatus();
  const demo = isDemoMode();

  const enterDemo = () => { setDemoMode(true); window.location.reload(); };
  const leaveDemo = () => { setDemoMode(false); window.location.reload(); };

  if (demo) {
    return (
      <div className="conn-banner conn-banner-demo">
        <Icon name="layers" size={13} />
        <span>
          <b>Snapshot mode</b> — showing a stored run of the analysis pipeline
          over 4,970 synthetic transactions. Every score, alert and edge is real
          pipeline output, but nothing is live: ingestion and settings changes
          are disabled.
        </span>
        <div className="conn-banner-actions">
          <button onClick={leaveDemo}>Connect to a backend</button>
        </div>
      </div>
    );
  }

  // Reachable and current: nothing to say.
  if (status === 'checking' || status === 'ready') return null;

  // Serving what the service worker stored. The data is genuine backend
  // output, so the point of the banner is its age, not an error.
  if (status === 'offline') {
    return (
      <div className="conn-banner conn-banner-offline">
        <Icon name="cloudOff" size={13} />
        <span>
          <b>{online ? 'Backend unreachable' : 'Offline'}</b> — showing stored
          results from <b>{formatCachedAt(cachedAt)}</b>. This is real output
          from the last time the backend answered, not live state; anything
          ingested since is not here, and writes are unavailable until the
          connection returns.
        </span>
        <div className="conn-banner-actions">
          <button onClick={recheck}><Icon name="refresh" size={12} /> Retry</button>
          <Link to="/settings">Offline settings</Link>
        </div>
      </div>
    );
  }

  if (status === 'down') {
    return (
      <div className="conn-banner conn-banner-error">
        <Icon name={online ? 'alertTriangle' : 'wifiOff'} size={13} />
        <span>
          <b>{online ? 'Backend unreachable' : 'Offline — nothing stored yet'}</b> — {error}{' '}
          {online && (apiUrl
            ? <>Configured API URL: <code>{apiUrl}</code>.</>
            : <>No API URL is configured, so requests are going to this site's own domain. On a hosted build set <code>VITE_API_URL</code> at build time, or point this build at a backend in Settings.</>)}
        </span>
        <div className="conn-banner-actions">
          <button onClick={recheck}><Icon name="refresh" size={12} /> Retry</button>
          <button onClick={enterDemo}>Use snapshot</button>
          <Link to="/settings">Settings</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="conn-banner conn-banner-info">
      <Icon name="info" size={13} />
      <span>
        <b>No data ingested</b> — the backend is running but its database is
        empty. Generate a sample, upload a file, or fetch live blockchain data
        to populate it.
      </span>
      <div className="conn-banner-actions">
        <Link to="/ingest">Go to Ingest</Link>
      </div>
    </div>
  );
}
