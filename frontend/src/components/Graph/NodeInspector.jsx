import { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon';
import Collapse from '../ui/Collapse';
import CopyButton from '../ui/CopyButton';
import { Loading, Notice } from '../ui/States';
import {
  shortId, fmtNum, fmtBtc, fmtInt, fmtTimestamp, fmtScore, scoreVar,
} from '../../services/format';
import { getNotes, createNote, deleteNote } from '../../services/api';

/**
 * Everything known about the selected entity, in one panel.
 *
 * An earlier inspector showed three things — id, type badge, anomaly score —
 * which is not enough to decide anything, so every click ended in a trip to
 * the Wallets page. This pulls the behavioural features, the alerts raised
 * against the entity, its counterparties and its cluster into the place
 * where the investigator is already looking.
 */

const TYPE_LABEL = {
  wallet: 'Wallet',
  entity: 'Entity',
  ip: 'IP address',
  transaction: 'Transaction',
};

/** Strip the synthetic prefix a collapsed actor is addressed by. */
const ENTITY_PREFIX = 'entity:';
const baseAddress = (id) => (
  typeof id === 'string' && id.startsWith(ENTITY_PREFIX) ? id.slice(ENTITY_PREFIX.length) : id
);

function Row({ label, value, mono = false }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className={`prop-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}


/**
 * One direction of a wallet's links.
 *
 * Rendered as its own group rather than a column in a combined list: an
 * investigator reads "what came in" and "what went out" as two questions,
 * and a `direction` field buried in a row of metadata does not answer either
 * at a glance.
 */
function CounterpartyGroup({ title, icon, rows, note, onSelectNode }) {
  if (!rows?.length) return null;
  return (
    <Collapse title={title} count={rows.length} icon={icon}>
      {note && <p className="inspector-note">{note}</p>}
      {rows.map((c, i) => (
        <button
          key={`${c.id}-${c.direction}-${i}`}
          type="button"
          className="link-row"
          onClick={() => onSelectNode(c.id)}
          title={c.id}
        >
          <span className={`legend-dot ${c.node_type}`} />
          <code>{shortId(c.id, 10, 6)}</code>
          <span className="link-row-meta">
            {c.edge_type?.replace(/_/g, ' ')}
            {c.amount != null && ` · ${Number(c.amount).toFixed(4)} BTC`}
          </span>
        </button>
      ))}
    </Collapse>
  );
}

/**
 * Findings recorded against this entity.
 *
 * Notes go to the backend, not to this browser: they are what an analyst
 * concluded and why, which is case material. One kept in local storage is
 * lost with a cleared cache, invisible to a colleague on the same data, and
 * missing from an export.
 */
function NotesPanel({ entityId, entityType }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [author, setAuthor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!entityId) return;
    try {
      const res = await getNotes(entityId);
      setNotes(res.data?.notes || []);
      setError(null);
    } catch {
      setNotes([]);
      setError('Notes could not be loaded.');
    }
  }, [entityId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await createNote({ entity_id: entityId, entity_type: entityType, body, author: author.trim() || null });
      setDraft('');
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.detail
        || 'The note could not be saved. In snapshot mode there is no backend to write to.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (noteId) => {
    setBusy(true);
    try {
      await deleteNote(noteId);
      await load();
    } catch {
      setError('The note could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Collapse title="Notes & findings" count={notes.length || undefined} icon="edit">
      <div className="notes-panel">
        {error && <Notice kind="warn">{error}</Notice>}

        {notes.map((n) => (
          <div key={n.note_id} className="note-item">
            <div className="note-item-head">
              <span className="note-item-meta">
                {n.author ? `${n.author} · ` : ''}
                {n.created_at ? String(n.created_at).replace('T', ' ').slice(0, 16) : ''}
                {n.updated_at && n.updated_at !== n.created_at ? ' (edited)' : ''}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => remove(n.note_id)}
                disabled={busy}
                aria-label="Delete this note"
                title="Delete this note"
              >
                <Icon name="trash" size={11} />
              </button>
            </div>
            <p className="note-item-body">{n.body}</p>
          </div>
        ))}

        {notes.length === 0 && (
          <p className="inspector-note">
            No findings recorded against this entity yet.
          </p>
        )}

        <textarea
          className="input note-draft"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What did you conclude about this entity, and why?"
          maxLength={8000}
        />
        <div className="note-actions">
          <input
            className="input note-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name (optional)"
            maxLength={120}
          />
          <button className="btn btn-primary" onClick={save} disabled={busy || !draft.trim()}>
            {busy ? 'Saving…' : 'Save finding'}
          </button>
        </div>
        <p className="inspector-note">
          Notes are stored with the case, not in this browser, so they survive
          a cleared cache and are visible to anyone else working this dataset.
        </p>
      </div>
    </Collapse>
  );
}

export default function NodeInspector({
  detail,
  loading,
  onClose,
  onFocus,
  onExpand,
  onIsolate,
  onSelectNode,
  onPathFrom,
  onReload,
  expanding,
}) {
  if (!detail) return null;

  const id = detail.id;
  const type = detail.node_type || 'unknown';
  const features = detail.features || {};
  const score = detail.anomaly_score || 0;
  // The backend explicitly reported no record for this entity. Rendering the
  // normal panel with everything blank made an unresolvable node look like an
  // uneventful one: a "Wallet · UNKNOWN" header, an empty connections list
  // and no explanation. It has a reason; show it.
  const missing = detail.found === false && !loading;

  return (
    <div className="inspector">
      <div className="detail-head">
        <div className="detail-head-main">
          <span className="detail-head-title">{shortId(baseAddress(id), 16, 12)}</span>
          <span className="detail-head-sub">
            {type === 'entity' && detail.entity_size
              ? `Entity · ${fmtInt(detail.entity_size)} addresses`
              : TYPE_LABEL[type] || type}
          </span>
          <div className="detail-badges">
            {detail.risk_tier && (
              <span className={`badge ${detail.risk_tier.toLowerCase()}`}>{detail.risk_tier}</span>
            )}
            {detail.cluster_id !== null && detail.cluster_id !== undefined && (
              <span className="badge info">Cluster {detail.cluster_id}</span>
            )}
            {detail.degree != null && <span className="badge">{fmtInt(detail.degree)} links</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Clear selection (Esc)" aria-label="Clear selection">
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* The address, not the internal handle. An "entity:" id is this
          process's way of naming a group; pasted into a block explorer, a
          case file or a warrant it is meaningless, so it is never shown and
          never copied. */}
      <div className="id-block">
        <code>{baseAddress(id)}</code>
        <CopyButton value={baseAddress(id)} title="Copy full identifier" />
      </div>

      {score > 0 && (
        <div className="inspector-score">
          <div className="inspector-score-head">
            <span>Anomaly score</span>
            <b style={{ color: scoreVar(score) }}>{score.toFixed(1)}</b>
          </div>
          <div className="inspector-score-track">
            <div
              className="inspector-score-fill"
              style={{ width: `${Math.min(100, score)}%`, background: scoreVar(score) }}
            />
          </div>
        </div>
      )}

      <div className="inspector-actions">
        <button className="btn" onClick={() => onFocus(id)} title="Centre camera on this node">
          <Icon name="crosshair" size={12} /> Centre
        </button>
        <button className="btn" onClick={() => onExpand(id)} disabled={expanding} title="Expand 1-hop neighbours">
          <Icon name="expand" size={12} /> {expanding ? 'Expanding…' : 'Expand'}
        </button>
        {onIsolate && (
          <button className="btn" onClick={() => onIsolate(id)} title="Isolate ego-network around this node">
            <Icon name="layers" size={12} /> Isolate
          </button>
        )}
        <button className="btn" onClick={() => onPathFrom(id)} title="Trace connection from this node">
          <Icon name="route" size={12} /> Trace
        </button>
      </div>

      {loading && <Loading label="Loading entity record…" />}

      {missing && (
        <div className="inspector-missing">
          <Icon name="alertTriangle" size={14} />
          <div>
            <b>No record for this entity</b>
            <p>{detail.detail || 'The backend has no stored record for this identifier.'}</p>
            {detail.reason === 'not_in_graph' && (
              <button className="btn btn-sm" onClick={onReload}>
                <Icon name="refresh" size={11} /> Reload graph
              </button>
            )}
          </div>
        </div>
      )}

      {detail.enrichment_error && (
        <div style={{ padding: 'var(--space-md)' }}>
          {/* Without this the panel showed the node's graph position and
              nothing else, which is indistinguishable from a wallet that
              genuinely has no features or alerts. */}
          <Notice kind="warn">
            <b>Details could not be loaded.</b> The entity is in the graph, but
            reading its features and alerts from the database failed:{' '}
            <code>{detail.enrichment_error}</code>
          </Notice>
        </div>
      )}

      <div className={`inspector-scroll${missing ? ' is-muted' : ''}`}>
        {detail.summary && (
          <Collapse title="In plain language" defaultOpen>
            <div className="plain-summary">
              {detail.summary.what_it_is?.map((line) => <p key={line}>{line}</p>)}
              {detail.summary.why_flagged?.length > 0 && (
                <>
                  <div className="section-label">Why it was flagged</div>
                  {detail.summary.why_flagged.map((line) => <p key={line}>{line}</p>)}
                </>
              )}
              {detail.summary.caveat && (
                <p className="plain-summary-caveat">{detail.summary.caveat}</p>
              )}
            </div>
          </Collapse>
        )}

        <Collapse title="Connections" count={detail.degree}>
          <div className="prop-list">
            <Row label="Total links" value={fmtInt(detail.degree)} />
            {Object.entries(detail.neighbor_types || {}).map(([t, n]) => (
              <Row key={t} label={TYPE_LABEL[t] || t} value={fmtInt(n)} />
            ))}
          </div>
        </Collapse>

        {type === 'entity' && (
          <>
            <Collapse title="Behaviour" count={detail.entity_size}>
              <div className="prop-list">
                <Row label="Addresses held" value={fmtInt(detail.entity_size)} />
                <Row label="Transactions" value={fmtInt(features.tx_count)} />
                <Row label="Received" value={fmtBtc(features.total_received)} />
                <Row label="Sent" value={fmtBtc(features.total_sent)} />
                <Row label="First seen" mono value={fmtTimestamp(features.first_seen)} />
                <Row label="Last seen" mono value={fmtTimestamp(features.last_seen)} />
                {features.worst_address && (
                  <Row label="Most anomalous" mono value={shortId(features.worst_address, 10, 8)} />
                )}
              </div>
            </Collapse>

            {/* The evidence for the grouping, named. Common-input-ownership is
                a heuristic, and an investigator has to be able to go and read
                the transactions it rests on rather than take it on trust. */}
            {detail.cospend_witnesses?.length > 0 && (
              <Collapse title="Grouped by" count={detail.cospend_witnesses.length}>
                <div className="prop-list">
                  {detail.cospend_witnesses.map((txid) => (
                    <button
                      key={txid}
                      type="button"
                      className="link-row"
                      onClick={() => onSelectNode(txid)}
                      title={txid}
                    >
                      <span className="legend-dot transaction" />
                      <code>{shortId(txid, 10, 6)}</code>
                      <span className="link-row-meta">spent these addresses together</span>
                    </button>
                  ))}
                </div>
              </Collapse>
            )}

            <Collapse
              title="Member addresses"
              count={detail.entity_size}
              defaultOpen={false}
            >
              <div className="prop-list">
                {(detail.member_scores?.length
                  ? detail.member_scores
                  : (detail.members || []).map((address) => ({ address }))
                ).map((m) => (
                  <button
                    key={m.address}
                    type="button"
                    className="link-row"
                    onClick={() => onSelectNode(m.address)}
                    title={m.address}
                  >
                    <span className="legend-dot wallet" />
                    <code>{shortId(m.address, 10, 6)}</code>
                    <span className="link-row-meta">
                      {m.anomaly_score != null
                        ? `score ${Number(m.anomaly_score).toFixed(0)}${m.risk_tier ? ` · ${m.risk_tier}` : ''}`
                        : 'member address'}
                    </span>
                  </button>
                ))}
                {detail.members_truncated && (
                  <span className="muted">
                    Showing the first {fmtInt((detail.members || []).length)} of{' '}
                    {fmtInt(detail.entity_size)}.
                  </span>
                )}
              </div>
            </Collapse>
          </>
        )}

        {type === 'wallet' && detail.features && (
          <>
            <Collapse title="Behaviour">
              <div className="prop-list">
                <Row label="Transactions" value={fmtInt(features.tx_count)} />
                <Row label="Received" value={fmtBtc(features.total_received)} />
                <Row label="Sent" value={fmtBtc(features.total_sent)} />
                <Row label="Average amount" value={fmtBtc(features.avg_tx_amount)} />
                <Row
                  label="Fan-in / fan-out"
                  value={`${fmtInt(features.fan_in_degree)} / ${fmtInt(features.fan_out_degree)}`}
                />
                <Row
                  label="Velocity 1h / 24h"
                  value={`${fmtNum(features.velocity_1h, 1)} / ${fmtNum(features.velocity_24h, 1)} tx`}
                />
                <Row
                  label="Round-amount ratio"
                  value={features.round_amount_ratio != null
                    ? `${(features.round_amount_ratio * 100).toFixed(0)}%`
                    : '—'}
                />
                <Row
                  label="Unique IPs / countries"
                  value={`${fmtInt(features.unique_ips)} / ${fmtInt(features.unique_countries)}`}
                />
                <Row label="Age" value={features.age_days != null ? `${fmtNum(features.age_days, 1)} days` : '—'} />
                <Row label="First seen" mono value={fmtTimestamp(features.first_seen)} />
                <Row label="Last seen" mono value={fmtTimestamp(features.last_seen)} />
              </div>
            </Collapse>

            <Collapse title="Structural findings">
              <div className="prop-list">
                <Row label="Peel-chain depth" value={fmtInt(features.peel_chain_depth)} />
                <Row label="Peel-chain role" value={features.peel_chain_role || 'none'} />
                <Row label="Mixer interactions" value={fmtInt(features.mixer_interaction_count)} />
                <Row label="Hops from watchlist" value={features.darknet_proximity_hops ?? '—'} />
              </div>
            </Collapse>
          </>
        )}

        {type === 'transaction' && detail.features && (
          <Collapse title="Transaction">
            <div className="prop-list">
              <Row label="Timestamp" mono value={fmtTimestamp(features.timestamp)} />
              <Row
                label="Inputs → outputs"
                value={`${fmtInt(features.input_count)} → ${fmtInt(features.output_count)}`}
              />
              <Row label="Total in" value={fmtBtc(features.total_input)} />
              <Row label="Total out" value={fmtBtc(features.total_output)} />
              <Row label="Fee" value={fmtBtc(features.fee, 8)} />
              <Row label="Script type" value={features.script_type || '—'} />
              <Row label="Source IP" mono value={features.src_ip || '—'} />
              <Row label="Destination IP" mono value={features.dst_ip || '—'} />
            </div>
          </Collapse>
        )}

        {type === 'ip' && (
          <Collapse title="Network">
            {detail.geo ? (
              <div className="prop-list">
                <Row label="Country" value={detail.geo.country || 'unknown'} />
                <Row label="City" value={detail.geo.city || 'unknown'} />
                <Row label="ASN" value={detail.geo.asn || 'unknown'} />
                <Row label="Organisation" value={detail.geo.org || 'unknown'} />
                <Row label="Observations" value={fmtInt(detail.geo.hit_count)} />
              </div>
            ) : (
              <p className="inspector-note">
                No GeoIP record. Real on-chain datasets carry no network layer,
                so IP nodes only appear for operator-supplied capture data.
              </p>
            )}
          </Collapse>
        )}

        {detail.alerts?.length > 0 && (
          <Collapse title="Alerts" count={detail.alerts.length}>
            {detail.alerts.map((a) => (
              <div key={a.alert_id} className={`alert-note ${a.risk_tier?.toLowerCase() || ''}`}>
                <div className="alert-note-head">
                  <span className={`badge ${a.risk_tier?.toLowerCase() || 'info'}`}>{a.risk_tier}</span>
                  <span className="mono muted">{a.model}</span>
                  <b title="Risk score: how far this entity's behaviour sits from the typical wallet in this dataset. Not a probability of wrongdoing.">
                    {fmtScore(a.risk_score ?? a.confidence, 1)}
                  </b>
                  {a.evidence_confidence && (
                    <span className={`badge evidence-${a.evidence_confidence.toLowerCase()}`}
                          title={a.evidence_rationale || 'How well supported this finding is.'}>
                      {a.evidence_confidence}
                    </span>
                  )}
                </div>
                <p>{a.description}</p>
              </div>
            ))}
          </Collapse>
        )}

        {detail.counterparties?.length > 0 && (
          <>
            {/* Split by direction. Listed together, a wallet's links were an
                undifferentiated set and the first question anyone asks of a
                wallet — what came in, what went out — could not be answered
                from the panel at all. */}
            <CounterpartyGroup
              title="Money in"
              icon="arrowDown"
              rows={detail.counterparties.filter((c) => c.direction === 'in')}
              onSelectNode={onSelectNode}
            />
            <CounterpartyGroup
              title="Money out"
              icon="arrowUp"
              rows={detail.counterparties.filter((c) => c.direction === 'out')}
              onSelectNode={onSelectNode}
            />
            <CounterpartyGroup
              title="Related, no value moved"
              icon="link"
              note="Co-input and network observations. These are inferences about
                    common control or where traffic was seen, not payments."
              rows={detail.counterparties.filter((c) => c.direction !== 'in' && c.direction !== 'out')}
              onSelectNode={onSelectNode}
            />
          </>
        )}

        <NotesPanel entityId={id} entityType={type} />
      </div>
    </div>
  );
}
