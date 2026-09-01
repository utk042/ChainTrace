import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { getDashboardStats, getTimeline, getRiskDistribution, getTopAlerts } from '../services/api';

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

  const riskColors = { Critical: '#FF4D5A', High: '#FF6B7A', Elevated: '#FFB84D', Low: '#4D9FFF', Normal: '#2A2F3A' };

  const timelineOption = {
    backgroundColor: 'transparent',
    grid: { top: 30, right: 20, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      data: timeline.map(t => t.timestamp?.split('T')[0] || ''),
      axisLine: { lineStyle: { color: '#1F2433' } },
      axisLabel: { color: '#5A6070', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#1F2433' } },
      axisLabel: { color: '#5A6070', fontSize: 10 },
    },
    series: [
      {
        name: 'Transactions',
        type: 'bar',
        data: timeline.map(t => t.count),
        itemStyle: { color: '#2A3F5F', borderRadius: [3, 3, 0, 0] },
        barWidth: '60%',
      },
      {
        name: 'Anomalies',
        type: 'bar',
        data: timeline.map(t => t.anomaly_count),
        itemStyle: { color: '#FF4D5A', borderRadius: [3, 3, 0, 0] },
        barWidth: '60%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#141820',
      borderColor: '#2A2F3A',
      textStyle: { color: '#E8ECF1', fontSize: 11 },
    },
  };

  const riskOption = {
    backgroundColor: 'transparent',
    series: [{
      type: 'pie',
      radius: ['55%', '80%'],
      center: ['50%', '50%'],
      data: riskDist.map(r => ({
        name: r.tier,
        value: r.count,
        itemStyle: { color: riskColors[r.tier] || '#2A2F3A' },
      })),
      label: { show: false },
      emphasis: {
        label: { show: true, color: '#E8ECF1', fontSize: 12 },
      },
    }],
    tooltip: {
      backgroundColor: '#141820',
      borderColor: '#2A2F3A',
      textStyle: { color: '#E8ECF1', fontSize: 11 },
    },
  };

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      {/* Stat Cards */}
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
            {stats?.critical_alerts || 0} Critical · {stats?.high_alerts || 0} High · {stats?.elevated_alerts || 0} Elevated
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
            <span className="card-title">Activity Timeline</span>
          </div>
          <ReactECharts option={timelineOption} style={{ height: 260 }} />
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Risk Distribution</span>
          </div>
          <ReactECharts option={riskOption} style={{ height: 260 }} />
        </div>
      </div>

      {/* Top Alerts */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Prioritized Alerts</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {stats?.total_alerts || 0} Pending
          </span>
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
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 4 }}>
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
