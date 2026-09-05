import { useState, useRef, useCallback, useEffect } from 'react';
import {
  uploadFile, runPipeline, getPipelineStatus, getPipelineLogs,
  generateSampleData, fetchRealData,
} from '../services/api';
import Icon from '../components/Icon';

// Static one-liners for stages the backend has not yet annotated with a
// result of their own.
const STAGE_HINTS = {
  clear: 'previous dataset + in-memory analysis state',
  parse: 'CSV / JSON / XML → records',
  validate: 'schema + field checks',
  enrich: 'GeoIP lookup',
  load: 'DuckDB insert',
  analyse: 'graph · cluster · score · explain',
};

const LEVEL_COLOR = {
  ERROR: 'var(--accent-critical)',
  CRITICAL: 'var(--accent-critical)',
  WARNING: 'var(--accent-elevated)',
};

export default function Ingest() {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logFile, setLogFile] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);

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

  // The backend's own log for this run. A pipeline that fails on a machine
  // where the server's terminal is out of sight — or, as happened here, gone
  // entirely — left the operator with a single line of text and no way to
  // find out more. This pulls the run's log back into the page.
  const refreshLogs = useCallback(async (runId) => {
    try {
      const res = await getPipelineLogs(runId || null, 300);
      setLogs(res.data?.records || []);
      setLogFile(res.data?.log_file || null);
    } catch {
      // Leave whatever is already shown; the status panel reports the failure.
    }
  }, []);

  // Poll pipeline status
  useEffect(() => {
    if (!polling) return undefined;
    const interval = setInterval(async () => {
      try {
        const res = await getPipelineStatus();
        setPipelineStatus(res.data);
        refreshLogs(res.data?.run_id);
        if (res.data.status === 'completed' || res.data.status === 'error') {
          setPolling(false);
          setIsProcessing(false);
          // A failed run is the one an operator needs to read, so open the
          // log instead of making them go looking for it.
          if (res.data.status === 'error') setShowLogs(true);
        }
      } catch (e) { /* transient; the next tick retries */ }
    }, 1500);
    return () => clearInterval(interval);
  }, [polling, refreshLogs]);

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [logs, showLogs]);

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

  const handleFetchReal = async () => {
    try {
      setIsProcessing(true);
      setPipelineStatus({ status: 'running', progress: 5, message: 'Fetching real, verifiable transactions from the live Bitcoin blockchain (Blockstream API)...' });
      const res = await fetchRealData(500, 10);
      if (res.data.error) throw new Error(res.data.error);
      setPipelineStatus({ status: 'running', progress: 25, message: `${res.data.count} real transactions fetched. Launching ML analysis pipeline...` });
      await runPipeline({ file_path: res.data.csv_path });
      setPolling(true);
    } catch (e) {
      setPipelineStatus({ status: 'error', progress: 0, message: 'Failed: ' + (e.response?.data?.error || e.message) });
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

  // The backend reports the stage it is in and the state of every stage, so
  // the tracker mirrors what actually happened. It used to be inferred from
  // the progress percentage alone — and since a failure reset progress to 0,
  // every failure was attributed to the first step. A run that died in the
  // ML stage displayed a red cross on "PARSE & VALIDATE", which is a lie the
  // operator then has to spend time disproving.
  const ICONS = {
    done: 'check', error: 'close', running: 'circleDot',
    skipped: 'circle', pending: 'circle',
  };
  const steps = (pipelineStatus?.stages?.length ? pipelineStatus.stages : []).map((s) => ({
    key: s.key,
    name: s.label.toUpperCase(),
    detail: s.detail || STAGE_HINTS[s.key] || '',
    status: s.status,
    icon: ICONS[s.status] || 'circle',
  }));

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
            <div className="step-tracker-item" key={s.key}>
              <div className="step-tracker-col">
                <div className={`step-circle ${s.status}`}><Icon name={s.icon} size={15} /></div>
                <span className="step-name" style={{
                  color: s.status === 'done' ? 'var(--accent-green)'
                    : s.status === 'running' ? 'var(--accent-elevated)'
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
        <div className="dropzone-icon"><Icon name="uploadCloud" size={26} /></div>
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
      <div className="ingest-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', marginTop: 'var(--space-xl)', justifyContent: 'center' }}>
        <button
          className="btn btn-primary"
          disabled={!file}
          onClick={handleUpload}
        >
          <Icon name="upload" size={13} /> Upload File
        </button>
        <button
          className="btn btn-primary"
          disabled={!uploadStatus?.path}
          onClick={() => handleRunPipeline(uploadStatus?.path)}
        >
          <Icon name="play" size={13} /> Run Pipeline
        </button>
        <button
          className="btn btn-outline"
          disabled={isProcessing}
          onClick={handleFetchReal}
          title="Pulls real, verifiable transactions from the live Bitcoin blockchain via Blockstream's public API. Requires internet access; network-layer (IP/port) fields are left blank since no public source for that exists."
        >
          {isProcessing
            ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Processing Pipeline...</>
            : <><Icon name="globe" size={13} /> Fetch Real Blockchain Data &amp; Run</>}
        </button>
        <button
          className="btn btn-outline"
          disabled={isProcessing}
          onClick={handleGenerateSample}
          title="Generates a synthetic demo dataset with fabricated wallets, IPs, and injected anomaly patterns — for testing the pipeline without real data."
        >
          {isProcessing
            ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Processing Pipeline...</>
            : <><Icon name="sparkles" size={13} /> Generate Sample &amp; Run</>}
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

          {pipelineStatus.status === 'error' && (
            <div className="pipeline-error">
              <div className="pipeline-error-head">
                <Icon name="alertTriangle" size={14} />
                <span>
                  Failed during <b>{pipelineStatus.stage || 'startup'}</b>
                  {pipelineStatus.error_type ? ` — ${pipelineStatus.error_type}` : ''}
                </span>
              </div>
              {pipelineStatus.error && <p className="pipeline-error-msg">{pipelineStatus.error}</p>}
              {pipelineStatus.traceback && (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setShowTrace((v) => !v)}>
                    <Icon name={showTrace ? 'chevronUp' : 'chevronDown'} size={12} />
                    {showTrace ? ' Hide traceback' : ' Show traceback'}
                  </button>
                  {showTrace && <pre className="pipeline-trace">{pipelineStatus.traceback}</pre>}
                </>
              )}
            </div>
          )}

          <div className="pipeline-log-controls">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                const next = !showLogs;
                setShowLogs(next);
                if (next) refreshLogs(pipelineStatus.run_id);
              }}
            >
              <Icon name={showLogs ? 'chevronUp' : 'chevronDown'} size={12} />
              {showLogs ? ' Hide server log' : ' Show server log'}
            </button>
            {showLogs && (
              <button className="btn btn-outline btn-sm" onClick={() => refreshLogs(pipelineStatus.run_id)}>
                <Icon name="refresh" size={12} /> Refresh
              </button>
            )}
            {showLogs && logFile && <code className="pipeline-log-path">{logFile}</code>}
          </div>

          {showLogs && (
            <div className="pipeline-log">
              {logs.length === 0 && (
                <div className="pipeline-log-empty">
                  No log records for this run yet.
                </div>
              )}
              {logs.map((r, i) => (
                <div className="pipeline-log-line" key={`${r.ts}-${i}`}>
                  <span className="pipeline-log-ts">{r.ts?.slice(11, 23) || ''}</span>
                  <span className="pipeline-log-level" style={{ color: LEVEL_COLOR[r.level] }}>
                    {r.level}
                  </span>
                  <span className="pipeline-log-msg">
                    {r.message}
                    {r.traceback && <pre className="pipeline-trace">{r.traceback}</pre>}
                  </span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

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
