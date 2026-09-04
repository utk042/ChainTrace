import { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import {
  swSupported, isControlled, getCacheStatus, clearApiCache, prefetchApi,
} from '../services/offline';
import { offlinePrefetchUrls, isDemoMode } from '../services/api';
import { useOnline } from '../hooks/useOnline';

const formatBytes = (bytes) => {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
};

const formatStamp = (iso) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
};

/**
 * Offline installation and stored-data controls.
 *
 * The app is offline-first whether or not anyone opens this panel — the
 * service worker precaches the interface on the first visit. What this adds
 * is the deliberate part: pulling a case's data down before losing the
 * network, seeing exactly what is stored, and clearing it afterwards.
 * Stored backend responses are case material, so removing them is an
 * explicit action and never silent housekeeping.
 */
export default function OfflinePanel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const online = useOnline();
  const demo = isDemoMode();

  const refresh = useCallback(async () => {
    if (!isControlled()) { setStatus(null); return; }
    try { setStatus(await getCacheStatus()); } catch { setStatus(null); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Chrome fires this when the app qualifies for installation; holding the
  // event lets the button live here instead of in the browser's own menu.
  useEffect(() => {
    const onPrompt = (event) => { event.preventDefault(); setInstallPrompt(event); };
    const onInstalled = () => { setInstallPrompt(null); setMessage('ChainTrace is installed.'); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    setInstallPrompt(null);
  };

  const saveForOffline = async () => {
    setBusy('prefetch');
    setMessage(null);
    try {
      const result = await prefetchApi(offlinePrefetchUrls());
      setMessage(
        result.failed?.length
          ? `Stored ${result.stored} of ${result.stored + result.failed.length} datasets. The rest did not answer.`
          : `Stored ${result.stored} datasets for offline use.`,
      );
      await refresh();
    } catch (e) {
      setMessage(`Could not store data: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const clearStored = async () => {
    setBusy('clear');
    setMessage(null);
    try {
      await clearApiCache();
      setMessage('Stored backend responses cleared. The interface itself stays available offline.');
      await refresh();
    } catch (e) {
      setMessage(`Could not clear stored data: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!swSupported()) {
    return (
      <div className="settings-section" style={{ marginBottom: 'var(--space-xl)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-md)' }}>Offline Availability</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          Offline support needs a service worker, which browsers only allow over
          HTTPS or on localhost. This page is served over an insecure origin, so
          the interface will not be available without a network. The bundled
          snapshot below still works, and so does the single-file build
          (<code>npm run build:standalone</code>).
        </p>
      </div>
    );
  }

  const installed = isControlled();

  return (
    <div className="settings-section" style={{ marginBottom: 'var(--space-xl)' }}>
      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 4 }}>Offline Availability</h2>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-lg)', lineHeight: 1.6 }}>
        The interface — every page, chart and font — is stored on this device
        the first time it loads, so it opens with no network at all. Backend
        results are stored as you read them and shown with the time they were
        fetched; they are never presented as live.
      </p>

      <div className="offline-grid">
        <div className="offline-stat">
          <div className="offline-stat-label">Interface</div>
          <div className="offline-stat-value" style={{ color: installed ? 'var(--accent-green)' : 'var(--accent-elevated)' }}>
            {installed ? 'Available offline' : 'Installing…'}
          </div>
          <div className="offline-stat-sub">{status ? `${status.shellEntries} files` : 'first visit'}</div>
        </div>
        <div className="offline-stat">
          <div className="offline-stat-label">Stored responses</div>
          <div className="offline-stat-value">{status ? status.apiEntries : '—'}</div>
          <div className="offline-stat-sub">newest {formatStamp(status?.newestApi)}</div>
        </div>
        <div className="offline-stat">
          <div className="offline-stat-label">On-device storage</div>
          <div className="offline-stat-value">{formatBytes(status?.usage)}</div>
          <div className="offline-stat-sub">build {status?.buildId || '—'}</div>
        </div>
        <div className="offline-stat">
          <div className="offline-stat-label">Network</div>
          <div className="offline-stat-value" style={{ color: online ? 'var(--accent-green)' : 'var(--accent-elevated)' }}>
            {online ? 'Connected' : 'Offline'}
          </div>
          <div className="offline-stat-sub">{online ? 'live reads preferred' : 'reading from storage'}</div>
        </div>
      </div>

      {message && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md)' }}>
          {message}
        </p>
      )}

      <div className="settings-row">
        <div className="settings-row-info">
          <h3>Save current data for offline use</h3>
          <p>
            Fetches the dashboard, alerts, wallets, transactions and graph in one
            pass and stores them, so they are there after the connection goes.
            Do this before leaving a connected network.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={saveForOffline}
          disabled={busy !== null || !installed || !online || demo}
          title={demo ? 'Snapshot mode reads bundled data; there is nothing to fetch.'
            : !online ? 'Needs a connection.' : undefined}
        >
          {busy === 'prefetch' ? 'Storing…' : <><Icon name="boxDown" size={13} /> Save for offline</>}
        </button>
      </div>

      {installPrompt && (
        <div className="settings-row">
          <div className="settings-row-info">
            <h3>Install as an application</h3>
            <p>Runs in its own window with no browser chrome, and launches from the desktop.</p>
          </div>
          <button className="btn btn-secondary" onClick={install}>
            <Icon name="download" size={13} /> Install ChainTrace
          </button>
        </div>
      )}

      <div className="settings-row" style={{ borderBottom: 'none' }}>
        <div className="settings-row-info">
          <h3>Clear stored backend responses</h3>
          <p>
            Removes the cached results only. The interface stays available
            offline, and nothing on the backend is touched.
          </p>
        </div>
        <button className="btn btn-outline" onClick={clearStored} disabled={busy !== null || !installed}>
          {busy === 'clear' ? 'Clearing…' : <><Icon name="trash" size={13} /> Clear stored data</>}
        </button>
      </div>
    </div>
  );
}
