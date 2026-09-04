import { Link } from 'react-router-dom';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { isDemoMode, setDemoMode } from '../../services/api';

/**
 * One line when the session isn't a normal connected one: what is wrong,
 * and the control that fixes it. Nothing else.
 */
export default function ConnectionBanner() {
  const { status, apiUrl, error, recheck } = useBackendStatus();
  const demo = isDemoMode();

  const enterDemo = () => { setDemoMode(true); window.location.reload(); };
  const leaveDemo = () => { setDemoMode(false); window.location.reload(); };

  if (demo) {
    return (
      <div className="conn-banner">
        <span>Stored snapshot. Ingestion and settings are read-only.</span>
        <div className="conn-banner-actions">
          <button onClick={leaveDemo}>Connect a backend</button>
        </div>
      </div>
    );
  }

  if (status === 'checking' || status === 'ready') return null;

  if (status === 'down') {
    return (
      <div className="conn-banner conn-banner-error">
        <span>No backend at {apiUrl || 'this origin'} — {error}</span>
        <div className="conn-banner-actions">
          <button onClick={recheck}>Retry</button>
          <button onClick={enterDemo}>Use snapshot</button>
          <Link to="/settings">Settings</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="conn-banner">
      <span>Database is empty.</span>
      <div className="conn-banner-actions">
        <Link to="/ingest">Ingest data</Link>
      </div>
    </div>
  );
}
