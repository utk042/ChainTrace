import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { isDemoMode, setDemoMode } from '../../services/api';

/**
 * One line across the top of the app when the session isn't a normal
 * connected one, naming the problem and the page that fixes it.
 */
export default function ConnectionBanner() {
  const { status, apiUrl, error, recheck } = useBackendStatus();
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

  if (status === 'checking' || status === 'ready') return null;

  if (status === 'down') {
    return (
      <div className="conn-banner conn-banner-error">
        <Icon name="alertTriangle" size={13} />
        <span>
          <b>Backend unreachable</b> — {error}{' '}
          {apiUrl
            ? <>Configured API URL: <code>{apiUrl}</code>.</>
            : <>No API URL is configured, so requests are going to this site's own domain. On a hosted build set <code>VITE_API_URL</code> at build time, or point this build at a backend in Settings.</>}
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
