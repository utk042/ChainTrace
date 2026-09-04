import { useState, useEffect, useCallback } from 'react';
import { getTransactions, getTransactionDetail } from '../services/api';
import Icon from '../components/Icon';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20, sort_by: 'timestamp', sort_order: 'desc' };
      if (search) params.search = search;
      const res = await getTransactions(params);
      setTransactions(res.data.transactions || []);
      setTotal(res.data.total || 0);
    } catch (e) {}
    setLoading(false);
  }, [page, search]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const handleSelect = async (txid) => {
    setSelected(txid);
    try {
      const res = await getTransactionDetail(txid);
      setDetail(res.data);
    } catch (e) { setDetail(null); }
  };

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <h1 className="page-title">Transactions <span className="count">{total.toLocaleString()}</span></h1>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="search-bar" style={{ width: 400 }}>
          <Icon name="search" size={14} style={{ opacity: 0.5 }} />
          <input
            type="text" placeholder="Search transaction id, address or block"
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchTransactions()}
          />
        </div>
      </div>

      <div className={`split-view-container ${detail ? 'has-detail' : ''}`} style={{ display: 'grid', gridTemplateColumns: detail ? 'minmax(0, 1fr) 400px' : 'minmax(0, 1fr)', gap: 'var(--space-xl)' }}>
        <div>
          {loading ? <div className="loading-spinner"><div className="spinner" /></div> : (
            <>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>TXID</th>
                      <th>Timestamp</th>
                      <th>Inputs</th>
                      <th>Outputs</th>
                      <th>Total In</th>
                      <th>Total Out</th>
                      <th>Fee</th>
                      <th>Script</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.txid} onClick={() => handleSelect(tx.txid)}
                        style={{ cursor: 'pointer', background: selected === tx.txid ? 'var(--bg-hover)' : undefined }}>
                        <td className="mono">
                          {tx.txid?.slice(0, 12)}...{tx.txid?.slice(-6)}
                        </td>
                        <td style={{ fontSize: 'var(--text-xs)' }}>
                          {tx.timestamp?.replace('T', ' ').slice(0, 19)}
                        </td>
                        <td>{tx.input_addresses?.length || 0}</td>
                        <td>{tx.output_addresses?.length || 0}</td>
                        <td>{tx.total_input?.toFixed(4)}</td>
                        <td>{tx.total_output?.toFixed(4)}</td>
                        <td>{tx.fee?.toFixed(6)}</td>
                        <td><span className="badge info">{tx.script_type}</span></td>
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
              <h3 style={{ fontSize: 'var(--text-lg)' }}>Transaction</h3>
              <span style={{ cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }} onClick={() => { setDetail(null); setSelected(null); }}>
                <Icon name="close" size={16} />
              </span>
            </div>

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', wordBreak: 'break-all',
              background: 'var(--bg-tertiary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)' }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>TXID</div>
              {detail.txid}
            </div>

            {/* Asset Flow */}
            <div style={{ background: 'var(--bg-tertiary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-lg)', display: 'flex', justifyContent: 'space-around' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>In</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
                  {detail.total_input?.toFixed(8)} BTC
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Out</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
                  {detail.total_output?.toFixed(8)} BTC
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Fee</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
                  {detail.fee?.toFixed(8)} BTC
                </div>
              </div>
            </div>

            {/* Metadata Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-lg)' }}>
              {[
                ['Timestamp', detail.timestamp?.replace('T', ' ').slice(0, 19)],
                ['Script Type', detail.script_type],
                ['Source IP', detail.src_ip],
                ['Dest IP', detail.dst_ip],
                ['Src Country', detail.geo_country_src],
                ['Dst Country', detail.geo_country_dst],
              ].map(([label, val]) => (
                <div key={label} style={{ padding: '6px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>{label}</div>
                  <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{val || '—'}</div>
                </div>
              ))}
            </div>

            {/* Behavioral Flags */}
            {detail.behavioral_flags?.length > 0 && (
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="card-title" style={{ marginBottom: 'var(--space-sm)' }}>Flags</div>
                {detail.behavioral_flags.map((flag, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)', color: 'var(--accent-critical)', padding: '4px 0' }}>
                    <Icon name="flag" size={13} /> {flag}
                  </div>
                ))}
              </div>
            )}

            {/* Input Addresses */}
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <div className="card-title" style={{ marginBottom: 'var(--space-sm)' }}>Inputs ({detail.input_addresses?.length})</div>
              {detail.input_addresses?.map((addr, i) => (
                <div key={i} style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', padding: '4px 0',
                  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{addr.length > 24 ? `${addr.slice(0, 12)}...${addr.slice(-8)}` : addr}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{detail.input_amounts?.[i]?.toFixed(4)} BTC</span>
                </div>
              ))}
            </div>

            {/* Output Addresses */}
            <div>
              <div className="card-title" style={{ marginBottom: 'var(--space-sm)' }}>Outputs ({detail.output_addresses?.length})</div>
              {detail.output_addresses?.map((addr, i) => (
                <div key={i} style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', padding: '4px 0',
                  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{addr.length > 24 ? `${addr.slice(0, 12)}...${addr.slice(-8)}` : addr}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{detail.output_amounts?.[i]?.toFixed(4)} BTC</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
