import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTransactions, getTransactionDetail } from '../services/api';
import { saveBlob } from '../services/download';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useCommands } from '../services/commands';
import { useIsNarrow } from '../hooks/useMediaQuery';
import {
  shortId, fmtInt, fmtNum, fmtBtc, fmtTimestamp, toCsv,
} from '../services/format';
import Icon from '../components/Icon';
import BrowserView from '../components/Layout/BrowserView';
import Menu, { MenuItem, MenuSeparator, MenuHeading } from '../components/ui/Menu';
import Tabs from '../components/ui/Tabs';
import Collapse from '../components/ui/Collapse';
import CopyButton from '../components/ui/CopyButton';
import { HistogramFacet } from '../components/ui/Histogram';
import { Loading, Empty, Failed, Notice } from '../components/ui/States';

const PAGE_SIZE = 25;

const COLUMNS = [
  { key: 'txid', label: 'Transaction', sort: 'txid' },
  { key: 'timestamp', label: 'Timestamp', sort: 'timestamp', width: 152 },
  { key: 'inputs', label: 'In', width: 48, align: 'right' },
  { key: 'outputs', label: 'Out', width: 48, align: 'right' },
  { key: 'total_input', label: 'Total in', width: 96, align: 'right' },
  { key: 'total_output', label: 'Total out', width: 96, align: 'right' },
  { key: 'fee', label: 'Fee', sort: 'fee', width: 96, align: 'right' },
  { key: 'script_type', label: 'Script', width: 92 },
];

const CSV_COLUMNS = [
  ['txid', 'TXID'], ['timestamp', 'Timestamp'], ['total_input', 'Total input'],
  ['total_output', 'Total output'], ['fee', 'Fee'], ['script_type', 'Script type'],
  ['src_ip', 'Source IP'], ['dst_ip', 'Destination IP'],
  ['geo_country_src', 'Source country'], ['geo_country_dst', 'Destination country'],
];

/**
 * The transaction ledger, in the Gotham Browser layout.
 *
 * The txid under review lives in the URL so a specific transaction can be
 * linked to; the amount columns are right-aligned and monospaced so figures
 * line up by decimal place rather than by character count.
 */
export default function Transactions() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState({ by: 'timestamp', order: 'desc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const narrow = useIsNarrow();
  const [showFilters, setShowFilters] = useState(!narrow);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [tab, setTab] = useState('overview');

  const searchRef = useRef(null);
  const search = useDebouncedValue(searchInput, 280);
  const selectedTxid = searchParams.get('txid') || null;

  const query = useMemo(() => {
    const params = { page, page_size: PAGE_SIZE, sort_by: sort.by, sort_order: sort.order };
    if (search.trim()) params.search = search.trim();
    return params;
  }, [page, sort, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTransactions(query);
      setRows(res.data.transactions || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e.response
        ? `The backend returned ${e.response.status} for /api/transactions.`
        : 'Could not reach the backend, and no stored copy of this query is available offline.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, sort]);

  useEffect(() => {
    if (!selectedTxid) { setDetail(null); setDetailError(null); return undefined; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setTab('overview');
    getTransactionDetail(selectedTxid)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((e) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(e.response
          ? `The backend returned ${e.response.status} for this transaction.`
          : 'The backend could not be reached for this transaction.');
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTxid]);

  const select = useCallback((txid) => {
    const next = new URLSearchParams(searchParams);
    if (txid) next.set('txid', txid);
    else next.delete('txid');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleSort = (column) => {
    if (!column.sort) return;
    setSort((s) => (s.by === column.sort
      ? { by: column.sort, order: s.order === 'desc' ? 'asc' : 'desc' }
      : { by: column.sort, order: column.sort === 'txid' ? 'asc' : 'desc' }));
  };

  const exportCsv = useCallback(async () => {
    setNote(null);
    try {
      const res = await getTransactions({ ...query, page: 1, page_size: 10000 });
      const list = res.data?.transactions || [];
      if (!list.length) { setNote({ kind: 'warn', text: 'There is nothing to export.' }); return; }
      saveBlob(new Blob([toCsv(CSV_COLUMNS, list)], { type: 'text/csv;charset=utf-8' }),
        'chaintrace_transactions.csv');
      setNote({ kind: 'ok', text: `Exported ${list.length.toLocaleString()} transactions.` });
    } catch {
      setNote({ kind: 'error', text: 'Export failed: the transaction query could not be re-run.' });
    }
  }, [query]);

  const exportJson = useCallback(() => {
    if (!rows.length) { setNote({ kind: 'warn', text: 'There is nothing to export.' }); return; }
    saveBlob(
      new Blob([JSON.stringify({ query, total, transactions: rows }, null, 2)], { type: 'application/json' }),
      'chaintrace_transactions.json',
    );
  }, [rows, query, total]);

  // Below the breakpoint this pane overlays the results, so shrinking the
  // window closes it rather than leaving the table hidden behind it.
  useEffect(() => { if (narrow) setShowFilters(false); }, [narrow]);

  useCommands({
    reload: load,
    'export.csv': exportCsv,
    'export.json': exportJson,
    'find.focus': () => searchRef.current?.focus(),
    'panel.filters': () => setShowFilters((v) => !v),
    'panel.detail': () => select(null),
    'filters.clear': () => setSearchInput(''),
    ...(detail ? {
      'selection.clear': () => select(null),
      'selection.copy': () => navigator.clipboard?.writeText(detail.txid),
      'open.graph': () => navigate(`/graph?q=${encodeURIComponent(detail.txid)}`),
    } : {}),
  });

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape' && selectedTxid) select(null);
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTxid, select]);

  // Facets over the loaded page, plus the totals it actually sums to.
  const summary = useMemo(() => {
    const scripts = new Map();
    const countries = new Map();
    let volume = 0;
    let fees = 0;
    rows.forEach((tx) => {
      const script = tx.script_type || 'unknown';
      scripts.set(script, (scripts.get(script) || 0) + 1);
      const country = tx.geo_country_src || 'unknown';
      countries.set(country, (countries.get(country) || 0) + 1);
      volume += tx.total_output || 0;
      fees += tx.fee || 0;
    });
    const toRows = (map) => [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ key: label, label, count }));
    return { scripts: toRows(scripts), countries: toRows(countries), volume, fees };
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="page-toolbar-title">
          <Icon name="swap" size={14} />
          Transactions
          <span className="count">{loading ? '…' : fmtInt(total)}</span>
        </span>

        <button
          type="button"
          className={`tool-btn${showFilters ? ' active' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          <Icon name="barChart" size={13} />
          <span>Summary</span>
        </button>

        <div className="search-bar" style={{ width: 'clamp(180px, 30vw, 380px)' }}>
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="TXID or IP address"
            aria-label="Search transactions"
          />
          <kbd>/</kbd>
        </div>

        <span className="page-toolbar-spacer" />

        <button type="button" className="tool-btn" onClick={load}>
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
              <MenuHeading>{fmtInt(total)} matching transactions</MenuHeading>
              <MenuItem close={close} icon="download" label="Export matches as CSV" onSelect={exportCsv} />
              <MenuItem close={close} icon="boxDown" label="Export page as JSON" onSelect={exportJson} />
              <MenuSeparator />
              <MenuItem
                close={close}
                icon="graph"
                label="Open selection in graph"
                disabled={!detail}
                onSelect={() => navigate(`/graph?q=${encodeURIComponent(detail.txid)}`)}
              />
            </>
          )}
        </Menu>
      </div>

      {note && (
        <div style={{ padding: 'var(--space-sm) var(--space-md) 0' }}>
          <Notice
            kind={note.kind}
            actions={<button className="icon-btn" onClick={() => setNote(null)} aria-label="Dismiss"><Icon name="close" size={12} /></button>}
          >{note.text}</Notice>
        </div>
      )}

      <BrowserView
        id="transactions"
        filtersTitle="Summary"
        showFilters={showFilters}
        onCloseFilters={() => setShowFilters(false)}
        filters={(
          <>
            <div className="filter-block">
              <div className="filter-block-title">Order by</div>
              <select
                className="select"
                value={`${sort.by}:${sort.order}`}
                onChange={(e) => {
                  const [by, order] = e.target.value.split(':');
                  setSort({ by, order });
                }}
                aria-label="Sort order"
              >
                <option value="timestamp:desc">Newest first</option>
                <option value="timestamp:asc">Oldest first</option>
                <option value="fee:desc">Highest fee first</option>
                <option value="fee:asc">Lowest fee first</option>
                <option value="txid:asc">TXID, ascending</option>
              </select>
            </div>

            <div className="section-label">
              This page
              <span className="section-label-count">{rows.length}</span>
            </div>

            <div className="filter-block">
              <div className="prop-list">
                <div className="prop-row">
                  <span className="prop-label">Output volume</span>
                  <span className="prop-value mono">{fmtBtc(summary.volume)}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">Fees</span>
                  <span className="prop-value mono">{fmtBtc(summary.fees, 6)}</span>
                </div>
              </div>
            </div>

            <div title="Counted from the transactions currently loaded, not from the whole ledger">
              <HistogramFacet title="Script type" rows={summary.scripts} />
              <HistogramFacet
                title="Source country"
                rows={summary.countries}
                emptyNote="No geolocation on this page."
              />
            </div>
          </>
        )}
        results={(
          <>
            <div className="browser-pane-head">
              <Icon name="table" size={12} />
              <span className="truncate">Ledger</span>
              <span className="head-actions muted" style={{ fontWeight: 400 }}>
                {loading ? 'loading…' : `${fmtInt(total)} records`}
              </span>
            </div>

            {error ? (
              <Failed title="Could not load transactions" actions={<button className="btn" onClick={load}><Icon name="refresh" size={12} /> Retry</button>}>
                {error}
              </Failed>
            ) : loading ? (
              <Loading label="Querying the ledger…" />
            ) : rows.length === 0 ? (
              <Empty icon="swap" title="No transactions match">
                {search
                  ? 'The search runs against txid and both IP columns on the backend.'
                  : 'Nothing has been ingested yet.'}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          style={col.width ? { width: col.width } : undefined}
                          className={col.sort ? 'sortable' : undefined}
                          onClick={() => toggleSort(col)}
                          aria-sort={sort.by === col.sort ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <span className={`th-inner${col.align === 'right' ? ' right' : ''}`}>
                            {col.label}
                            {col.sort && sort.by === col.sort && (
                              <Icon className="th-sort" name={sort.order === 'asc' ? 'sortAsc' : 'sortDesc'} size={10} />
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((tx) => (
                      <tr
                        key={tx.txid}
                        className={`clickable${selectedTxid === tx.txid ? ' selected' : ''}`}
                        onClick={() => select(tx.txid)}
                      >
                        <td className="mono" title={tx.txid}>{shortId(tx.txid, 14, 8)}</td>
                        <td className="mono">{fmtTimestamp(tx.timestamp)}</td>
                        <td className="num">{tx.input_addresses?.length || 0}</td>
                        <td className="num">{tx.output_addresses?.length || 0}</td>
                        <td className="num">{fmtNum(tx.total_input, 4)}</td>
                        <td className="num">{fmtNum(tx.total_output, 4)}</td>
                        <td className="num">{fmtNum(tx.fee, 6)}</td>
                        <td><span className="badge info">{tx.script_type}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pagination">
              <button className="btn btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                <Icon name="chevronLeft" size={11} /> Prev
              </button>
              <span className="page-info">Page {page} of {pageCount}</span>
              <button className="btn btn-sm" disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
                Next <Icon name="chevronRight" size={11} />
              </button>
              <span className="pagination-spacer" />
              <span className="page-info">
                {rows.length ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length}` : '0'} of {fmtInt(total)}
              </span>
            </div>
          </>
        )}
        detail={selectedTxid && (
          <TransactionDetail
            txid={selectedTxid}
            tx={detail}
            loading={detailLoading}
            error={detailError}
            tab={tab}
            onTab={setTab}
            onClose={() => select(null)}
            onOpenAddress={(address) => navigate(`/wallets?address=${encodeURIComponent(address)}`)}
            onOpenGraph={() => navigate(`/graph?q=${encodeURIComponent(selectedTxid)}`)}
          />
        )}
      />
    </div>
  );
}

function TransactionDetail({
  txid, tx, loading, error, tab, onTab, onClose, onOpenAddress, onOpenGraph,
}) {
  const inputs = tx?.input_addresses || [];
  const outputs = tx?.output_addresses || [];
  const flags = tx?.behavioral_flags || [];

  return (
    <div className="inspector">
      <div className="detail-head">
        <div className="detail-head-main">
          <span className="detail-head-title">{shortId(txid, 16, 12)}</span>
          <span className="detail-head-sub">Transaction</span>
          {tx && (
            <div className="detail-badges">
              <span className="badge info">{tx.script_type}</span>
              {flags.length > 0 && <span className="badge critical">{flags.length} flag(s)</span>}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close detail" title="Close (Esc)">
          <Icon name="close" size={14} />
        </button>
      </div>

      <Tabs
        active={tab}
        onChange={onTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'inputs', label: 'Inputs', count: inputs.length || undefined },
          { key: 'outputs', label: 'Outputs', count: outputs.length || undefined },
          { key: 'network', label: 'Network' },
        ]}
      />

      <div className="inspector-scroll">
        {error && <div style={{ padding: 'var(--space-md)' }}><Notice kind="error">{error}</Notice></div>}
        {loading && <Loading label="Loading transaction…" />}

        {!loading && tx && (
          <>
            <div className="id-block">
              <code>{tx.txid}</code>
              <CopyButton value={tx.txid} title="Copy txid" />
            </div>

            {tab === 'overview' && (
              <>
                <div className="stat-strip" style={{ margin: '0 var(--space-md) var(--space-md)' }}>
                  <div className="stat-tile">
                    <span className="stat-label">Total in</span>
                    <span className="stat-value" style={{ fontSize: 'var(--text-md)' }}>{fmtNum(tx.total_input, 8)}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-label">Total out</span>
                    <span className="stat-value" style={{ fontSize: 'var(--text-md)' }}>{fmtNum(tx.total_output, 8)}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-label">Fee</span>
                    <span className="stat-value" style={{ fontSize: 'var(--text-md)' }}>{fmtNum(tx.fee, 8)}</span>
                  </div>
                </div>

                {flags.length > 0 && (
                  <Collapse title="Behavioural flags" count={flags.length}>
                    <div className="col" style={{ padding: '0 var(--space-md)' }}>
                      {flags.map((flag) => (
                        <Notice key={flag} kind="error" icon="flag">{flag}</Notice>
                      ))}
                    </div>
                  </Collapse>
                )}

                <div className="prop-list">
                  {[
                    ['Timestamp', fmtTimestamp(tx.timestamp)],
                    ['Script type', tx.script_type],
                    ['Inputs', inputs.length],
                    ['Outputs', outputs.length],
                  ].map(([label, value]) => (
                    <div className="prop-row" key={label}>
                      <span className="prop-label">{label}</span>
                      <span className="prop-value mono">{value ?? '—'}</span>
                    </div>
                  ))}
                </div>

                <div className="inspector-actions">
                  <button className="btn" onClick={onOpenGraph}>
                    <Icon name="graph" size={12} /> Open in graph
                  </button>
                </div>
              </>
            )}

            {(tab === 'inputs' || tab === 'outputs') && (() => {
              const addresses = tab === 'inputs' ? inputs : outputs;
              const amounts = (tab === 'inputs' ? tx.input_amounts : tx.output_amounts) || [];
              if (addresses.length === 0) {
                return <Empty icon="wallet" title={`No ${tab} recorded`} />;
              }
              return addresses.map((address, i) => (
                <button
                  key={`${address}-${i}`}
                  type="button"
                  className="link-row"
                  onClick={() => onOpenAddress(address)}
                  title={`Open ${address}`}
                >
                  <i className="legend-dot wallet" />
                  <code>{shortId(address, 14, 8)}</code>
                  <span className="link-row-meta">{fmtNum(amounts[i], 6)}</span>
                </button>
              ));
            })()}

            {tab === 'network' && (
              <div className="prop-list">
                {[
                  ['Source IP', tx.src_ip],
                  ['Source port', tx.src_port],
                  ['Source country', tx.geo_country_src],
                  ['Source ASN', tx.asn_src],
                  ['Destination IP', tx.dst_ip],
                  ['Destination port', tx.dst_port],
                  ['Destination country', tx.geo_country_dst],
                  ['Destination ASN', tx.asn_dst],
                ].map(([label, value]) => (
                  <div className="prop-row" key={label}>
                    <span className="prop-label">{label}</span>
                    <span className="prop-value mono">{value ?? '—'}</span>
                  </div>
                ))}
                {!tx.src_ip && !tx.dst_ip && (
                  <p className="inspector-note">
                    This record carries no network layer. Transactions fetched from a
                    public blockchain API have none — no public source for it exists.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {!loading && !tx && !error && (
          <Empty icon="swap" title="No record for this transaction">
            The backend holds nothing for {shortId(txid, 12, 8)}.
          </Empty>
        )}
      </div>
    </div>
  );
}
