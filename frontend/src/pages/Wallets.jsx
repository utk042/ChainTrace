import { useState, useEffect, useCallback } from 'react';
import { getWallets, getWalletDetail } from '../services/api';
import Icon from '../components/Icon';

export default function Wallets() {
  const [wallets, setWallets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20, sort_by: 'anomaly_score', sort_order: 'desc' };
      if (search) params.search = search;
      if (riskFilter) params.risk_tier = riskFilter;
      const res = await getWallets(params);
      setWallets(res.data.wallets || []);
      setTotal(res.data.total || 0);
    } catch (e) {}
    setLoading(false);
  }, [page, search, riskFilter]);

  useEffect(() => { fetchWallets(); }, [fetchWallets]);

  const handleSelect = async (address) => {
    setSelected(address);
    try {
      const res = await getWalletDetail(address);
      setDetail(res.data);
    } catch (e) { setDetail(null); }
  };

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Wallets ({total.toLocaleString()})</h1>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="search-bar" style={{ width: 300 }}>
          <Icon name="search" size={14} style={{ opacity: 0.5 }} />
          <input
            type="text" placeholder="Search wallet address..."
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchWallets()}
          />
        </div>
        {['', 'Critical', 'High', 'Elevated'].map(t => (
          <span key={t || 'all'}
            className={`filter-chip ${riskFilter === t ? 'selected' : ''}`}
            onClick={() => { setRiskFilter(t); setPage(1); }}
          >{t || 'All'}</span>
        ))}
      </div>

      <div className={`split-view-container ${detail ? 'has-detail' : ''}`} style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 400px' : '1fr', gap: 'var(--space-xl)' }}>
        <div>
          {loading ? <div className="loading-spinner"><div className="spinner" /></div> : (
            <>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>TX Count</th>
                      <th>Received</th>
                      <th>Sent</th>
                      <th>Fan In</th>
                      <th>Fan Out</th>
                      <th>Velocity/h</th>
                      <th>Score</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets.map(w => (
                      <tr key={w.address} onClick={() => handleSelect(w.address)}
                        style={{ cursor: 'pointer', background: selected === w.address ? 'var(--bg-hover)' : undefined }}
                      >
                        <td className="mono">
                          {w.address.length > 20 ? `${w.address.slice(0, 10)}...${w.address.slice(-8)}` : w.address}
                        </td>
                        <td>{w.tx_count}</td>
                        <td>{w.total_received?.toFixed(4)}</td>
                        <td>{w.total_sent?.toFixed(4)}</td>
                        <td>{w.fan_in_degree}</td>
                        <td>{w.fan_out_degree}</td>
                        <td>{w.velocity_1h}</td>
                        <td style={{ color: w.anomaly_score >= 90 ? 'var(--accent-critical)' : w.anomaly_score >= 70 ? 'var(--accent-high)' : w.anomaly_score > 0 ? 'var(--accent-elevated)' : 'inherit' }}>
                          {w.anomaly_score?.toFixed(1)}
                        </td>
                        <td>
                          {w.risk_tier !== 'Normal' && <span className={`badge ${w.risk_tier?.toLowerCase()}`}>{w.risk_tier}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><Icon name="chevronLeft" size={13} /> Prev</button>
                <span className="page-info">Page {page} of {Math.max(1, Math.ceil(total / 20))}</span>
                <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Next <Icon name="chevronRight" size={13} /></button>
              </div>
            </>
          )}
        </div>

        {detail && (
          <div className="card slide-in" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
              <h3 style={{ fontSize: 'var(--text-md)' }}>Wallet Detail</h3>
              <span style={{ cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }} onClick={() => { setDetail(null); setSelected(null); }}>
                <Icon name="close" size={16} />
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
              background: 'var(--bg-tertiary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)' }}>
              <span style={{ wordBreak: 'break-all' }}>{detail.address}</span>
              <span
                style={{ cursor: 'pointer', color: 'var(--text-tertiary)', flexShrink: 0, display: 'flex' }}
                title="Copy address"
                onClick={() => navigator.clipboard?.writeText(detail.address)}
              >
                <Icon name="copy" size={13} />
              </span>
            </div>

            {detail.risk_tier !== 'Normal' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)', padding: 'var(--space-lg) 0',
                borderTop: '1px solid var(--border-primary)', borderBottom: '1px solid var(--border-primary)', marginBottom: 'var(--space-lg)' }}>
                {(() => {
                  const gaugeColor = detail.anomaly_score >= 90 ? 'var(--accent-critical)'
                    : detail.anomaly_score >= 70 ? 'var(--accent-high)' : 'var(--accent-elevated)';
                  const pct = Math.max(0, Math.min(100, detail.anomaly_score || 0));
                  return (
                    <div style={{
                      width: 66, height: 66, borderRadius: '50%', flexShrink: 0,
                      background: `conic-gradient(${gaugeColor} 0% ${pct}%, var(--border-primary) ${pct}% 100%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: '50%', background: 'var(--bg-card)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
                      }}>{pct.toFixed(0)}</div>
                    </div>
                  );
                })()}
                <div>
                  <span className={`badge ${detail.risk_tier?.toLowerCase()}`}>{detail.risk_tier}</span>
                  {detail.cluster_id != null && (
                    <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      Cluster <span style={{ color: 'var(--text-primary)' }}>{detail.cluster_id}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-lg)' }}>
              {[
                ['Received', `${detail.total_received?.toFixed(4)} BTC`],
                ['Sent', `${detail.total_sent?.toFixed(4)} BTC`],
                ['Balance', `${detail.balance?.toFixed(4)} BTC`],
                ['TX Count', detail.tx_count],
                ['Fan In', detail.fan_in_degree],
                ['Fan Out', detail.fan_out_degree],
                ['Velocity/hr', detail.velocity_1h],
                ['Countries', detail.unique_countries],
                ['Age', `${detail.age_days?.toFixed(0)} days`],
                ['Cluster', detail.cluster_id ?? '—'],
              ].map(([label, val]) => (
                <div key={label} style={{ padding: '6px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>{label}</div>
                  <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{val}</div>
                </div>
              ))}
            </div>

            {detail.connected_ips?.length > 0 && (
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="card-title" style={{ marginBottom: 'var(--space-sm)' }}>Connected IPs</div>
                {detail.connected_ips.slice(0, 5).map((ip, i) => (
                  <div key={i} style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    padding: '4px 0', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                    {ip.ip} · {ip.country} / {ip.asn}
                  </div>
                ))}
              </div>
            )}

            {detail.recent_transactions?.length > 0 && (
              <div>
                <div className="card-title" style={{ marginBottom: 'var(--space-sm)' }}>Recent Transactions</div>
                {detail.recent_transactions.slice(0, 5).map((tx, i) => (
                  <div key={i} style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    padding: '6px 0', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                    <div>{tx.txid?.slice(0, 24)}...</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <span>{tx.timestamp?.split('T')[0]}</span>
                      <span style={{ color: tx.total_output > tx.total_input ? 'var(--accent-green)' : 'var(--accent-critical)' }}>
                        {tx.total_output > tx.total_input ? '+' : '-'}{Math.abs(tx.total_output - tx.total_input).toFixed(4)} BTC
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
