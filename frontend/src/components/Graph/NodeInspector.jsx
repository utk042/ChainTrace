import Icon from '../Icon';
import Collapse from '../ui/Collapse';
import CopyButton from '../ui/CopyButton';
import { Loading, Notice } from '../ui/States';
import {
  shortId, fmtNum, fmtBtc, fmtInt, fmtTimestamp, scoreVar,
} from '../../services/format';

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
  ip: 'IP address',
  transaction: 'Transaction',
};

function Row({ label, value, mono = false }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className={`prop-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
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
          <span className="detail-head-title">{shortId(id, 16, 12)}</span>
          <span className="detail-head-sub">{TYPE_LABEL[type] || type}</span>
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

      <div className="id-block">
        <code>{id}</code>
        <CopyButton value={id} title="Copy full identifier" />
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
        <Collapse title="Connections" count={detail.degree}>
          <div className="prop-list">
            <Row label="Total links" value={fmtInt(detail.degree)} />
            {Object.entries(detail.neighbor_types || {}).map(([t, n]) => (
              <Row key={t} label={TYPE_LABEL[t] || t} value={fmtInt(n)} />
            ))}
          </div>
        </Collapse>

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
                  <b>{a.confidence?.toFixed(1)}</b>
                </div>
                <p>{a.description}</p>
              </div>
            ))}
          </Collapse>
        )}

        {detail.counterparties?.length > 0 && (
          <Collapse title="Top counterparties" count={detail.counterparties.length}>
            {detail.counterparties.map((c) => (
              <button
                key={c.id}
                type="button"
                className="link-row"
                onClick={() => onSelectNode(c.id)}
                title={c.id}
              >
                <span className={`legend-dot ${c.node_type}`} />
                <code>{shortId(c.id, 10, 6)}</code>
                <span className="link-row-meta">
                  {c.edge_type?.replace(/_/g, ' ')}
                  {c.amount != null && ` · ${Number(c.amount).toFixed(4)}`}
                </span>
              </button>
            ))}
          </Collapse>
        )}
      </div>
    </div>
  );
}
