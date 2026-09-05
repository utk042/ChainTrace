import { useState } from 'react';
import Icon from '../Icon';

/**
 * Everything known about the selected entity, in one panel.
 *
 * The previous inspector showed three things — id, type badge, anomaly score
 * — which is not enough to decide anything, so every click ended in a trip to
 * the Wallets page. This pulls the behavioural features, the alerts raised
 * against the entity, its counterparties and its cluster into the place where
 * the investigator is already looking.
 */

const TYPE_LABEL = {
  wallet: 'Wallet',
  ip: 'IP address',
  transaction: 'Transaction',
};

function riskColor(score) {
  if (score >= 90) return 'var(--accent-critical)';
  if (score >= 70) return 'var(--accent-high)';
  if (score >= 40) return 'var(--accent-elevated)';
  return 'var(--accent)';
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtBtc(v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })} BTC`;
}

function shortId(id, head = 10, tail = 8) {
  if (!id || id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function Row({ label, value, mono = false }) {
  return (
    <div className="inspector-row">
      <span className="inspector-row-label">{label}</span>
      <span className={`inspector-row-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ title, children, defaultOpen = true, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="inspector-section">
      <button className="inspector-section-head" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
        <span>{title}</span>
        {count !== undefined && <span className="inspector-section-count">{count}</span>}
      </button>
      {open && <div className="inspector-section-body">{children}</div>}
    </div>
  );
}

export default function NodeInspector({
  detail,
  loading,
  onClose,
  onFocus,
  onExpand,
  onSelectNode,
  onPathFrom,
  onReload,
  expanding,
}) {
  const [copied, setCopied] = useState(false);
  if (!detail) return null;

  const id = detail.id;
  const type = detail.node_type || 'unknown';
  const features = detail.features || {};
  const score = detail.anomaly_score || 0;
  // The backend explicitly reported no record for this entity. Rendering the
  // normal panel with everything blank made an unresolvable node look like an
  // uneventful one: a "Wallet · UNKNOWN" header, an empty connections list and
  // no explanation. It has a reason; show it.
  const missing = detail.found === false && !loading;

  const copy = () => {
    navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  return (
    <aside className="graph-inspector">
      <header className="inspector-head">
        <div className="inspector-head-titles">
          <span className={`badge ${type === 'wallet' ? 'info' : type === 'ip' ? 'purple' : ''}`}>
            {TYPE_LABEL[type] || type}
          </span>
          {detail.risk_tier && (
            <span className={`badge ${detail.risk_tier.toLowerCase()}`}>{detail.risk_tier}</span>
          )}
          {detail.cluster_id !== null && detail.cluster_id !== undefined && (
            <span className="badge">Cluster {detail.cluster_id}</span>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className="inspector-id" title={id}>
        <code>{shortId(id, 14, 10)}</code>
        <button className="icon-btn" onClick={copy} title="Copy full identifier">
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
      </div>

      {score > 0 && (
        <div className="inspector-score">
          <div className="inspector-score-head">
            <span>ANOMALY SCORE</span>
            <b style={{ color: riskColor(score) }}>{score.toFixed(1)}</b>
          </div>
          <div className="inspector-score-track">
            <div
              className="inspector-score-fill"
              style={{ width: `${Math.min(100, score)}%`, background: riskColor(score) }}
            />
          </div>
        </div>
      )}

      <div className="inspector-actions">
        <button className="btn btn-outline" onClick={() => onFocus(id)}>
          <Icon name="crosshair" size={13} /> Centre
        </button>
        <button className="btn btn-outline" onClick={() => onExpand(id)} disabled={expanding}>
          <Icon name="expand" size={13} /> {expanding ? 'Expanding…' : 'Expand'}
        </button>
        <button className="btn btn-outline" onClick={() => onPathFrom(id)}>
          <Icon name="route" size={13} /> Trace
        </button>
      </div>

      {loading && <div className="inspector-loading">Loading entity record…</div>}

      {missing && (
        <div className="inspector-missing">
          <Icon name="alertTriangle" size={14} />
          <div>
            <b>No record for this entity</b>
            <p>
              {detail.detail
                || 'The backend has no stored record for this identifier.'}
            </p>
            {detail.reason === 'not_in_graph' && (
              <button className="btn btn-outline" onClick={onReload}>
                <Icon name="refresh" size={12} /> Reload graph
              </button>
            )}
          </div>
        </div>
      )}

      {detail.enrichment_error && (
        <div className="inspector-missing">
          <Icon name="alertTriangle" size={14} />
          <div>
            <b>Details could not be loaded</b>
            {/* Without this the panel showed the node's graph position and
                nothing else, which is indistinguishable from a wallet that
                genuinely has no features or alerts. */}
            <p>
              The entity is in the graph, but reading its features and alerts
              from the database failed: <code>{detail.enrichment_error}</code>
            </p>
          </div>
        </div>
      )}

      <div className={`inspector-scroll${missing ? ' is-muted' : ''}`}>
        <Section title="Connections" count={detail.degree}>
          <Row label="Total links" value={fmtNum(detail.degree)} />
          {Object.entries(detail.neighbor_types || {}).map(([t, n]) => (
            <Row key={t} label={TYPE_LABEL[t] || t} value={fmtNum(n)} />
          ))}
        </Section>

        {type === 'wallet' && detail.features && (
          <>
            <Section title="Behaviour">
              <Row label="Transactions" value={fmtNum(features.tx_count)} />
              <Row label="Received" value={fmtBtc(features.total_received)} />
              <Row label="Sent" value={fmtBtc(features.total_sent)} />
              <Row label="Avg amount" value={fmtBtc(features.avg_tx_amount)} />
              <Row label="Fan-in / fan-out"
                   value={`${fmtNum(features.fan_in_degree)} / ${fmtNum(features.fan_out_degree)}`} />
              <Row label="Velocity 1h / 24h"
                   value={`${fmtNum(features.velocity_1h, 1)} / ${fmtNum(features.velocity_24h, 1)} tx`} />
              <Row label="Round-amount ratio"
                   value={features.round_amount_ratio != null
                     ? `${(features.round_amount_ratio * 100).toFixed(0)}%` : '—'} />
              <Row label="Unique IPs / countries"
                   value={`${fmtNum(features.unique_ips)} / ${fmtNum(features.unique_countries)}`} />
              <Row label="Age" value={features.age_days != null ? `${fmtNum(features.age_days, 1)} d` : '—'} />
              <Row label="First seen" mono value={features.first_seen?.slice(0, 19) || '—'} />
              <Row label="Last seen" mono value={features.last_seen?.slice(0, 19) || '—'} />
            </Section>

            <Section title="Structural findings">
              <Row label="Peel-chain depth" value={fmtNum(features.peel_chain_depth)} />
              <Row label="Peel-chain role" value={features.peel_chain_role || 'none'} />
              <Row label="Mixer interactions" value={fmtNum(features.mixer_interaction_count)} />
              <Row label="Hops from watchlist"
                   value={features.darknet_proximity_hops ?? '—'} />
            </Section>
          </>
        )}

        {type === 'transaction' && detail.features && (
          <Section title="Transaction">
            <Row label="Timestamp" mono value={features.timestamp?.slice(0, 19) || '—'} />
            <Row label="Inputs → outputs"
                 value={`${fmtNum(features.input_count)} → ${fmtNum(features.output_count)}`} />
            <Row label="Total in" value={fmtBtc(features.total_input)} />
            <Row label="Total out" value={fmtBtc(features.total_output)} />
            <Row label="Fee" value={fmtBtc(features.fee)} />
            <Row label="Script type" value={features.script_type || '—'} />
            <Row label="Source IP" mono value={features.src_ip || '—'} />
            <Row label="Dest IP" mono value={features.dst_ip || '—'} />
          </Section>
        )}

        {type === 'ip' && (
          <Section title="Network">
            {detail.geo ? (
              <>
                <Row label="Country" value={detail.geo.country || 'unknown'} />
                <Row label="City" value={detail.geo.city || 'unknown'} />
                <Row label="ASN" value={detail.geo.asn || 'unknown'} />
                <Row label="Organisation" value={detail.geo.org || 'unknown'} />
                <Row label="Observations" value={fmtNum(detail.geo.hit_count)} />
              </>
            ) : (
              <p className="inspector-note">
                No GeoIP record. Real on-chain datasets carry no network layer,
                so IP nodes only appear for operator-supplied capture data.
              </p>
            )}
          </Section>
        )}

        {detail.alerts?.length > 0 && (
          <Section title="Alerts" count={detail.alerts.length}>
            {detail.alerts.map((a) => (
              <div key={a.alert_id} className="inspector-alert">
                <div className="inspector-alert-head">
                  <span className={`badge ${a.risk_tier?.toLowerCase() || 'info'}`}>{a.risk_tier}</span>
                  <span className="inspector-alert-model">{a.model}</span>
                  <b>{a.confidence?.toFixed(1)}</b>
                </div>
                <p>{a.description}</p>
              </div>
            ))}
          </Section>
        )}

        {detail.counterparties?.length > 0 && (
          <Section title="Top counterparties" count={detail.counterparties.length}>
            {detail.counterparties.map((c) => (
              <button key={c.id} className="inspector-link-row" onClick={() => onSelectNode(c.id)}>
                <span className={`legend-dot ${c.node_type}`} />
                <code>{shortId(c.id, 8, 6)}</code>
                <span className="inspector-link-meta">
                  {c.edge_type?.replace(/_/g, ' ')}
                  {c.amount != null && ` · ${Number(c.amount).toFixed(4)}`}
                </span>
              </button>
            ))}
          </Section>
        )}
      </div>
    </aside>
  );
}
