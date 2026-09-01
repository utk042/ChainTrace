import { useState, useEffect } from 'react';
import { getSettings, updateSettings, resetSettings, purgeCache } from '../services/api';

const settingsSections = [
  { id: 'thresholds', label: 'Forensic Thresholds' },
  { id: 'system', label: 'System' },
];

export default function Settings() {
  const [activeSection, setActiveSection] = useState('thresholds');
  const [settings, setSettings_] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    getSettings().then(res => setSettings_(res.data)).catch(() => {});
  }, []);

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
        <h1 className="page-title">System Configuration</h1>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={handleReset}>Discard Changes</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Deploy Config'}
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
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 4 }}>Forensic Thresholds</h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-xl)' }}>
                Configure baseline confidence cut-offs for heuristic analysis algorithms.
              </p>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Mixer Identification Confidence</h3>
                  <p>Minimum heuristic score to flag a cluster as a mixing service.</p>
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
                  <h3>Darknet Market Proximity</h3>
                  <p>Maximum hop distance to consider a wallet "exposed" to known DNM entities.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <button className="btn btn-outline" style={{ padding: '4px 10px', minWidth: 0 }}
                    onClick={() => updateField('darknet_proximity_hops', Math.max(1, Number(settings.darknet_proximity_hops || 3) - 1))}>
                    −
                  </button>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)',
                    background: 'var(--bg-tertiary)', padding: '4px 16px', borderRadius: 'var(--radius-sm)',
                    minWidth: 60, textAlign: 'center',
                  }}>
                    {settings.darknet_proximity_hops || 3} Hops
                  </span>
                  <button className="btn btn-outline" style={{ padding: '4px 10px', minWidth: 0 }}
                    onClick={() => updateField('darknet_proximity_hops', Math.min(10, Number(settings.darknet_proximity_hops || 3) + 1))}>
                    +
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Strict IP Geolocation Mapping</h3>
                  <p>Require VPN/Proxy exit node cross-referencing before attributing location.</p>
                </div>
                <div
                  className={`toggle-switch ${settings.geo_ip_strict === 'true' ? 'active' : ''}`}
                  onClick={() => updateField('geo_ip_strict', settings.geo_ip_strict === 'true' ? 'false' : 'true')}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <h3>Velocity Spike Threshold</h3>
                  <p>Minimum transactions per hour to flag as a velocity spike.</p>
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
                  <h3>Anomaly Percentile</h3>
                  <p>Reconstruction error percentile threshold for flagging anomalies.</p>
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

          {activeSection === 'system' && (
            <div>
              <div className="settings-section" style={{ marginBottom: 'var(--space-xl)' }}>
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-md)' }}>System Information</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', fontSize: 'var(--text-sm)' }}>
                  {[
                    ['Version', '1.0.0'],
                    ['Database', 'DuckDB (embedded)'],
                    ['ML Model', 'Autoencoder + Node2Vec'],
                    ['Explainability', 'SHAP KernelExplainer'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', marginBottom: 2 }}>{k}</div>
                      <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="danger-zone">
                <h3 style={{ marginBottom: 'var(--space-lg)' }}>⚠ System Reset</h3>
                <div className="settings-row" style={{ borderBottom: 'none' }}>
                  <div className="settings-row-info">
                    <h3 style={{ color: 'var(--text-primary)' }}>Purge Local Cache</h3>
                    <p>Clear all locally cached graph nodes and temporary analysis files.</p>
                  </div>
                  <button className="btn btn-danger" onClick={handlePurge}>Execute Purge</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
