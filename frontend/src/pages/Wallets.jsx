import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getWallets, getWalletDetail } from '../services/api';
import { saveBlob } from '../services/download';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useCommands } from '../services/commands';
import { useIsNarrow } from '../hooks/useMediaQuery';
import {
  shortId, fmtInt, fmtNum, fmtBtc, fmtDate, toCsv, riskVar, scoreVar,
} from '../services/format';
import Icon from '../components/Icon';
import BrowserView from '../components/Layout/BrowserView';
import Menu, { MenuItem, MenuSeparator, MenuHeading } from '../components/ui/Menu';
import Tabs from '../components/ui/Tabs';
import Collapse from '../components/ui/Collapse';
import CopyButton from '../components/ui/CopyButton';
import { HistogramFacet } from '../components/ui/Histogram';
import { Loading, Empty, Failed, Notice } from '../components/ui/States';
import { useSession } from '../state/SessionProvider';

const PAGE_SIZE = 25;
const TIERS = ['Critical', 'High', 'Elevated', 'Normal'];
const PATTERNS = [
  { key: 'peel_chain', label: 'Peel chain' },
  { key: 'mixer', label: 'Mixer' },
  { key: 'watchlist', label: 'Watchlist' },
];

const EMPTY_FILTERS = { search: '', risk_tier: '', pattern: '', min_score: 0 };

/** Column key -> backend sort column. Only these are sortable server-side. */
const COLUMNS = [
  { key: 'address', label: 'Address', sort: null },
  { key: 'tx_count', label: 'Txns', sort: 'tx_count', align: 'right', width: 64 },
  { key: 'total_received', label: 'Received', sort: 'total_received', align: 'right', width: 96 },
  { key: 'total_sent', label: 'Sent', sort: 'total_sent', align: 'right', width: 96 },
  { key: 'fan_in_degree', label: 'Fan in', sort: 'fan_in_degree', align: 'right', width: 66 },
  { key: 'fan_out_degree', label: 'Fan out', sort: 'fan_out_degree', align: 'right', width: 70 },
  { key: 'velocity_1h', label: 'Vel/h', sort: 'velocity_1h', align: 'right', width: 62 },
  { key: 'patterns', label: 'Patterns', sort: null, width: 86 },
  { key: 'anomaly_score', label: 'Score', sort: 'anomaly_score', align: 'right', width: 66 },
  { key: 'risk_tier', label: 'Risk', sort: null, width: 82 },
];

const CSV_COLUMNS = [
  ['address', 'Address'], ['tx_count', 'Transactions'], ['total_received', 'Received'],
  ['total_sent', 'Sent'], ['balance', 'Balance'], ['fan_in_degree', 'Fan in'],
  ['fan_out_degree', 'Fan out'], ['velocity_1h', 'Velocity per hour'],
  ['anomaly_score', 'Anomaly score'], ['risk_tier', 'Risk tier'],
  ['cluster_id', 'Cluster'], ['peel_chain_role', 'Peel chain role'],
  ['mixer_interaction_count', 'Mixer interactions'],
  ['darknet_proximity_hops', 'Hops from watchlist'],
];

/**
 * Wallet review in the Gotham Browser layout.
 *
 * The address a detail pane is showing lives in the URL, so a wallet under
 * review can be linked to and survives a reload — previously the selection
 * was component state and a refresh dropped it.
 */
export default function Wallets() {
  const navigate = useNavigate();
  const { openTab } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleOpenInGraph = useCallback((address) => {
    if (!address) return;
    const targetPath = `/graph?q=${encodeURIComponent(address)}`;
    openTab('graph', { forceNew: false, path: targetPath });
    navigate(targetPath);
  }, [openTab, navigate]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ by: 'anomaly_score', order: 'desc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  // Set when an offline read was answered by re-slicing stored rows that do
  // not cover the whole result set; the table must say so rather than let a
  // short answer read as a complete one.
  const [partial, setPartial] = useState(null);
  const narrow = useIsNarrow();
  const [showFilters, setShowFilters] = useState(!narrow);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [tab, setTab] = useState('overview');

  const searchRef = useRef(null);
  const search = useDebouncedValue(filters.search, 280);
  const selectedAddress = searchParams.get('address') || null;

  // A ?tier= arriving from the overview's histogram is applied once and then
  // stripped, leaving the chip row as the single source of truth.
  useEffect(() => {
    const tier = searchParams.get('tier');
    if (!tier) return;
    setFilters((f) => ({ ...f, risk_tier: tier }));
    const next = new URLSearchParams(searchParams);
    next.delete('tier');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const query = useMemo(() => {
    const params = { page, page_size: PAGE_SIZE, sort_by: sort.by, sort_order: sort.order };
    if (search.trim()) params.search = search.trim();
    if (filters.risk_tier) params.risk_tier = filters.risk_tier;
    if (filters.pattern) params.pattern = filters.pattern;
    if (filters.min_score > 0) params.min_score = filters.min_score;
    return params;
  }, [page, sort, search, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getWallets(query);
      setRows(res.data.wallets || []);
      setTotal(res.data.total || 0);
      setPartial(res.data.offline_partial ? {
        rows: res.data.offline_rows_available,
        backendTotal: res.data.offline_backend_total,
      } : null);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setPartial(null);
      setError(e.response
        ? `The backend returned ${e.response.status} for /api/wallets.`
        : 'Could not reach the backend, and no stored copy of this query is available offline.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  // A new search or filter invalidates the page number: page 3 of the old
  // result set is usually past the end of the new one.
  useEffect(() => { setPage(1); }, [search, filters.risk_tier, filters.min_score, sort]);

  // The selected address drives the detail read, so a deep link resolves the
  // same way a click does.
  useEffect(() => {
    if (!selectedAddress) { setDetail(null); setDetailError(null); return undefined; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setTab('overview');
    getWalletDetail(selectedAddress)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((e) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(e.response
          ? `The backend returned ${e.response.status} for ${selectedAddress}.`
          : 'The backend could not be reached for this wallet.');
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedAddress]);

  const select = useCallback((address) => {
    const next = new URLSearchParams(searchParams);
    if (address) next.set('address', address);
    else next.delete('address');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const update = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const toggleSort = (column) => {
    if (!column.sort) return;
    setSort((s) => (s.by === column.sort
      ? { by: column.sort, order: s.order === 'desc' ? 'asc' : 'desc' }
      : { by: column.sort, order: 'desc' }));
  };

  const exportCsv = useCallback(async () => {
    setNote(null);
    try {
      const res = await getWallets({ ...query, page: 1, page_size: 10000 });
      const list = res.data?.wallets || [];
      if (!list.length) { setNote({ kind: 'warn', text: 'There is nothing to export.' }); return; }
      saveBlob(new Blob([toCsv(CSV_COLUMNS, list)], { type: 'text/csv;charset=utf-8' }),
        'chaintrace_wallets.csv');
      setNote({ kind: 'ok', text: `Exported ${list.length.toLocaleString()} wallets matching the current filters.` });
    } catch {
      setNote({ kind: 'error', text: 'Export failed: the wallet query could not be re-run.' });
    }
  }, [query]);

  const exportJson = useCallback(() => {
    if (!rows.length) { setNote({ kind: 'warn', text: 'There is nothing to export.' }); return; }
    saveBlob(
      new Blob([JSON.stringify({ query, total, wallets: rows }, null, 2)], { type: 'application/json' }),
      'chaintrace_wallets.json',
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
    'filters.clear': () => setFilters(EMPTY_FILTERS),
    'panel.filters': () => setShowFilters((v) => !v),
    'panel.detail': () => select(null),
    ...(detail ? {
      'selection.clear': () => select(null),
      'selection.copy': () => navigator.clipboard?.writeText(detail.address),
      'open.graph': () => handleOpenInGraph(detail.address),
    } : {}),
  });

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape' && selectedAddress) select(null);
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAddress, select]);

  // Facets over the loaded page. Labelled as such rather than passed off as
  // a summary of the whole table.
  const facets = useMemo(() => {
    const tiers = new Map();
    const patternCounts = { peel_chain: 0, mixer: 0, watchlist: 0 };
    rows.forEach((w) => {
      const tier = w.risk_tier || 'Normal';
      tiers.set(tier, (tiers.get(tier) || 0) + 1);
      if (w.peel_chain_role === 'chain' || (w.peel_chain_depth && w.peel_chain_depth > 0)) patternCounts.peel_chain += 1;
      if (w.mixer_interaction_count > 0) patternCounts.mixer += 1;
      if (w.darknet_proximity_hops != null) patternCounts.watchlist += 1;
    });
    return {
      tier: TIERS.filter((t) => tiers.has(t))
        .map((t) => ({ key: t, label: t, count: tiers.get(t), color: riskVar(t) })),
      patterns: [
        { key: 'peel_chain', label: 'Peel chain', count: patternCounts.peel_chain },
        { key: 'mixer', label: 'Mixer contact', count: patternCounts.mixer },
        { key: 'watchlist', label: 'Near watchlist', count: patternCounts.watchlist },
      ].filter((p) => p.count > 0),
    };
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = (filters.search ? 1 : 0)
    + (filters.risk_tier ? 1 : 0)
    + (filters.pattern ? 1 : 0)
    + (filters.min_score > 0 ? 1 : 0);

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="page-toolbar-title">
          <Icon name="wallet" size={14} />
          Wallets
          <span className="count">{loading ? '…' : fmtInt(total)}</span>
        </span>

        <button
          type="button"
          className={`tool-btn${showFilters ? ' active' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          <Icon name="filter" size={13} />
          <span>Filters</span>
          {activeFilterCount > 0 && <i className="tool-dot" />}
        </button>

        <div className="search-bar" style={{ width: 'clamp(160px, 26vw, 320px)' }}>
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            type="search"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Wallet address"
            aria-label="Search wallets"
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
              <MenuHeading>{fmtInt(total)} matching wallets</MenuHeading>
              <MenuItem close={close} icon="download" label="Export matches as CSV" onSelect={exportCsv} />
              <MenuItem close={close} icon="boxDown" label="Export page as JSON" onSelect={exportJson} />
              <MenuSeparator />
              <MenuItem
                close={close}
                icon="graph"
                label="Open selection in graph"
                disabled={!detail}
                onSelect={() => handleOpenInGraph(detail.address)}
              />
              <MenuItem
                close={close}
                icon="rotateCcw"
                label="Clear all filters"
                disabled={activeFilterCount === 0}
                onSelect={() => setFilters(EMPTY_FILTERS)}
              />
            </>
          )}
        </Menu>
      </div>

      {partial && (
        <div style={{ padding: 'var(--space-sm) var(--space-md) 0' }}>
          <Notice kind="warn">
            Offline: this view was filtered, sorted and paged on this device
            from the {fmtInt(partial.rows)} wallets stored here. The backend last
            reported {fmtInt(partial.backendTotal)} in this table, so anything
            outside the stored rows is not on screen and the counts above
            describe the stored rows only.
          </Notice>
        </div>
      )}
      {note && (
        <div style={{ padding: 'var(--space-sm) var(--space-md) 0' }}>
          <Notice
            kind={note.kind}
            actions={<button className="icon-btn" onClick={() => setNote(null)} aria-label="Dismiss"><Icon name="close" size={12} /></button>}
          >{note.text}</Notice>
        </div>
      )}

      <BrowserView
        id="wallets"
        showFilters={showFilters}
        onCloseFilters={() => setShowFilters(false)}
        filters={(
          <>
            <div className="filter-block">
              <div className="filter-block-title">
                Risk tier
                {filters.risk_tier && <button className="reset" onClick={() => update({ risk_tier: '' })}>clear</button>}
              </div>
              <div className="chip-row">
                <button
                  className={`chip${filters.risk_tier === '' ? ' selected' : ''}`}
                  onClick={() => update({ risk_tier: '' })}
                >All</button>
                {TIERS.map((tier) => (
                  <button
                    key={tier}
                    className={`chip${filters.risk_tier === tier ? ' selected' : ''}`}
                    onClick={() => update({ risk_tier: filters.risk_tier === tier ? '' : tier })}
                  >
                    <i className="chip-dot" style={{ background: riskVar(tier) }} />
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block-title">
                Detected pattern
                {filters.pattern && <button className="reset" onClick={() => update({ pattern: '' })}>clear</button>}
              </div>
              <div className="chip-row">
                <button
                  className={`chip${filters.pattern === '' ? ' selected' : ''}`}
                  onClick={() => update({ pattern: '' })}
                >All</button>
                {PATTERNS.map((p) => (
                  <button
                    key={p.key}
                    className={`chip${filters.pattern === p.key ? ' selected' : ''}`}
                    onClick={() => update({ pattern: filters.pattern === p.key ? '' : p.key })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block-title">
                Minimum anomaly score
                {filters.min_score > 0 && <button className="reset" onClick={() => update({ min_score: 0 })}>clear</button>}
              </div>
              <div className="slider-control">
                <input
                  type="range" min="0" max="100" step="5"
                  value={filters.min_score}
                  onChange={(e) => update({ min_score: Number(e.target.value) })}
                  aria-label="Minimum anomaly score"
                />
                <span className="slider-value">{filters.min_score}</span>
              </div>
            </div>

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
                <option value="anomaly_score:desc">Anomaly score, highest first</option>
                <option value="tx_count:desc">Transaction count, highest first</option>
                <option value="total_received:desc">Received, largest first</option>
                <option value="total_sent:desc">Sent, largest first</option>
                <option value="fan_out_degree:desc">Fan out, highest first</option>
                <option value="velocity_1h:desc">Velocity, highest first</option>
                <option value="darknet_proximity_score:desc">Watchlist proximity</option>
                <option value="age_days:asc">Newest wallets first</option>
              </select>
            </div>

            <div className="section-label">
              This page
              <span className="section-label-count">{rows.length}</span>
            </div>
            <div title="Counted from the wallets currently loaded, not from the whole table">
              <HistogramFacet
                title="Risk tier"
                rows={facets.tier}
                selected={filters.risk_tier}
                onSelect={(key) => update({ risk_tier: filters.risk_tier === key ? '' : key })}
              />
              <HistogramFacet
                title="Detected patterns"
                rows={facets.patterns}
                selected={filters.pattern}
                onSelect={(key) => update({ pattern: filters.pattern === key ? '' : key })}
                emptyNote="No behavioural patterns on this page."
              />
            </div>
          </>
        )}
        results={(
          <>
            <div className="browser-pane-head">
              <Icon name="table" size={12} />
              <span className="truncate">Results</span>
              <span className="head-actions muted" style={{ fontWeight: 400 }}>
                {loading ? 'loading…' : `${fmtInt(total)} matching`}
              </span>
            </div>

            {error ? (
              <Failed title="Could not load wallets" actions={<button className="btn" onClick={load}><Icon name="refresh" size={12} /> Retry</button>}>
                {error}
              </Failed>
            ) : loading ? (
              <Loading label="Querying wallets…" />
            ) : rows.length === 0 ? (
              <Empty icon="wallet" title="No wallets match these filters">
                {activeFilterCount > 0
                  ? 'Filtering happens on the backend, so this is the complete answer for these parameters.'
                  : 'No wallet features have been computed. Run the pipeline over a dataset first.'}
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
                    {rows.map((w) => (
                      <tr
                        key={w.address}
                        className={`clickable${selectedAddress === w.address ? ' selected' : ''}`}
                        onClick={() => select(w.address)}
                      >
                        <td className="mono" title={w.address}>{shortId(w.address, 12, 8)}</td>
                        <td className="num">{fmtInt(w.tx_count)}</td>
                        <td className="num">{fmtNum(w.total_received, 4)}</td>
                        <td className="num">{fmtNum(w.total_sent, 4)}</td>
                        <td className="num">{fmtInt(w.fan_in_degree)}</td>
                        <td className="num">{fmtInt(w.fan_out_degree)}</td>
                        <td className="num">{fmtInt(w.velocity_1h)}</td>
                        <td>
                          <span className="row" style={{ gap: 5 }}>
                            {w.peel_chain_role === 'chain' && (
                              <Icon name="alertTriangle" size={12} title={`Peeling chain, depth ${w.peel_chain_depth}`} style={{ color: 'var(--risk-elevated)' }} />
                            )}
                            {w.mixer_interaction_count > 0 && (
                              <Icon name="graph" size={12} title={`Mixer/CoinJoin interaction (${w.mixer_interaction_count})`} style={{ color: 'var(--risk-high)' }} />
                            )}
                            {w.darknet_proximity_hops != null && (
                              <Icon name="flag" size={12} title={`${w.darknet_proximity_hops} hop(s) from a watchlisted wallet`} style={{ color: 'var(--risk-critical)' }} />
                            )}
                          </span>
                        </td>
                        <td className="num" style={{ color: scoreVar(w.anomaly_score || 0) }}>
                          {fmtNum(w.anomaly_score, 1)}
                        </td>
                        <td>
                          {w.risk_tier && w.risk_tier !== 'Normal' && (
                            <span className={`badge ${w.risk_tier.toLowerCase()}`}>{w.risk_tier}</span>
                          )}
                        </td>
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
        detail={(selectedAddress) && (
          <WalletDetail
            address={selectedAddress}
            wallet={detail}
            loading={detailLoading}
            error={detailError}
            tab={tab}
            onTab={setTab}
            onClose={() => select(null)}
            onSelect={select}
            onOpenGraph={() => handleOpenInGraph(selectedAddress)}
          />
        )}
      />
    </div>
  );
}

function WalletDetail({
  address, wallet, loading, error, tab, onTab, onClose, onSelect, onOpenGraph,
}) {
  const score = wallet?.anomaly_score || 0;
  const patterns = wallet ? [
    wallet.peel_chain_role && {
      icon: 'alertTriangle',
      tone: 'warn',
      text: wallet.peel_chain_role === 'chain'
        ? `Peeling chain — depth ${wallet.peel_chain_depth}`
        : 'Single peel-shaped transaction',
    },
    wallet.mixer_interaction_count > 0 && {
      icon: 'graph',
      tone: 'warn',
      text: `Mixer/CoinJoin interaction — ${wallet.mixer_interaction_count} signal(s)`,
    },
    wallet.darknet_proximity_hops != null && !wallet.is_seed_wallet && {
      icon: 'flag',
      tone: 'error',
      text: `${wallet.darknet_proximity_hops} hop(s) from a watchlisted seed wallet`
        + (wallet.darknet_proximity_score != null ? ` (proximity ${wallet.darknet_proximity_score.toFixed(2)})` : ''),
    },
  ].filter(Boolean) : [];

  const counts = {
    similar: wallet?.similar_wallets?.length || 0,
    ips: wallet?.connected_ips?.length || 0,
    txns: wallet?.recent_transactions?.length || 0,
  };

  return (
    <div className="inspector">
      <div className="detail-head">
        <div className="detail-head-main">
          <span className="detail-head-title">{shortId(address, 16, 12)}</span>
          <span className="detail-head-sub">Wallet</span>
          {wallet && (
            <div className="detail-badges">
              {wallet.risk_tier && wallet.risk_tier !== 'Normal' && (
                <span className={`badge ${wallet.risk_tier.toLowerCase()}`}>{wallet.risk_tier}</span>
              )}
              {wallet.is_seed_wallet && <span className="badge critical">Watchlist seed</span>}
              {wallet.cluster_id != null && <span className="badge info">Cluster {wallet.cluster_id}</span>}
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
          { key: 'features', label: 'Features' },
          { key: 'links', label: 'Links', count: counts.similar + counts.ips || undefined },
          { key: 'txns', label: 'Transactions', count: counts.txns || undefined },
        ]}
      />

      <div className="inspector-scroll">
        {error && (
          <div style={{ padding: 'var(--space-md)' }}>
            <Notice kind="error">{error}</Notice>
          </div>
        )}

        {loading && <Loading label="Loading wallet…" />}

        {!loading && wallet && (
          <>
            <div className="id-block">
              <code>{wallet.address}</code>
              <CopyButton value={wallet.address} title="Copy address" />
            </div>

            {tab === 'overview' && (
              <>
                <div className="inspector-score">
                  <div className="inspector-score-head">
                    <span>Anomaly score</span>
                    <b style={{ color: scoreVar(score) }}>{fmtNum(score, 1)}</b>
                  </div>
                  <div className="inspector-score-track">
                    <div
                      className="inspector-score-fill"
                      style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: scoreVar(score) }}
                    />
                  </div>
                </div>

                {patterns.length > 0 && (
                  <Collapse title="Detected patterns" count={patterns.length}>
                    <div className="col" style={{ padding: '0 var(--space-md)' }}>
                      {patterns.map((p) => (
                        <Notice key={p.text} kind={p.tone} icon={p.icon}>{p.text}</Notice>
                      ))}
                    </div>
                  </Collapse>
                )}

                <Collapse title="Balance">
                  <div className="prop-list">
                    {[
                      ['Received', fmtBtc(wallet.total_received)],
                      ['Sent', fmtBtc(wallet.total_sent)],
                      ['Balance', fmtBtc(wallet.balance)],
                      ['Transactions', fmtInt(wallet.tx_count)],
                      ['First seen', fmtDate(wallet.first_seen)],
                      ['Last seen', fmtDate(wallet.last_seen)],
                      ['Age', wallet.age_days != null ? `${Math.round(wallet.age_days)} days` : '—'],
                    ].map(([label, value]) => (
                      <div className="prop-row" key={label}>
                        <span className="prop-label">{label}</span>
                        <span className="prop-value mono">{value}</span>
                      </div>
                    ))}
                  </div>
                </Collapse>

                <Collapse title="Actions">
                  <div className="inspector-actions" style={{ borderBottom: 'none' }}>
                    <button className="btn" onClick={onOpenGraph}>
                      <Icon name="graph" size={12} /> Open in graph
                    </button>
                  </div>
                </Collapse>
              </>
            )}

            {tab === 'features' && (
              <div className="prop-list">
                {[
                  ['Fan in', fmtInt(wallet.fan_in_degree)],
                  ['Fan out', fmtInt(wallet.fan_out_degree)],
                  ['Velocity / hour', fmtInt(wallet.velocity_1h)],
                  ['Unique countries', fmtInt(wallet.unique_countries)],
                  ['Cluster', wallet.cluster_id ?? '—'],
                  ['Peel chain role', wallet.peel_chain_role || '—'],
                  ['Peel chain depth', wallet.peel_chain_depth ?? '—'],
                  ['Mixer interactions', fmtInt(wallet.mixer_interaction_count)],
                  ['Hops from watchlist', wallet.darknet_proximity_hops ?? '—'],
                  ['Watchlist proximity', wallet.darknet_proximity_score != null ? wallet.darknet_proximity_score.toFixed(3) : '—'],
                  ['Anomaly score', fmtNum(wallet.anomaly_score, 2)],
                  ['Risk tier', wallet.risk_tier || '—'],
                ].map(([label, value]) => (
                  <div className="prop-row" key={label}>
                    <span className="prop-label">{label}</span>
                    <span className="prop-value mono">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'links' && (
              <>
                <Collapse title="Similar wallets" count={counts.similar}>
                  {counts.similar === 0 ? (
                    <p className="inspector-note">No graph-embedding neighbours were recorded for this wallet.</p>
                  ) : wallet.similar_wallets.map((s) => (
                    <button
                      key={s.address}
                      type="button"
                      className="link-row"
                      onClick={() => onSelect(s.address)}
                      title={s.address}
                    >
                      <i className="legend-dot wallet" />
                      <code>{shortId(s.address, 12, 8)}</code>
                      <span className="link-row-meta">{(s.similarity * 100).toFixed(0)}%</span>
                    </button>
                  ))}
                </Collapse>

                <Collapse title="Connected IPs" count={counts.ips}>
                  {counts.ips === 0 ? (
                    <p className="inspector-note">
                      No network-layer observations. Datasets fetched from a public
                      blockchain API carry no IP data at all.
                    </p>
                  ) : wallet.connected_ips.map((ip) => (
                    <div className="link-row" key={ip.ip}>
                      <i className="legend-dot ip" />
                      <code>{ip.ip}</code>
                      <span className="link-row-meta">{[ip.country, ip.asn].filter(Boolean).join(' / ') || '—'}</span>
                    </div>
                  ))}
                </Collapse>
              </>
            )}

            {tab === 'txns' && (
              counts.txns === 0 ? (
                <Empty icon="swap" title="No recent transactions recorded" />
              ) : (
                <div className="prop-list">
                  {wallet.recent_transactions.map((tx) => {
                    const delta = (tx.total_output || 0) - (tx.total_input || 0);
                    return (
                      <div className="prop-row" key={tx.txid}>
                        <span className="prop-label mono" title={tx.txid}>{shortId(tx.txid, 10, 6)}</span>
                        <span className="prop-value">
                          <span className="row" style={{ justifyContent: 'space-between' }}>
                            <span className="muted">{fmtDate(tx.timestamp)}</span>
                            <span
                              className="mono"
                              style={{ color: delta >= 0 ? 'var(--status-ok)' : 'var(--risk-critical)' }}
                            >
                              {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(4)}
                            </span>
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </>
        )}

        {!loading && !wallet && !error && (
          <Empty icon="wallet" title="No record for this address">
            The backend has no wallet features stored for {shortId(address, 12, 8)}.
          </Empty>
        )}
      </div>
    </div>
  );
}
