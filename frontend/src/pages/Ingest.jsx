import { useState, useRef, useCallback, useEffect } from 'react';
import {
  uploadFile, runPipeline, getPipelineStatus, getPipelineLogs,
  generateSampleData, fetchRealData,
} from '../services/api';
import { useSession } from '../state/SessionProvider';
import { useCommands } from '../services/commands';
import { fmtTimestamp } from '../services/format';
import Icon from '../components/Icon';
import Panel from '../components/ui/Panel';
import Menu, { MenuItem, MenuHeading } from '../components/ui/Menu';
import { Notice, Empty } from '../components/ui/States';

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
  ERROR: 'var(--risk-critical)',
  CRITICAL: 'var(--risk-critical)',
  WARNING: 'var(--risk-elevated)',
};

const STEP_ICONS = {
  done: 'check', error: 'close', running: 'circleDot', skipped: 'circle', pending: 'circle',
};

/**
 * Loading data and running the analysis pipeline.
 *
 * The stage tracker mirrors what the backend reports rather than inferring
 * progress from a percentage: a failure used to reset progress to zero, so
 * every failure was attributed to the first step, and a run that died during
 * scoring displayed a red cross on "parse" — a lie the operator then had to
 * spend time disproving.
 */
export default function Ingest() {
  const { refreshStats, demo } = useSession();

  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logFile, setLogFile] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    getPipelineStatus()
      .then((res) => {
        if (res.data?.status) {
          setPipelineStatus(res.data);
          if (res.data.status === 'running') { setPolling(true); setIsProcessing(true); }
        }
      })
      .catch(() => {});
  }, []);

  // The backend's own log for this run. A pipeline that fails on a machine
  // where the server's terminal is out of sight — or gone entirely — left the
  // operator with one line of text and no way to find out more.
  const refreshLogs = useCallback(async (runId) => {
    try {
      const res = await getPipelineLogs(runId || null, 300);
      setLogs(res.data?.records || []);
      setLogFile(res.data?.log_file || null);
    } catch {
      // Leave whatever is already shown; the status panel reports the failure.
    }
  }, []);

  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(async () => {
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
          if (res.data.status === 'completed') refreshStats();
        }
      } catch { /* transient; the next tick retries */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [polling, refreshLogs, refreshStats]);

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [logs, showLogs]);

  useCommands({
    reload: () => getPipelineStatus().then((res) => setPipelineStatus(res.data)).catch(() => {}),
  });

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    try {
      setUploadStatus({ status: 'uploading', message: 'Uploading file…' });
      const res = await uploadFile(file);
      setUploadStatus({ status: 'success', message: res.data.message, path: res.data.path });
    } catch (e) {
      setUploadStatus({
        status: 'error',
        message: `Upload failed: ${e.response?.data?.error || e.message}`,
      });
    }
  };

  const launch = async (label, start) => {
    try {
      setIsProcessing(true);
      setPipelineStatus({ status: 'running', progress: 5, message: label });
      await start();
      setPolling(true);
    } catch (e) {
      setPipelineStatus({
        status: 'error',
        progress: 0,
        message: `Failed: ${e.response?.data?.error || e.message}`,
      });
      setPolling(false);
      setIsProcessing(false);
    }
  };

  const handleRunPipeline = (filePath = null) => launch(
    'Starting pipeline execution…',
    () => runPipeline(filePath ? { file_path: filePath } : {}),
  );

  const handleFetchReal = () => launch(
    'Fetching real transactions from the live Bitcoin blockchain (Blockstream API)…',
    async () => {
      const res = await fetchRealData(500, 10);
      if (res.data.error) throw new Error(res.data.error);
      setPipelineStatus({
        status: 'running',
        progress: 25,
        message: `${res.data.count} real transactions fetched. Launching the analysis pipeline…`,
      });
      await runPipeline({ file_path: res.data.csv_path });
    },
  );

  const handleGenerateSample = () => launch(
    'Generating 5,000 synthetic transactions…',
    async () => {
      const res = await generateSampleData(5000);
      setPipelineStatus({
        status: 'running',
        progress: 25,
        message: 'Sample generated. Launching the analysis pipeline…',
      });
      await runPipeline({ file_path: res.data.csv_path });
    },
  );

  const status = pipelineStatus?.status;
  const progressColor = status === 'error' ? 'var(--risk-critical)'
    : status === 'completed' ? 'var(--status-ok)' : undefined;

  const steps = (pipelineStatus?.stages || []).map((s) => ({
    key: s.key,
    name: s.label,
    detail: s.detail || STAGE_HINTS[s.key] || '',
    status: s.status,
    icon: STEP_ICONS[s.status] || 'circle',
  }));

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="page-toolbar-title">
          <Icon name="uploadCloud" size={14} />
          Data ingestion
        </span>

        {pipelineStatus?.run_id && (
          <>
            <span className="toolbar-sep" />
            <span className="muted mono truncate" title={pipelineStatus.run_id}>
              run {pipelineStatus.run_id}
            </span>
          </>
        )}

        <span className="page-toolbar-spacer" />

        {status && (
          <span
            className="row"
            style={{
              color: status === 'completed' ? 'var(--status-ok)'
                : status === 'error' ? 'var(--risk-critical)' : 'var(--risk-elevated)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <span
              className="pulse-dot"
              style={{
                background: 'currentColor',
                animation: status === 'running' ? undefined : 'none',
              }}
            />
            {status.toUpperCase()}
          </span>
        )}

        <Menu
          align="right"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              className={`btn btn-primary${open ? ' active' : ''}`}
              onClick={toggle}
              disabled={isProcessing}
            >
              Actions <Icon name="chevronDown" size={11} />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuHeading>Run the pipeline</MenuHeading>
              <MenuItem
                close={close}
                icon="upload"
                label="Upload the selected file"
                disabled={!file || isProcessing}
                onSelect={handleUpload}
              />
              <MenuItem
                close={close}
                icon="play"
                label="Run on the uploaded file"
                disabled={!uploadStatus?.path || isProcessing}
                onSelect={() => handleRunPipeline(uploadStatus?.path)}
              />
              <MenuItem
                close={close}
                icon="globe"
                label="Fetch live blockchain data & run"
                disabled={isProcessing}
                onSelect={handleFetchReal}
              />
              <MenuItem
                close={close}
                icon="sparkles"
                label="Generate a sample & run"
                disabled={isProcessing}
                onSelect={handleGenerateSample}
              />
            </>
          )}
        </Menu>
      </div>

      <div className="page-scroll">
        {demo && (
          <Notice kind="info">
            This session is reading a bundled snapshot with no backend attached,
            so ingestion is unavailable. Connect to a backend in Settings to run
            the pipeline.
          </Notice>
        )}

        <div
          className={`dropzone${dragging || file ? ' active' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click(); }}
          role="button"
          tabIndex={0}
        >
          <Icon name="uploadCloud" size={26} />
          <span className="dropzone-text">
            {file ? file.name : 'Drop a .csv, .json or .xml blockchain export here'}
          </span>
          <span className="dropzone-sub">
            {file
              ? `${(file.size / 1024).toFixed(1)} KB — use Actions ▸ Upload to send it`
              : 'or click to browse — the file is parsed on your own backend, never uploaded elsewhere'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,.xml"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <div className="row row-wrap">
          <button className="btn btn-primary" disabled={!file || isProcessing} onClick={handleUpload}>
            <Icon name="upload" size={12} /> Upload file
          </button>
          <button
            className="btn"
            disabled={!uploadStatus?.path || isProcessing}
            onClick={() => handleRunPipeline(uploadStatus?.path)}
          >
            <Icon name="play" size={12} /> Run pipeline
          </button>
          <button
            className="btn"
            disabled={isProcessing}
            onClick={handleFetchReal}
            title="Pulls real, verifiable transactions from the live Bitcoin blockchain via Blockstream's public API. Requires internet access; network-layer (IP/port) fields are left blank because no public source for them exists."
          >
            {isProcessing
              ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Running…</>
              : <><Icon name="globe" size={12} /> Fetch live blockchain data</>}
          </button>
          <button
            className="btn"
            disabled={isProcessing}
            onClick={handleGenerateSample}
            title="Generates a synthetic dataset with fabricated wallets, IPs and injected anomaly patterns — for exercising the pipeline without real data."
          >
            <Icon name="sparkles" size={12} /> Generate sample
          </button>
        </div>

        {uploadStatus && (
          <Notice kind={uploadStatus.status === 'success' ? 'ok' : uploadStatus.status === 'error' ? 'error' : 'info'}>
            {uploadStatus.message}
            {uploadStatus.path && <> — stored at <code>{uploadStatus.path}</code></>}
          </Notice>
        )}

        {steps.length > 0 && (
          <Panel icon="layers" title="Pipeline stages" meta={pipelineStatus?.run_id}>
            <div className="step-tracker" style={{ border: 'none' }}>
              {steps.map((s) => (
                <div className="step-item" key={s.key}>
                  <span className={`step-circle ${s.status}`}><Icon name={s.icon} size={13} /></span>
                  <span
                    className="step-name"
                    style={{
                      color: s.status === 'done' ? 'var(--status-ok)'
                        : s.status === 'running' ? 'var(--risk-elevated)'
                          : s.status === 'error' ? 'var(--risk-critical)' : 'var(--text-tertiary)',
                    }}
                  >
                    {s.name}
                  </span>
                  <span className="step-detail">{s.detail}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {pipelineStatus && (
          <Panel
            icon="terminal"
            title="Pipeline execution"
            meta={status ? status.toUpperCase() : undefined}
            actions={(
              <>
                <button
                  className="btn btn-sm btn-minimal"
                  onClick={() => {
                    const next = !showLogs;
                    setShowLogs(next);
                    if (next) refreshLogs(pipelineStatus.run_id);
                  }}
                >
                  <Icon name={showLogs ? 'chevronUp' : 'chevronDown'} size={11} />
                  {showLogs ? ' Hide server log' : ' Show server log'}
                </button>
                {showLogs && (
                  <button className="btn btn-sm btn-minimal" onClick={() => refreshLogs(pipelineStatus.run_id)}>
                    <Icon name="refresh" size={11} /> Refresh
                  </button>
                )}
              </>
            )}
          >
            <div className="col" style={{ padding: 'var(--space-md)', gap: 'var(--space-md)' }}>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${pipelineStatus.progress || 0}%`,
                    background: progressColor || undefined,
                  }}
                />
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                {pipelineStatus.message}
              </p>

              {status === 'error' && (
                <div className="col">
                  <Notice kind="error">
                    <b>
                      {pipelineStatus.stage
                        ? `Failed during ${pipelineStatus.stage}`
                        : 'Failed before any stage started'}
                      {pipelineStatus.error_type ? ` — ${pipelineStatus.error_type}` : ''}
                    </b>
                    {pipelineStatus.error && <> {pipelineStatus.error}</>}
                    {/* A backend older than this page reports neither a stage
                        nor an error field, and the panel would otherwise be an
                        empty red bar under a message in a format this build no
                        longer produces. */}
                    {!pipelineStatus.error && !pipelineStatus.stages?.length && (
                      <> The backend reported no stage breakdown for this run, which
                        means it is running older code than this page. Restart it and
                        run again.</>
                    )}
                  </Notice>
                  {pipelineStatus.traceback && (
                    <>
                      <button className="btn btn-sm" onClick={() => setShowTrace((v) => !v)}>
                        <Icon name={showTrace ? 'chevronUp' : 'chevronDown'} size={11} />
                        {showTrace ? ' Hide traceback' : ' Show traceback'}
                      </button>
                      {showTrace && <pre className="trace">{pipelineStatus.traceback}</pre>}
                    </>
                  )}
                </div>
              )}

              {showLogs && (
                <>
                  {logFile && <code className="muted break-all" style={{ fontSize: 'var(--text-xs)' }}>{logFile}</code>}
                  <div className="log-view">
                    {logs.length === 0 && <div className="muted">No log records for this run yet.</div>}
                    {logs.map((r, i) => (
                      <div className="log-line" key={`${r.ts}-${i}`}>
                        <span className="log-ts">{r.ts?.slice(11, 23) || ''}</span>
                        <span className="log-level" style={{ color: LEVEL_COLOR[r.level] }}>{r.level}</span>
                        <span className="log-msg">
                          {r.message}
                          {r.traceback && <pre className="trace">{r.traceback}</pre>}
                        </span>
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </>
              )}

              {status === 'completed' && pipelineStatus.summary && (
                <div className="two-col">
                  {Object.entries(pipelineStatus.summary.steps || {}).map(([step, data]) => (
                    <div key={step} className="offline-stat">
                      <div className="offline-stat-label">{step}</div>
                      <div className="offline-stat-sub mono" style={{ whiteSpace: 'pre-wrap' }}>
                        {typeof data === 'object' && data !== null
                          ? Object.entries(data)
                            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                            .join('\n')
                          : String(data)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {status === 'completed' && pipelineStatus.finished_at && (
                <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                  Finished {fmtTimestamp(pipelineStatus.finished_at)}.
                </p>
              )}
            </div>
          </Panel>
        )}

        {!pipelineStatus && (
          <Empty icon="database" title="No pipeline run in this session">
            Upload an export, fetch live blockchain data, or generate a sample to
            start one. Progress, stage results and the backend's own log all appear
            here while it runs.
          </Empty>
        )}
      </div>
    </div>
  );
}
