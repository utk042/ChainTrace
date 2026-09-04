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
        itemStyle: { color: '#3D3D3D' },
        barWidth: '58%',
      },
      {
        name: 'Anomalies',
        type: 'bar',
        data: timeline.map(t => t.anomaly_count),
        itemStyle: { color: '#FFFFFF' },
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
          <span className="stat-label">Transactions</span>
          <span className="stat-value">{stats?.total_transactions?.toLocaleString() || '0'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Wallets</span>
          <span className="stat-value">{stats?.total_wallets?.toLocaleString() || '0'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">IP addresses</span>
          <span className="stat-value">{stats?.total_ips?.toLocaleString() || '0'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Alerts</span>
          <span className="stat-value">{stats?.total_alerts?.toLocaleString() || '0'}</span>
          <span className="stat-sub">
            {stats?.critical_alerts || 0} critical · {stats?.high_alerts || 0} high · {stats?.elevated_alerts || 0} elevated
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Clusters</span>
          <span className="stat-value">{stats?.clusters_detected?.toLocaleString() || '0'}</span>
        </div>
      </div>

      {/* Wallets by risk tier — one bar, read left to right */}
      <div className="risk-strip">
        <div className="risk-bar">
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
              {r.tier} <span style={{ color: 'var(--text-primary)' }}>{r.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="card-header">
          <span className="card-title">Transaction volume</span>
          <span className="card-meta">anomalies in white</span>
        </div>
        <ReactECharts option={timelineOption} style={{ height: 260 }} notMerge />
      </div>

      {/* Top Alerts */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Highest confidence alerts</span>
          <span className="card-meta">{stats?.total_alerts || 0} total</span>
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
                  <div className="alert-entity-type">{alert.entity_type}</div>
                </div>
                <div className={`alert-confidence ${alert.risk_tier?.toLowerCase()}`}>
                  {alert.confidence?.toFixed(1)}%
                </div>
              </div>
              <div className="alert-description">{alert.description}</div>
              {alert.shap_values && Array.isArray(alert.shap_values) && (
                <div className="shap-bars">
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    Feature contributions
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
