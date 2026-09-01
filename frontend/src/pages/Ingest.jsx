import { useState, useRef, useCallback, useEffect } from 'react';
import { uploadFile, runPipeline, getPipelineStatus, generateSampleData } from '../services/api';

export default function Ingest() {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [polling, setPolling] = useState(false);
  const fileInputRef = useRef(null);

  // Check initial status on mount
  useEffect(() => {
    getPipelineStatus()
      .then(res => {
        if (res.data && res.data.status) {
          setPipelineStatus(res.data);
          if (res.data.status === 'running') {
            setPolling(true);
            setIsProcessing(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Poll pipeline status
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      try {
        const res = await getPipelineStatus();
        setPipelineStatus(res.data);
        if (res.data.status === 'completed' || res.data.status === 'error') {
          setPolling(false);
          setIsProcessing(false);
        }
      } catch (e) {}
    }, 1500);
    return () => clearInterval(interval);
  }, [polling]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) setFile(droppedFile);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    try {
      setUploadStatus({ status: 'uploading', message: 'Uploading file...' });
      const res = await uploadFile(file);
      setUploadStatus({ status: 'success', message: res.data.message, path: res.data.path });
    } catch (e) {
      setUploadStatus({ status: 'error', message: 'Upload failed: ' + (e.response?.data?.error || e.message) });
    }
  };

  const handleRunPipeline = async (filePath = null) => {
    try {
      setIsProcessing(true);
      setPipelineStatus({ status: 'running', progress: 5, message: 'Starting pipeline execution...' });
      const params = {};
      if (filePath) params.file_path = filePath;
      await runPipeline(params);
      setPolling(true);
    } catch (e) {
      setPipelineStatus({ status: 'error', progress: 0, message: 'Pipeline launch failed: ' + (e.response?.data?.error || e.message) });
      setPolling(false);
      setIsProcessing(false);
    }
  };

  const handleGenerateSample = async () => {
    try {
      setIsProcessing(true);
      setPipelineStatus({ status: 'running', progress: 10, message: 'Generating 5,000 synthetic transactions...' });
      const res = await generateSampleData(5000);
      setPipelineStatus({ status: 'running', progress: 25, message: 'Sample generated. Launching ML analysis pipeline...' });
      await runPipeline({ file_path: res.data.csv_path });
      setPolling(true);
    } catch (e) {
      setPipelineStatus({ status: 'error', progress: 0, message: 'Failed: ' + (e.response?.data?.error || e.message) });
      setPolling(false);
      setIsProcessing(false);
    }
  };

  const progressColor = pipelineStatus?.status === 'error' ? 'var(--accent-critical)'
    : pipelineStatus?.status === 'completed' ? 'var(--accent-green)' : undefined;

  // Derived from the real progress checkpoints the backend reports
  // (clear=5, parse=10, validate=20, enrich=30, load=40, ML analysis=50→99, done=100).
  const progress = pipelineStatus?.progress || 0;
  const errored = pipelineStatus?.status === 'error';
  const steps = [
    { name: 'PARSE & VALIDATE', detail: 'schema + records', min: 0, max: 20 },
    { name: 'ENRICH', detail: 'GeoIP lookup', min: 20, max: 30 },
    { name: 'LOAD', detail: 'DuckDB insert', min: 30, max: 40 },
    { name: 'ML ANALYSIS', detail: 'graph · cluster · score · explain', min: 40, max: 100 },
  ].map((s, i, arr) => {
    const nextMin = arr[i + 1]?.min ?? 100;
    let status = 'pending';
    if (pipelineStatus?.status === 'completed') status = 'done';
    else if (errored && progress >= s.min) status = progress < nextMin ? 'error' : 'done';
    else if (progress >= nextMin) status = 'done';
    else if (progress >= s.min && pipelineStatus?.status === 'running') status = 'active';
    return { ...s, status, icon: status === 'done' ? '✓' : status === 'error' ? '✕' : status === 'active' ? '●' : '○' };
  });

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Data Ingestion</h1>
      </div>

      {pipelineStatus?.run_id && (
        <div className="run-header">
          <div className="run-header-meta">
            <span>RUN ID <b>{pipelineStatus.run_id}</b></span>
            {file && <span>DATASET <b>{file.name}</b></span>}
          </div>
          <span
            className="topbar-status"
            style={{
              color: pipelineStatus.status === 'completed' ? 'var(--accent-green)'
                : pipelineStatus.status === 'error' ? 'var(--accent-critical)' : 'var(--accent-elevated)',
            }}
          >
            <span
              className="pulse-dot"
              style={{
                background: pipelineStatus.status === 'completed' ? 'var(--accent-green)'
                  : pipelineStatus.status === 'error' ? 'var(--accent-critical)' : 'var(--accent-elevated)',
                animation: pipelineStatus.status === 'running' ? undefined : 'none',
              }}
            />
            {pipelineStatus.status?.toUpperCase()}
          </span>
        </div>
      )}

      {(pipelineStatus?.status === 'running' || pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error') && (
        <div className="step-tracker">
          {steps.map(s => (
            <div className="step-tracker-item" key={s.name}>
              <div className="step-tracker-col">
                <div className={`step-circle ${s.status}`}>{s.icon}</div>
                <span className="step-name" style={{
                  color: s.status === 'done' ? 'var(--accent-green)' : s.status === 'active' ? 'var(--accent-elevated)'
                    : s.status === 'error' ? 'var(--accent-critical)' : 'var(--text-tertiary)',
                }}>{s.name}</span>
                <span className="step-detail">{s.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dropzone */}
      <div
        className={`dropzone ${file ? 'active' : ''}`}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="dropzone-icon">⇧</div>
        <div className="dropzone-text">
          {file ? file.name : 'DRAG .CSV / .JSON / .XML BLOCKCHAIN EXPORT HERE'}
        </div>
        <div className="dropzone-sub">
          {file ? `${(file.size / 1024).toFixed(1)} KB` : 'or click to browse — processed entirely offline'}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.xml"
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files?.[0])}
        />
      </div>

      {/* Actions */}
      <div className="ingest-actions" style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-xl)', justifyContent: 'center' }}>
        <button
          className="btn btn-primary"
          disabled={!file}
          onClick={handleUpload}
        >
          ↑ Upload File
        </button>
        <button
          className="btn btn-primary"
          disabled={!uploadStatus?.path}
          onClick={() => handleRunPipeline(uploadStatus?.path)}
        >
          ▶ Run Pipeline
        </button>
        <button
          className="btn btn-outline"
          disabled={isProcessing}
          onClick={handleGenerateSample}
        >
          {isProcessing ? '⏳ Processing Pipeline...' : '✦ Generate Sample & Run'}
        </button>
      </div>

      {/* Upload Status */}
      {uploadStatus && (
        <div className="card" style={{ marginTop: 'var(--space-xl)', textAlign: 'center' }}>
          <span style={{ color: uploadStatus.status === 'success' ? 'var(--accent-green)' : uploadStatus.status === 'error' ? 'var(--accent-critical)' : 'var(--text-secondary)' }}>
            {uploadStatus.status === 'uploading' && <span className="spinner" style={{ display: 'inline-block', width: 16, height: 16, marginRight: 8 }} />}
            {uploadStatus.message}
          </span>
        </div>
      )}

      {/* Pipeline Status */}
      {pipelineStatus && (
        <div className="pipeline-progress">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>Pipeline Execution</h3>
            <span className={`badge ${pipelineStatus.status === 'completed' ? 'success' : pipelineStatus.status === 'error' ? 'critical' : 'info'}`}>
              {pipelineStatus.status?.toUpperCase()}
            </span>
          </div>

          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: `${pipelineStatus.progress || 0}%`,
                background: progressColor ? progressColor : undefined,
              }}
            />
          </div>

          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-sm)' }}>
            {pipelineStatus.message}
          </div>

          {pipelineStatus.status === 'completed' && pipelineStatus.summary && (
            <div className="ingest-summary-grid" style={{ marginTop: 'var(--space-lg)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)' }}>
              {Object.entries(pipelineStatus.summary.steps || {}).map(([step, data]) => (
                <div key={step} style={{ background: 'var(--bg-tertiary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>{step}</div>
                  <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(data, null, 1).slice(0, 100)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
