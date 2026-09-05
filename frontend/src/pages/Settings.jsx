import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getSettings, updateSettings, resetSettings, purgeCache,
  getSeedWallets, addSeedWallet, removeSeedWallet,
  getApiBaseUrl, setApiBaseUrl, setDemoMode,
} from '../services/api';
import { useSession } from '../state/SessionProvider';
import { useCommands } from '../services/commands';
import { fmtInt, fmtTimestamp } from '../services/format';
import Icon from '../components/Icon';
import OfflinePanel from '../components/OfflinePanel';
import Panel from '../components/ui/Panel';
import CopyButton from '../components/ui/CopyButton';
import { Notice, Loading } from '../components/ui/States';

const SECTIONS = [
  { id: 'thresholds', label: 'Forensic thresholds', icon: 'sliders' },
  { id: 'watchlist', label: 'Seed watchlist', icon: 'flag' },
  { id: 'offline', label: 'Offline & data', icon: 'cloudOff' },
  { id: 'system', label: 'System', icon: 'database' },
];

/** A labelled setting row: description on the left, its control on the right. */
function Row({ title, children, control, last = false }) {
  return (
    <div className="settings-row" style={last ? { borderBottom: 'none' } : undefined}>
      <div className="settings-row-info">
        <h3>{title}</h3>
        {children && <p>{children}</p>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

/**
 * Configuration, with a bottom action bar that stays put — the Gotham
 * pattern of keeping the commit action visible however far the form scrolls.
 *
 * Everything here writes to the backend, so the bar reports whether there is
 * anything to write and refuses rather than pretending when the session has
 * no backend attached.
 */
export default function Settings() {
  const { backend, demo, status } = useSession();
  const { health, recheck } = backend;

  const [section, setSection] = useState('thresholds');
  const [settings, setSettings] = useState({});
  const [savedSettings, setSavedSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const [seedWallets, setSeedWallets] = useState([]);
  const [newSeedAddress, setNewSeedAddress] = useState('');
  const [newSeedLabel, setNewSeedLabel] = useState('');
  const [seedError, setSeedError] = useState(null);

  const [apiUrl, setApiUrl] = useState(getApiBaseUrl() || '');

  const notify = useCallback((kind, text) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const loadSettings = useCallback(() => {
    setLoading(true);
    getSettings()
      .then((res) => { setSettings(res.data); setSavedSettings(res.data); })
      .catch(() => notify('error', 'The backend did not return its configuration.'))
      .finally(() => setLoading(false));
  }, [notify]);

  const fetchSeedWallets = useCallback(() => {
    getSeedWallets().then((res) => setSeedWallets(res.data || [])).catch(() => setSeedWallets([]));
  }, []);

  useEffect(() => { loadSettings(); fetchSeedWallets(); }, [loadSettings, fetchSeedWallets]);

  useCommands({ reload: () => { loadSettings(); fetchSeedWallets(); recheck(); } });

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings],
  );

  const field = (key, fallback) => (settings[key] ?? fallback);
  const updateField = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(settings);
      setSavedSettings(settings);
      notify('ok', 'Configuration saved to the backend.');
    } catch (e) {
      notify('error', e.response?.data?.error || 'The backend refused the configuration change.');
    } finally {
      setSaving(false);
    }
  };

  /** Local-only: reverts the form to the stored values, changes nothing. */
  const handleDiscard = () => {
    setSettings(savedSettings);
    notify('info', 'Unsaved changes discarded.');
  };

  /**
   * Writes the factory defaults to the backend. This used to be wired to a
   * button labelled "Discard changes", which quietly overwrote an operator's
   * whole configuration when they meant to undo one slider.
   */
  const handleReset = async () => {
    if (!window.confirm(
      'Reset every forensic threshold on the backend to its factory default?\n\n'
      + 'This overwrites the saved configuration for all users of this backend '
      + 'and cannot be undone.',
    )) return;
    try {
      const res = await resetSettings();
      setSettings(res.data.settings);
      setSavedSettings(res.data.settings);
      notify('ok', 'Thresholds reset to their defaults.');
    } catch {
      notify('error', 'The reset was refused by the backend.');
    }
  };

  const handlePurge = async () => {
    try {
      await purgeCache();
      notify('ok', 'Server cache purged. Ingested transactions were not touched.');
    } catch {
      notify('error', 'The purge was refused by the backend.');
    }
  };

  const handleAddSeed = async () => {
    const address = newSeedAddress.trim();
    setSeedError(null);
    if (!address) { setSeedError('Enter a wallet address.'); return; }
    if (seedWallets.some((w) => w.address === address)) {
      setSeedError('That address is already on the watchlist.');
      return;
    }
    try {
      await addSeedWallet(address, newSeedLabel.trim());
      setNewSeedAddress('');
      setNewSeedLabel('');
      fetchSeedWallets();
      notify('ok', 'Watchlist seed added. Re-run the pipeline to propagate risk from it.');
    } catch (e) {
      setSeedError(e.response?.data?.error
        || 'The backend refused the addition. In snapshot mode there is no backend to write to.');
    }
  };

  const handleRemoveSeed = async (address) => {
    try {
      await removeSeedWallet(address);
      fetchSeedWallets();
    } catch {
      setSeedError('The backend refused the removal.');
    }
  };

  const handleSaveApiUrl = () => {
    setApiBaseUrl(apiUrl.trim());
    notify('info', 'API URL updated. Reloading to reconnect…');
    setTimeout(() => window.location.reload(), 700);
  };

  const toggleDemo = () => {
    setDemoMode(!demo);
    window.location.reload();
  };

  const writesDisabled = demo || status === 'down';

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="page-toolbar-title">
          <Icon name="settings" size={14} />
          Configuration
        </span>
        <span className="page-toolbar-spacer" />
        <button className="tool-btn" onClick={() => { loadSettings(); fetchSeedWallets(); recheck(); }}>
          <Icon name="refresh" size={13} /> <span>Reload</span>
        </button>
      </div>

      {message && (
        <div style={{ padding: 'var(--space-sm) var(--space-md) 0' }}>
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      )}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item${section === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={13} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-main">
          <div className="browser-scroll">
            {section === 'thresholds' && (
              loading ? <Loading label="Reading configuration…" /> : (
                <Panel
                  icon="sliders"
                  title="Forensic thresholds"
                  meta="applied on the next pipeline run"
                  style={{ border: 'none', borderRadius: 0 }}
                >
                  <Row
                    title="Mixer identification confidence"
                    control={(
                      <div className="slider-control grow">
                        <input
                          type="range" min="0.5" max="1" step="0.05"
                          value={field('mixer_confidence_threshold', 0.85)}
                          onChange={(e) => updateField('mixer_confidence_threshold', e.target.value)}
                          aria-label="Mixer identification confidence"
                        />
                        <span className="slider-value">
                          {Number(field('mixer_confidence_threshold', 0.85)).toFixed(2)}
                        </span>
                      </div>
                    )}
                  >
                    Minimum heuristic score before a cluster is flagged as a mixing service.
                  </Row>

                  <Row
                    title="Darknet market proximity"
                    control={(
                      <div className="row">
                        <button
                          className="btn btn-sm"
                          onClick={() => updateField('darknet_proximity_hops', Math.max(1, Number(field('darknet_proximity_hops', 3)) - 1))}
                          aria-label="Fewer hops"
                        >
                          <Icon name="minus" size={11} />
                        </button>
                        <span className="slider-value" style={{ minWidth: 62 }}>
                          {field('darknet_proximity_hops', 3)} hops
                        </span>
                        <button
                          className="btn btn-sm"
                          onClick={() => updateField('darknet_proximity_hops', Math.min(10, Number(field('darknet_proximity_hops', 3)) + 1))}
                          aria-label="More hops"
                        >
                          <Icon name="plus" size={11} />
                        </button>
                      </div>
                    )}
                  >
                    Maximum hop distance at which a wallet counts as exposed to a watchlisted entity.
                  </Row>

                  <Row
                    title="Strict IP geolocation"
                    control={(
                      <div
                        className={`toggle-switch${String(field('geo_ip_strict', 'false')) === 'true' ? ' active' : ''}`}
                        role="switch"
                        tabIndex={0}
                        aria-checked={String(field('geo_ip_strict', 'false')) === 'true'}
                        aria-label="Strict IP geolocation"
                        onClick={() => updateField('geo_ip_strict', String(field('geo_ip_strict', 'false')) === 'true' ? 'false' : 'true')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            updateField('geo_ip_strict', String(field('geo_ip_strict', 'false')) === 'true' ? 'false' : 'true');
                          }
                        }}
                      />
                    )}
                  >
                    Require VPN and proxy exit-node cross-referencing before attributing a location.
                  </Row>

                  <Row
                    title="Velocity spike threshold"
                    control={(
                      <div className="slider-control grow">
                        <input
                          type="range" min="10" max="200" step="10"
                          value={field('velocity_spike_threshold', 50)}
                          onChange={(e) => updateField('velocity_spike_threshold', e.target.value)}
                          aria-label="Velocity spike threshold"
                        />
                        <span className="slider-value">{field('velocity_spike_threshold', 50)}</span>
                      </div>
                    )}
                  >
                    Transactions per hour above which a wallet is flagged for a velocity spike.
                  </Row>

                  <Row
                    last
                    title="Anomaly percentile"
                    control={(
                      <div className="slider-control grow">
                        <input
                          type="range" min="80" max="99" step="1"
                          value={field('anomaly_percentile', 95)}
                          onChange={(e) => updateField('anomaly_percentile', e.target.value)}
                          aria-label="Anomaly percentile"
                        />
                        <span className="slider-value">{field('anomaly_percentile', 95)}%</span>
                      </div>
                    )}
                  >
                    Reconstruction-error percentile at which the model raises an alert.
                  </Row>
                </Panel>
              )
            )}

            {section === 'watchlist' && (
              <Panel
                icon="flag"
                title="Seed / watchlist wallets"
                meta={`${fmtInt(seedWallets.length)} entries`}
                style={{ border: 'none', borderRadius: 0 }}
              >
                <div className="col" style={{ padding: 'var(--space-md)', gap: 'var(--space-md)' }}>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
                    Known-illicit addresses that risk is propagated from. ChainTrace
                    never infers or fabricates this list — an investigator maintains
                    it from a sanctions list, a prior case, or an exchange freeze
                    notice. Every wallet within the proximity hop count of one of
                    these receives a distance-decayed risk boost on the next run.
                  </p>

                  <div className="row row-wrap">
                    <input
                      className="input mono"
                      style={{ flex: '1 1 260px' }}
                      type="text"
                      placeholder="Wallet address"
                      value={newSeedAddress}
                      onChange={(e) => setNewSeedAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddSeed()}
                      aria-label="Wallet address"
                    />
                    <input
                      className="input"
                      style={{ flex: '1 1 180px' }}
                      type="text"
                      placeholder="Label (optional)"
                      value={newSeedLabel}
                      onChange={(e) => setNewSeedLabel(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddSeed()}
                      aria-label="Label"
                    />
                    <button className="btn btn-primary" onClick={handleAddSeed} disabled={writesDisabled}>
                      <Icon name="plus" size={12} /> Add
                    </button>
                  </div>

                  {seedError && <Notice kind="error">{seedError}</Notice>}

                  {seedWallets.length === 0 ? (
                    <Notice kind="info">
                      No seed wallets yet. Add one above, or generate the synthetic
                      dataset on the Ingest page, which registers its darknet-adjacent
                      wallets here automatically.
                    </Notice>
                  ) : (
                    <div className="table-wrap" style={{ maxHeight: 420 }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Address</th>
                            <th style={{ width: 160 }}>Label</th>
                            <th style={{ width: 110 }}>Source</th>
                            <th style={{ width: 150 }}>Added</th>
                            <th style={{ width: 36 }} aria-label="Remove" />
                          </tr>
                        </thead>
                        <tbody>
                          {seedWallets.map((sw) => (
                            <tr key={sw.address}>
                              <td className="mono" title={sw.address}>{sw.address}</td>
                              <td title={sw.label}>{sw.label || '—'}</td>
                              <td>{sw.source}</td>
                              <td className="mono">{fmtTimestamp(sw.added_at)}</td>
                              <td>
                                <button
                                  className="icon-btn"
                                  title={`Remove ${sw.address}`}
                                  aria-label={`Remove ${sw.address}`}
                                  disabled={writesDisabled}
                                  onClick={() => handleRemoveSeed(sw.address)}
                                >
                                  <Icon name="close" size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {section === 'offline' && (
              <div className="col" style={{ gap: 0 }}>
                <OfflinePanel />
                <Panel
                  icon="layers"
                  title="Offline snapshot mode"
                  style={{ border: 'none', borderRadius: 0 }}
                >
                  <div style={{ padding: 'var(--space-md)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
                      A different thing from the stored responses above: this serves a
                      fixed run of the analysis pipeline from data bundled into the
                      build itself, so the whole interface is usable on a machine that
                      has never reached a backend. Scores, alerts, clusters and graph
                      structure are genuine pipeline output; nothing recomputes, and
                      ingestion and configuration writes are refused rather than faked.
                    </p>
                  </div>
                  <Row
                    last
                    title={demo ? 'Snapshot mode is on' : 'Snapshot mode is off'}
                    control={(
                      <button className={demo ? 'btn btn-primary' : 'btn'} onClick={toggleDemo}>
                        {demo ? 'Switch to live backend' : 'Use offline snapshot'}
                      </button>
                    )}
                  >
                    {demo
                      ? 'Every page is reading from the bundled snapshot.'
                      : 'Every page is reading from the configured backend.'}
                  </Row>
                </Panel>
              </div>
            )}

            {section === 'system' && (
              <div className="col" style={{ gap: 0 }}>
                <Panel icon="database" title="System" style={{ border: 'none', borderRadius: 0 }}>
                  <div className="prop-list">
                    {[
                      ['Version', health?.version || '—'],
                      ['Database', 'DuckDB (embedded)'],
                      ['Connection', demo ? 'Offline snapshot'
                        : status === 'down' ? 'Unreachable'
                          : status === 'empty' ? 'Connected — no data'
                            : status === 'degraded' ? 'Connected — database error'
                              : 'Connected'],
                      ['Transactions loaded', fmtInt(health?.transaction_count)],
                      ['Wallets loaded', fmtInt(health?.wallet_count)],
                      ['Graph nodes in memory', fmtInt(health?.graph_nodes)],
                      // Read from the backend rather than hardcoded: on a
                      // light-mode host neither the neural autoencoder nor
                      // Node2Vec nor SHAP is running, and this panel is where an
                      // operator checks what produced the scores they are reading.
                      ['Anomaly model', health ? (health.light_mode ? 'PCA linear autoencoder' : 'PyTorch autoencoder') : '—'],
                      ['Embeddings', health ? (health.light_mode ? 'Structural (degree / clustering)' : 'Node2Vec (PyG)') : '—'],
                      ['Explainability', health ? (health.light_mode ? 'Per-feature reconstruction error' : 'SHAP KernelExplainer') : '—'],
                      ['Deployment profile', health ? (health.light_mode ? 'Light (low memory)' : 'Full') : '—'],
                      ['Backend PID', health?.pid ?? '—'],
                      ['Started at', health?.started_at ? fmtTimestamp(health.started_at) : '—'],
                      ['Log file', health?.log_file || '—'],
                    ].map(([label, value]) => (
                      <div className="prop-row" key={label}>
                        <span className="prop-label">{label}</span>
                        <span className="prop-value mono">{value}</span>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel icon="globe" title="Backend API connection" style={{ border: 'none', borderRadius: 0 }}>
                  <div className="col" style={{ padding: 'var(--space-md)', gap: 'var(--space-md)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
                      Which backend this browser talks to. By default it uses the{' '}
                      <code>VITE_API_URL</code> baked in at build time; an override
                      set here is stored in this browser only.
                    </p>
                    <div className="row row-wrap">
                      <input
                        className="input mono"
                        style={{ flex: '1 1 320px' }}
                        type="text"
                        placeholder="e.g. https://chaintrace-backend.example.com"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        aria-label="Backend API URL"
                      />
                      <button className="btn btn-primary" onClick={handleSaveApiUrl}>Save and reconnect</button>
                      {apiUrl && (
                        <button
                          className="btn"
                          onClick={() => { setApiUrl(''); setApiBaseUrl(''); window.location.reload(); }}
                        >
                          Reset to build default
                        </button>
                      )}
                      {getApiBaseUrl() && <CopyButton value={getApiBaseUrl()} title="Copy the active API URL" />}
                    </div>
                  </div>
                </Panel>

                <div className="danger-zone">
                  <h3><Icon name="alertTriangle" size={13} /> Destructive operations</h3>
                  <Row
                    title="Purge server cache"
                    control={(
                      <button className="btn btn-danger" onClick={handlePurge} disabled={writesDisabled}>
                        Purge
                      </button>
                    )}
                  >
                    Clears cached graph nodes and temporary analysis files on the
                    backend. Ingested transactions are not affected.
                  </Row>
                  <Row
                    last
                    title="Reset forensic thresholds"
                    control={(
                      <button className="btn btn-danger" onClick={handleReset} disabled={writesDisabled}>
                        Reset to defaults
                      </button>
                    )}
                  >
                    Overwrites every threshold on the backend with its factory
                    default, for every user of that backend.
                  </Row>
                </div>
              </div>
            )}
          </div>

          <div className="action-bar">
            <span className="action-bar-note">
              {writesDisabled
                ? 'No backend is attached, so configuration changes cannot be saved.'
                : dirty
                  ? 'Unsaved changes — these apply on the next pipeline run.'
                  : 'Configuration matches the backend.'}
            </span>
            <button className="btn" onClick={handleDiscard} disabled={!dirty}>
              Discard changes
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !dirty || writesDisabled}
            >
              {saving ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
