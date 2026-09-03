import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { getDashboardStats, getTimeline, getRiskDistribution, getTopAlerts } from '../services/api';
import {
  RISK_COLORS, ACCENT, chartAxis, chartValueAxis, chartTooltip,
} from '../theme';

const TIER_ORDER = ['Critical', 'High', 'Elevated', 'Low', 'Normal'];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [riskDist, setRiskDist] = useState([]);
  const [topAlerts, setTopAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getDashboardStats().then(r => setStats(r.data)),
      getTimeline('day').then(r => setTimeline(r.data)),
      getRiskDistribution().then(r => setRiskDist(r.data)),
      getTopAlerts(5).then(r => setTopAlerts(r.data)),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  const riskTotal = riskDist.reduce((sum, r) => sum + r.count, 0) || 1;
  const orderedRisk = TIER_ORDER
    .map(tier => riskDist.find(r => r.tier === tier))
    .filter(Boolean);

  const timelineOption = {
    backgroundColor: 'transparent',
    grid: { top: 20, right: 12, bottom: 28, left: 44 },
    xAxis: chartAxis({
      type: 'category',
      data: timeline.map(t => t.timestamp?.split('T')[0] || ''),
    }),
    yAxis: chartValueAxis({ type: 'value' }),
    series: [
      {
        name: 'Transactions',
        type: 'bar',
        data: timeline.map(t => t.count),
        // Volume is the baseline; the anomaly series on top is the signal.
        itemStyle: { color: 'rgba(139, 124, 246, 0.38)' },
        barWidth: '58%',
      },
      {
        name: 'Anomalies',
        type: 'bar',
        data: timeline.map(t => t.anomaly_count),
        itemStyle: { color: RISK_COLORS.Critical },
        barWidth: '58%',
      },
    ],
    tooltip: chartTooltip({ trigger: 'axis' }),
  };

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      {/* KPI strip */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Transactions</span>
          <span className="stat-value">{stats?.total_transactions?.toLocaleString() || '0'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Unique Wallets</span>
          <span className="stat-value">{stats?.total_wallets?.toLocaleString() || '0'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Unique IPs</span>
          <span className="stat-value">{stats?.total_ips?.toLocaleString() || '0'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Alerts</span>
          <span className="stat-value" style={{ color: 'var(--accent-critical)' }}>
            {stats?.total_alerts?.toLocaleString() || '0'}
          </span>
          <span className="stat-sub">
            {stats?.critical_alerts || 0} CRIT · {stats?.high_alerts || 0} HIGH · {stats?.elevated_alerts || 0} ELEV
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Clusters Detected</span>
          <span className="stat-value">{stats?.clusters_detected?.toLocaleString() || '0'}</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="two-column" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Transaction Volume — Timeline</span>
            <span className="card-meta">anomalies highlighted</span>
          </div>
          <ReactECharts option={timelineOption} style={{ height: 220 }} notMerge />
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Risk Distribution — Active Wallets</span>
          </div>
          <div className="risk-bar" style={{ marginTop: 'var(--space-lg)' }}>
            {orderedRisk.map(r => (
              <div
                key={r.tier}
                className="risk-bar-seg"
                style={{ width: `${(r.count / riskTotal) * 100}%`, background: RISK_COLORS[r.tier] }}
                title={`${r.tier}: ${r.count}`}
              />
            ))}
          </div>
          <div className="risk-legend">
            {orderedRisk.map(r => (
              <div className="risk-legend-item" key={r.tier}>
                <span className="risk-legend-swatch" style={{ background: RISK_COLORS[r.tier] }} />
                {r.tier.toUpperCase()} <span style={{ color: 'var(--text-primary)' }}>{((r.count / riskTotal) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Alerts */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Prioritized Alerts</span>
          <span className="card-meta">{stats?.total_alerts || 0} pending</span>
        </div>
        <div className="alert-grid">
          {topAlerts.map((alert) => (
            <div key={alert.alert_id} className={`alert-card ${alert.risk_tier?.toLowerCase()}`}>
              <div className="alert-card-header">
                <div>
                  <div className="alert-entity-id">
                    {alert.entity_id?.length > 20
                      ? `${alert.entity_id.slice(0, 10)}...${alert.entity_id.slice(-8)}`
                      : alert.entity_id}
                  </div>
                  <div className="alert-entity-type">ENTITY: {alert.entity_type?.toUpperCase()}</div>
                </div>
                <div className={`alert-confidence ${alert.risk_tier?.toLowerCase()}`}>
                  {alert.confidence?.toFixed(1)}%
                </div>
              </div>
              <div className="alert-description">{alert.description}</div>
              {alert.shap_values && Array.isArray(alert.shap_values) && (
                <div className="shap-bars">
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    SHAP FEATURE CONTRIBUTION
                  </div>
                  {alert.shap_values.slice(0, 3).map((sv, i) => {
                    const maxContrib = Math.max(...alert.shap_values.map(s => Math.abs(s.contribution || 0)), 0.01);
                    const pct = Math.min(100, Math.abs(sv.contribution || 0) / maxContrib * 100);
                    return (
                      <div key={i} className="shap-bar-row">
                        <span className="shap-bar-label">{sv.feature}</span>
                        <div className="shap-bar-track">
                          <div
                            className={`shap-bar-fill ${(sv.contribution || 0) >= 0 ? 'positive' : 'negative'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="shap-bar-value">
                          {(sv.contribution || 0) >= 0 ? '+' : ''}{sv.contribution?.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
