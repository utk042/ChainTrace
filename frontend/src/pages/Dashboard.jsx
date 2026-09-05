import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import {
  getTimeline, getRiskDistribution, getTopAlerts, getGraphStats,
} from '../services/api';
import { useSession } from '../state/SessionProvider';
import { useCommands } from '../services/commands';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { useResizablePane } from '../hooks/useResizablePane';
import {
  shortId, fmtInt, fmtPct, fmtTimestamp, riskVar,
} from '../services/format';
import {
  RISK_COLORS, TYPE_COLORS, TEXT, chartAxis, chartValueAxis, chartTooltip,
} from '../theme';
import Icon from '../components/Icon';
import Panel from '../components/ui/Panel';
import Tabs from '../components/ui/Tabs';
import Menu, { MenuItem, MenuHeading } from '../components/ui/Menu';
import { HistogramGroup, HistogramRow } from '../components/ui/Histogram';
import { Loading, Empty, Notice } from '../components/ui/States';

const TIER_ORDER = ['Critical', 'High', 'Elevated', 'Low', 'Normal'];

const INTERVALS = [
  { key: 'day', label: 'By day' },
  { key: 'hour', label: 'By hour' },
];

/**
 * The case overview: the counters, the volume timeline, the risk make-up of
 * the wallet population, and the alerts worth opening first.
 *
 * Each panel is an independent read. `allSettled`, not `all`: one failed
 * request used to leave its panel at its initial empty value while the
 * others rendered, and a dashboard showing zeros for a figure it could not
 * fetch reads as a finding.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const { stats, statsError, statsLoading, refreshStats, backend } = useSession();

  const [interval, setIntervalKey] = useState('day');
  const [timeline, setTimeline] = useState([]);
  const [riskDist, setRiskDist] = useState([]);
  const [topAlerts, setTopAlerts] = useState([]);
  const [graphStats, setGraphStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);
  const [tab, setTab] = useState('activity');
  const narrow = useIsNarrow();
  const [showSummary, setShowSummary] = useState(!narrow);

  const { width: sideWidth, splitterProps } = useResizablePane('overview-summary', {
    initial: 300, min: 240, max: 460, edge: 'right',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const reads = [
      ['the activity timeline', () => getTimeline(interval), setTimeline],
      ['the risk distribution', getRiskDistribution, setRiskDist],
      ['the prioritised alerts', () => getTopAlerts(8), setTopAlerts],
      ['graph statistics', getGraphStats, setGraphStats],
    ];
    const results = await Promise.allSettled(reads.map(([, fetcher]) => fetcher()));
    const problems = [];
    results.forEach((result, i) => {
      const [label, , setter] = reads[i];
      if (result.status === 'fulfilled') setter(result.value.data);
      else problems.push(label);
    });
    setFailed(problems);
    setLoading(false);
  }, [interval]);

  useEffect(() => { load(); }, [load]);

  // Below the breakpoint this pane overlays the results, so shrinking the
  // window closes it rather than leaving the table hidden behind it.
  useEffect(() => { if (narrow) setShowSummary(false); }, [narrow]);

  useCommands({
    reload: () => { refreshStats(); load(); },
    'panel.summary': () => setShowSummary((v) => !v),
  });

  const orderedRisk = useMemo(() => TIER_ORDER
    .map((tier) => riskDist.find((r) => r.tier === tier))
    .filter(Boolean), [riskDist]);

  const riskTotal = orderedRisk.reduce((sum, r) => sum + r.count, 0) || 1;

  const alertMix = useMemo(() => ([
    { key: 'Critical', label: 'Critical', count: stats?.critical_alerts || 0, color: RISK_COLORS.Critical },
    { key: 'High', label: 'High', count: stats?.high_alerts || 0, color: RISK_COLORS.High },
    { key: 'Elevated', label: 'Elevated', count: stats?.elevated_alerts || 0, color: RISK_COLORS.Elevated },
  ]), [stats]);

  const entityMix = useMemo(() => ([
    { key: 'wallet', label: 'Wallets', count: stats?.total_wallets || 0, color: TYPE_COLORS.wallet, to: '/wallets' },
    { key: 'transaction', label: 'Transactions', count: stats?.total_transactions || 0, color: TYPE_COLORS.transaction, to: '/transactions' },
    { key: 'ip', label: 'IP addresses', count: stats?.total_ips || 0, color: TYPE_COLORS.ip, to: null },
  ]), [stats]);

  const timelineOption = useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { top: 24, right: 14, bottom: 30, left: 52 },
    legend: {
      show: true,
      top: 0,
      right: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: TEXT.tertiary, fontSize: 10 },
      data: ['Transactions', 'Alerts raised'],
    },
    xAxis: chartAxis({
      type: 'category',
      data: timeline.map((t) => (interval === 'hour'
        ? String(t.timestamp).slice(5, 16).replace('T', ' ')
        : String(t.timestamp).slice(0, 10))),
      // hideOverlap, so a long series thins its own labels instead of
      // overprinting them into an unreadable band.
      axisLabel: {
        color: TEXT.tertiary, fontSize: 10, fontFamily: 'IBM Plex Mono', hideOverlap: true,
      },
    }),
    yAxis: chartValueAxis({ type: 'value' }),
    series: [
      {
        name: 'Transactions',
        type: 'bar',
        data: timeline.map((t) => t.count),
        // Volume is the baseline; the alert series on top is the signal.
        itemStyle: { color: 'rgba(45, 114, 210, 0.55)' },
        barWidth: '58%',
      },
      {
        name: 'Alerts raised',
        type: 'bar',
        data: timeline.map((t) => t.anomaly_count),
        itemStyle: { color: RISK_COLORS.Critical },
        barWidth: '58%',
      },
    ],
    tooltip: chartTooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
  }), [timeline, interval]);

  const graphReady = graphStats?.ready;

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="page-toolbar-title">
          <Icon name="grid" size={14} />
          Case overview
        </span>

        <span className="toolbar-sep" />

        <div className="tool-group">
          <span className="tool-group-label">Timeline</span>
          <div className="tool-group-items">
            {INTERVALS.map((i) => (
              <button
                key={i.key}
                type="button"
                className={`tool-btn${interval === i.key ? ' active' : ''}`}
                onClick={() => setIntervalKey(i.key)}
              >
                <span>{i.label}</span>
              </button>
            ))}
          </div>
        </div>

        <span className="page-toolbar-spacer" />

        <button
          type="button"
          className={`tool-btn${showSummary ? ' active' : ''}`}
          onClick={() => setShowSummary((v) => !v)}
        >
          <Icon name="barChart" size={13} /> <span>Summary</span>
        </button>

        <button type="button" className="tool-btn" onClick={() => { refreshStats(); load(); }}>
          <Icon name="refresh" size={13} /> <span>Reload</span>
        </button>

        <Menu
          align="right"
          trigger={({ toggle, open }) => (
            <button type="button" className={`btn btn-primary${open ? ' active' : ''}`} onClick={toggle}>
              Actions <Icon name="chevronDown" size={11} />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuHeading>Go to</MenuHeading>
              <MenuItem close={close} icon="alertTriangle" label="Triage alerts" onSelect={() => navigate('/alerts')} />
              <MenuItem close={close} icon="graph" label="Open the graph" onSelect={() => navigate('/graph')} />
              <MenuItem close={close} icon="uploadCloud" label="Ingest more data" onSelect={() => navigate('/ingest')} />
            </>
          )}
        </Menu>
      </div>

      <div
        className={`browser${showSummary ? ' has-detail' : ''}`}
        style={{
          position: 'relative',
          gridTemplateColumns: showSummary ? `minmax(0, 1fr) ${sideWidth}px` : 'minmax(0, 1fr)',
          '--pane-detail': `${sideWidth}px`,
        }}
      >
        <section className="browser-pane">
          <div className="browser-scroll" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {statsError && <Notice kind="error">{statsError} The counters below are unknown, not zero.</Notice>}

            {failed.length > 0 && (
              <Notice kind="warn">
                <b>Incomplete</b> — the backend did not return {failed.join(', ')}.
                Those panels are blank because the request failed, not because
                there is nothing to show.
              </Notice>
            )}

            <div className="stat-strip">
              <button className="stat-tile" onClick={() => navigate('/transactions')}>
                <span className="stat-label">Transactions</span>
                <span className="stat-value">{statsLoading && !stats ? '…' : fmtInt(stats?.total_transactions)}</span>
                <span className="stat-sub">{stats?.last_ingest ? `ingested ${fmtTimestamp(stats.last_ingest)}` : 'no ingest recorded'}</span>
              </button>
              <button className="stat-tile" onClick={() => navigate('/wallets')}>
                <span className="stat-label">Wallets</span>
                <span className="stat-value">{statsLoading && !stats ? '…' : fmtInt(stats?.total_wallets)}</span>
                <span className="stat-sub">{fmtInt(stats?.clusters_detected)} clusters</span>
              </button>
              <div className="stat-tile">
                <span className="stat-label">IP addresses</span>
                <span className="stat-value">{statsLoading && !stats ? '…' : fmtInt(stats?.total_ips)}</span>
                <span className="stat-sub">network layer</span>
              </div>
              <button className="stat-tile" onClick={() => navigate('/alerts')}>
                <span className="stat-label">Open alerts</span>
                <span className="stat-value" style={{ color: stats?.total_alerts ? 'var(--risk-critical)' : undefined }}>
                  {statsLoading && !stats ? '…' : fmtInt(stats?.total_alerts)}
                </span>
                <span className="stat-sub">
                  {fmtInt(stats?.critical_alerts)} crit · {fmtInt(stats?.high_alerts)} high · {fmtInt(stats?.elevated_alerts)} elev
                </span>
              </button>
              <button className="stat-tile" onClick={() => navigate('/graph')}>
                <span className="stat-label">Flagged entities</span>
                <span className="stat-value">{statsLoading && !stats ? '…' : fmtInt(stats?.flagged_entities)}</span>
                <span className="stat-sub">
                  {graphReady ? `${fmtInt(graphStats.total_nodes)} graph nodes` : 'graph not built'}
                </span>
              </button>
            </div>

            <Panel
              icon="barChart"
              title="Activity"
              meta={stats?.model_name ? `scored by ${stats.model_name}` : undefined}
              style={{ flex: 'none' }}
            >
              <Tabs
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: 'activity', label: 'Volume & alerts' },
                  { key: 'risk', label: 'Wallet risk' },
                ]}
              />
              <div style={{ padding: 'var(--space-md)' }}>
                {loading ? (
                  <Loading label="Loading panels…" />
                ) : tab === 'activity' ? (
                  timeline.length === 0 ? (
                    <Empty icon="barChart" title="No activity to plot">
                      The backend returned no periods for this interval.
                    </Empty>
                  ) : (
                    <ReactECharts option={timelineOption} style={{ height: 240 }} notMerge />
                  )
                ) : orderedRisk.length === 0 ? (
                  <Empty icon="barChart" title="No wallet scores yet">
                    Risk tiers are assigned when the pipeline scores the wallet population.
                  </Empty>
                ) : (
                  <>
                    <div className="risk-bar">
                      {orderedRisk.map((r) => (
                        <div
                          key={r.tier}
                          className="risk-bar-seg"
                          style={{ width: `${(r.count / riskTotal) * 100}%`, background: RISK_COLORS[r.tier] }}
                          title={`${r.tier}: ${r.count.toLocaleString()} wallets`}
                        />
                      ))}
                    </div>
                    <div className="risk-legend">
                      {orderedRisk.map((r) => (
                        <span className="risk-legend-item" key={r.tier}>
                          <i className="risk-legend-swatch" style={{ background: RISK_COLORS[r.tier] }} />
                          {r.tier.toUpperCase()}
                          <b style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                            {((r.count / riskTotal) * 100).toFixed(0)}%
                          </b>
                          <span className="muted">({fmtInt(r.count)})</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Panel>

            <Panel
              icon="alertTriangle"
              title="Prioritised alerts"
              meta={stats?.total_alerts ? `${fmtInt(stats.total_alerts)} open` : undefined}
              actions={(
                <button className="btn btn-sm btn-minimal" onClick={() => navigate('/alerts')}>
                  View all <Icon name="arrowRight" size={11} />
                </button>
              )}
              style={{ flex: 'none' }}
            >
              {loading ? (
                <Loading label="Loading alerts…" />
              ) : topAlerts.length === 0 ? (
                <Empty icon="shieldCheck" title="No alerts raised">
                  The scoring pass produced no findings above the alerting threshold.
                </Empty>
              ) : (
                <div>
                  {topAlerts.map((alert) => (
                    <button
                      key={alert.alert_id}
                      type="button"
                      className="result-row"
                      onClick={() => navigate(`/alerts?focus=${encodeURIComponent(alert.alert_id)}`)}
                      title={alert.description}
                    >
                      <span className="result-row-main">
                        <span className="result-title">{shortId(alert.entity_id, 16, 10)}</span>
                        <span className="result-sub">{alert.description}</span>
                        <span className="result-meta">
                          <span>{alert.entity_type}</span>
                          <span>·</span>
                          <span>{alert.model}</span>
                          <span>·</span>
                          <span>{fmtTimestamp(alert.timestamp)}</span>
                        </span>
                      </span>
                      <span className="result-row-side">
                        <span className={`badge ${alert.risk_tier?.toLowerCase()}`}>{alert.risk_tier}</span>
                        <span className="mono" style={{ fontSize: 'var(--text-sm)', color: riskVar(alert.risk_tier) }}>
                          {fmtPct(alert.confidence)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </section>

        {showSummary && (
          <aside className="browser-pane" style={{ position: 'relative' }}>
            <div {...splitterProps} className={`${splitterProps.className} splitter-edge`} />
            <div className="browser-pane-head">
              <Icon name="barChart" size={12} />
              <span className="truncate">Histogram</span>
              <span className="head-actions">
                <button className="icon-btn" onClick={() => setShowSummary(false)} aria-label="Hide summary">
                  <Icon name="close" size={12} />
                </button>
              </span>
            </div>
            <div className="browser-scroll">
              <HistogramGroup title="Object types" total={fmtInt(
                (stats?.total_wallets || 0) + (stats?.total_transactions || 0) + (stats?.total_ips || 0),
              )}>
                {entityMix.map((row) => (
                  <HistogramRow
                    key={row.key}
                    label={row.label}
                    color={row.color}
                    count={row.count}
                    max={Math.max(...entityMix.map((r) => r.count), 1)}
                    onSelect={row.to ? () => navigate(row.to) : undefined}
                  />
                ))}
              </HistogramGroup>

              <HistogramGroup title="Alerts by tier" total={fmtInt(stats?.total_alerts)}>
                {alertMix.every((r) => r.count === 0) ? (
                  <div className="histogram-empty">No alerts raised.</div>
                ) : alertMix.map((row) => (
                  <HistogramRow
                    key={row.key}
                    label={row.label}
                    color={row.color}
                    count={row.count}
                    max={Math.max(...alertMix.map((r) => r.count), 1)}
                    onSelect={() => navigate(`/alerts?tier=${row.key}`)}
                  />
                ))}
              </HistogramGroup>

              <HistogramGroup title="Wallet risk" total={fmtInt(riskDist.reduce((s, r) => s + r.count, 0))}>
                {orderedRisk.length === 0 ? (
                  <div className="histogram-empty">No wallet scores yet.</div>
                ) : orderedRisk.map((r) => (
                  <HistogramRow
                    key={r.tier}
                    label={r.tier}
                    color={RISK_COLORS[r.tier]}
                    count={r.count}
                    max={Math.max(...orderedRisk.map((x) => x.count), 1)}
                    onSelect={() => navigate(`/wallets?tier=${r.tier}`)}
                  />
                ))}
              </HistogramGroup>

              <div className="section-label">Pipeline</div>
              <div className="prop-list">
                {[
                  ['Model', stats?.model_name || '—'],
                  ['Last ingest', stats?.last_ingest ? fmtTimestamp(stats.last_ingest) : 'never'],
                  ['Graph nodes', graphReady ? fmtInt(graphStats.total_nodes) : 'not built'],
                  ['Graph edges', graphReady ? fmtInt(graphStats.total_edges) : 'not built'],
                  ['Backend', backend.health?.version ? `v${backend.health.version}` : '—'],
                  ['Scoring', backend.health?.ml_backend || '—'],
                ].map(([label, value]) => (
                  <div className="prop-row" key={label}>
                    <span className="prop-label">{label}</span>
                    <span className="prop-value mono">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
