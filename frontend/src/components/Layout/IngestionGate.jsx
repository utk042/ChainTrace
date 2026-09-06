import Icon from '../Icon';
import { useSession } from '../../state/SessionProvider';

const STEP_ICONS = {
  done: 'check', error: 'close', running: 'circleDot', skipped: 'circle', pending: 'circle',
};

const STEP_COLORS = {
  done: 'var(--status-ok)',
  running: 'var(--risk-elevated)',
  error: 'var(--risk-critical)',
};

/**
 * What a data view shows while an ingest run is in flight.
 *
 * The pipeline's first act is to truncate every table, and the ML stage that
 * follows rewrites the wallet scores, the clusters and the alerts. Anything
 * read in between belongs to no dataset at all: a wallet list from the run
 * before it, joined against alerts from the run being written, on a graph
 * built from neither. That is not a slow page — it is a page of evidence that
 * never existed, and in a tool whose output is meant to be citable it is the
 * one thing that must not be on screen. So the views are held back, and the
 * run says where it has got to instead.
 */
export default function IngestionGate({ view }) {
  const { ingest, openTab } = useSession();

  const stages = ingest?.stages || [];
  const progress = Math.max(0, Math.min(100, ingest?.progress || 0));

  return (
    <div className="ingest-gate">
      <div className="ingest-gate-card">
        <span className="ingest-gate-icon">
          <span className="spinner" />
        </span>

        <h3>Ingestion in progress</h3>
        <p>
          {view ? `${view} is` : 'This view is'} held back until the run
          finishes. The pipeline has cleared the tables and is writing the new
          dataset, so anything drawn now would belong partly to the run before
          it and partly to this one.
        </p>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {ingest?.message && (
          <p className="ingest-gate-message">{ingest.message}</p>
        )}

        {stages.length > 0 && (
          <div className="ingest-gate-stages">
            {stages.map((s) => (
              <span
                className="ingest-gate-stage"
                key={s.key}
                style={{ color: STEP_COLORS[s.status] || 'var(--text-tertiary)' }}
              >
                <Icon name={STEP_ICONS[s.status] || 'circle'} size={11} />
                {s.label}
              </span>
            ))}
          </div>
        )}

        <div className="ingest-gate-actions">
          <button type="button" className="btn btn-primary" onClick={() => openTab('ingest')}>
            <Icon name="uploadCloud" size={12} /> Open Ingest
          </button>
          {ingest?.run_id && (
            <span className="muted mono" title={ingest.run_id}>run {ingest.run_id}</span>
          )}
        </div>
      </div>
    </div>
  );
}
