import { useState, useEffect } from 'react';
import {
  getSettings, updateSettings, resetSettings, purgeCache,
  getSeedWallets, addSeedWallet, removeSeedWallet,
  getApiBaseUrl, setApiBaseUrl, isDemoMode, setDemoMode,
} from '../services/api';
import { useBackendStatus } from '../hooks/useBackendStatus';
import Icon from '../components/Icon';

const settingsSections = [
  { id: 'thresholds', label: 'Thresholds' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'system', label: 'System' },
];

export default function Settings() {
  const [activeSection, setActiveSection] = useState('thresholds');
  const [settings, setSettings_] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [seedWallets, setSeedWallets] = useState([]);
  const [newSeedAddress, setNewSeedAddress] = useState('');
  const [newSeedLabel, setNewSeedLabel] = useState('');
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl() || '');
  const { health, status } = useBackendStatus();
  const demo = isDemoMode();

  const toggleDemo = () => {
    setDemoMode(!demo);
    window.location.reload();
  };

  const handleSaveApiUrl = () => {
    setApiBaseUrl(apiUrl.trim());
    setMessage('API URL updated. Refreshing connection...');
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  useEffect(() => {
    getSettings().then(res => setSettings_(res.data)).catch(() => {});
    fetchSeedWallets();
  }, []);

  const fetchSeedWallets = () => {
    getSeedWallets().then(res => setSeedWallets(res.data || [])).catch(() => {});
  };

  const handleAddSeed = async () => {
    const address = newSeedAddress.trim();
    if (!address) return;
    try {
      await addSeedWallet(address, newSeedLabel.trim());
      setNewSeedAddress('');
      setNewSeedLabel('');
      fetchSeedWallets();
    } catch (e) {}
  };

  const handleRemoveSeed = async (address) => {
    try {
      await removeSeedWallet(address);
      fetchSeedWallets();
    } catch (e) {}
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(settings);
      setMessage('Settings saved successfully');
    } catch (e) { setMessage('Failed to save settings'); }
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleReset = async () => {
    try {
      const res = await resetSettings();
      setSettings_(res.data.settings);
      setMessage('Settings reset to defaults');
    } catch (e) { setMessage('Failed to reset'); }
    setTimeout(() => setMessage(null), 3000);
  };

  const handlePurge = async () => {
    try {
      await purgeCache();
      setMessage('Cache purged successfully');
    } catch (e) { setMessage('Failed to purge cache'); }
    setTimeout(() => setMessage(null), 3000);
  };

  const updateField = (key, value) => {
    setSettings_(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={handleReset}>Discard</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {message && (
        <div className="card" style={{ marginBottom: 'var(--space-lg)', textAlign: 'center',
          color: message.includes('success') || message.includes('purged') || message.includes('reset') ? 'var(--accent-green)' : 'var(--accent-critical)' }}>
          {message}
        </div>
      )}

      <div className="settings-layout">
        {/* Navigation */}
        <nav className="settings-nav">
          {settingsSections.map(s => (
            <div
              key={s.id}
              className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >{s.label}</div>
          ))}
        </nav>

        {/* Content */}
        <div>
          {activeSection === 'thresholds' && (
            <div className="settings-section">
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-lg)' }}>Thresholds</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Mixer confidence</h3>
                  <p>Minimum score to flag a cluster as a mixing service.</p>
                </div>
                <div className="slider-control" style={{ width: 200 }}>
                  <input
                    type="range" min="0.5" max="1" step="0.05"
                    value={settings.mixer_confidence_threshold || 0.85}
                    onChange={e => updateField('mixer_confidence_threshold', e.target.value)}
                  />
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                    background: 'var(--bg-tertiary)', padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)', width: 60, textAlign: 'center',
                  }}>
                    {Number(settings.mixer_confidence_threshold || 0.85).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Watchlist proximity</h3>
                  <p>Hops from a watchlisted wallet that still carry risk.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <button className="btn btn-outline" style={{ padding: '4px 8px', minWidth: 0 }}
                    onClick={() => updateField('darknet_proximity_hops', Math.max(1, Number(settings.darknet_proximity_hops || 3) - 1))}>
                    <Icon name="minus" size={12} />
                  </button>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)',
                    background: 'var(--bg-tertiary)', padding: '4px 16px', borderRadius: 'var(--radius-sm)',
                    minWidth: 60, textAlign: 'center',
                  }}>
                    {settings.darknet_proximity_hops || 3} Hops
                  </span>
                  <button className="btn btn-outline" style={{ padding: '4px 8px', minWidth: 0 }}
                    onClick={() => updateField('darknet_proximity_hops', Math.min(10, Number(settings.darknet_proximity_hops || 3) + 1))}>
                    <Icon name="plus" size={12} />
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Strict IP geolocation</h3>
                  <p>Cross-reference VPN and proxy exit nodes before attributing a location.</p>
                </div>
                <div
                  className={`toggle-switch ${settings.geo_ip_strict === 'true' ? 'active' : ''}`}
                  onClick={() => updateField('geo_ip_strict', settings.geo_ip_strict === 'true' ? 'false' : 'true')}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Velocity spike</h3>
                  <p>Transactions per hour that count as a spike.</p>
                </div>
                <div className="slider-control" style={{ width: 200 }}>
                  <input
                    type="range" min="10" max="200" step="10"
                    value={settings.velocity_spike_threshold || 50}
                    onChange={e => updateField('velocity_spike_threshold', e.target.value)}
                  />
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                    background: 'var(--bg-tertiary)', padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)', width: 60, textAlign: 'center',
                  }}>
                    {settings.velocity_spike_threshold || 50}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Anomaly percentile</h3>
                  <p>Reconstruction error percentile above which a wallet is flagged.</p>
                </div>
                <div className="slider-control" style={{ width: 200 }}>
                  <input
                    type="range" min="80" max="99" step="1"
                    value={settings.anomaly_percentile || 95}
                    onChange={e => updateField('anomaly_percentile', e.target.value)}
                  />
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                    background: 'var(--bg-tertiary)', padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)', width: 60, textAlign: 'center',
                  }}>
                    {settings.anomaly_percentile || 95}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'watchlist' && (
            <div className="settings-section">
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 4 }}>Watchlist</h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-xl)' }}>
                Addresses risk propagates from. You maintain this list; nothing is added automatically.
              </p>

              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
                <input
                  type="text" placeholder="Address"
                  value={newSeedAddress} onChange={e => setNewSeedAddress(e.target.value)}
                  style={{ flex: '1 1 260px', background: 'var(--bg-input)', border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                    padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
                />
                <input
                  type="text" placeholder="Label"
                  value={newSeedLabel} onChange={e => setNewSeedLabel(e.target.value)}
                  style={{ flex: '1 1 180px', background: 'var(--bg-input)', border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                    padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
                />
                <button className="btn btn-primary" onClick={handleAddSeed}>
                  <Icon name="plus" size={13} /> Add
                </button>
              </div>

              {seedWallets.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                  Empty.
                </p>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Address</th><th>Label</th><th>Source</th><th>Added</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {seedWallets.map(sw => (
                        <tr key={sw.address}>
                          <td className="mono">{sw.address}</td>
                          <td style={{ fontFamily: 'var(--font-sans)' }}>{sw.label || '—'}</td>
                          <td>{sw.source}</td>
                          <td style={{ fontSize: 'var(--text-xs)' }}>{sw.added_at?.slice(0, 19)}</td>
                          <td>
                            <span
                              style={{ cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
                              title="Remove"
                              onClick={() => handleRemoveSeed(sw.address)}
                            >
                              <Icon name="close" size={14} />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeSection === 'system' && (
            <div>
              <div className="settings-section" style={{ marginBottom: 'var(--space-xl)' }}>
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-md)' }}>System</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', fontSize: 'var(--text-sm)' }}>
                  {[
                    ['Version', health?.version || '1.0.0'],
                    ['Database', 'DuckDB (embedded)'],
                    ['Connection', demo ? 'Snapshot'
                      : status === 'down' ? 'Unreachable'
                      : status === 'empty' ? 'Connected — no data'
                      : 'Connected'],
                    ['Transactions', health?.transaction_count?.toLocaleString() ?? '—'],
                    // Read from the backend rather than hardcoded: on a
                    // light-mode host neither the neural autoencoder nor
                    // Node2Vec nor SHAP is running, and this panel is where an
                    // operator checks what produced the scores they're reading.
                    ['Anomaly model', health?.light_mode ? 'PCA linear autoencoder'
                      : health ? 'PyTorch autoencoder' : '—'],
                    ['Embeddings', health?.light_mode ? 'Structural (degree/clustering)'
                      : health ? 'Node2Vec (PyG)' : '—'],
                    ['Explainability', health?.light_mode ? 'Per-feature reconstruction error'
                      : health ? 'SHAP KernelExplainer' : '—'],
                    ['Profile', health?.light_mode ? 'Light (low memory)'
                      : health ? 'Full' : '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', marginBottom: 2 }}>{k}</div>
                      <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-section" style={{ marginBottom: 'var(--space-xl)' }}>
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-md)' }}>Backend</h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-md)' }}>
                  Defaults to <code>VITE_API_URL</code>. An address set here overrides it in this browser.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="e.g. https://chaintrace-backend.onrender.com"
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    style={{ flex: '1 1 320px', background: 'var(--bg-input)', border: '1px solid var(--border-primary)',
                      color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                      padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
                  />
                  <button className="btn btn-primary" onClick={handleSaveApiUrl}>
                    Save
                  </button>
                  {apiUrl && (
                    <button className="btn btn-secondary" onClick={() => { setApiUrl(''); setApiBaseUrl(''); window.location.reload(); }}>
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-section" style={{ marginBottom: 'var(--space-xl)' }}>
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-md)' }}>Snapshot</h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-md)', lineHeight: 1.6 }}>
                  A stored pipeline run bundled into this build, so the interface
                  works with no backend. Nothing recomputes; ingestion and settings
                  changes are refused rather than faked.
                </p>
                <div className="settings-row" style={{ borderBottom: 'none' }}>
                  <div className="settings-row-info">
                    <h3 style={{ color: 'var(--text-primary)' }}>{demo ? 'On' : 'Off'}</h3>
                    <p>{demo ? 'Reading the bundled snapshot.' : 'Reading the configured backend.'}</p>
                  </div>
                  <button className={demo ? 'btn btn-secondary' : 'btn btn-outline'} onClick={toggleDemo}>
                    {demo ? 'Use backend' : 'Use snapshot'}
                  </button>
                </div>
              </div>

              <div className="danger-zone">
                <h3 style={{ marginBottom: 'var(--space-lg)' }}>Destructive</h3>
                <div className="settings-row" style={{ borderBottom: 'none' }}>
                  <div className="settings-row-info">
                    <h3 style={{ color: 'var(--text-primary)' }}>Purge cache</h3>
                    <p>Deletes cached graph nodes and temporary analysis files.</p>
                  </div>
                  <button className="btn btn-danger" onClick={handlePurge}>Purge</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
