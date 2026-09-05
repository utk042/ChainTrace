import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getAlerts, getAlertDetail, exportAlerts, updateAlertStatus,
} from '../services/api';
import { saveBlob } from '../services/download';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useCommands } from '../services/commands';
import { useIsNarrow } from '../hooks/useMediaQuery';
import {
  shortId, fmtInt, fmtPct, fmtTimestamp, toCsv, riskVar,
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

const TIERS = ['Critical', 'High', 'Elevated'];
const STATUSES = ['pending', 'investigating', 'resolved', 'dismissed'];
const MODELS = [
  'Autoencoder',
  'Peel-Chain',
  'Mixer-Hub',
  'CoinJoin',
  'Risk-Propagation',
];
const ENTITY_TYPES = [
  { key: 'wallet', label: 'Wallet' },
  { key: 'transaction', label: 'Transaction' },
  { key: 'ip', label: 'IP address' },
];

const CSV_COLUMNS = [
  ['alert_id', 'Alert ID'], ['entity_id', 'Entity ID'], ['entity_type', 'Entity type'],
  ['risk_tier', 'Risk tier'], ['confidence', 'Confidence'], ['model', 'Model'],
  ['status', 'Status'], ['description', 'Description'], ['timestamp', 'Timestamp'],
];

const COLUMNS = [
  { key: 'risk_tier', label: 'Risk', sortable: true, width: 84 },
  { key: 'entity_id', label: 'Entity', sortable: true },
  { key: 'model', label: 'Model', sortable: false, width: 130 },
  { key: 'confidence', label: 'Conf.', sortable: true, width: 66, align: 'right' },
  { key: 'description', label: 'Finding', sortable: false },
  { key: 'status', label: 'Status', sortable: false, width: 104 },
  { key: 'timestamp', label: 'Raised', sortable: true, width: 152 },
];

const EMPTY_FILTERS = {
  search: '', risk_tier: '', status: '', entity_type: '', model: '', min_confidence: 0,
};

/**
 * Alert triage, laid out as the Gotham Browser: filters, results, and the
 * record you have selected.
 *
 * Every control here is bound to a backend parameter — the risk chips, the
 * status chips, the confidence floor, the column sorts — so what the panel
 * says is filtered actually is filtered server-side, rather than the list
 * being trimmed after the fact and the total left describing something else.
 */
export default function Alerts() {
  const navigate = useNavigate();
  const { openTab } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleOpenInGraph = useCallback((entityId) => {
    if (!entityId) return;
    const targetPath = `/graph?q=${encodeURIComponent(entityId)}`;
    openTab('graph', { forceNew: false, path: targetPath });
    navigate(targetPath);
  }, [openTab, navigate]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ by: 'confidence', order: 'desc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  // Set when an offline read was answered by re-slicing stored rows that do
  // not cover the whole result set; the table must say so rather than let a
  // short answer read as a complete one.
  const [partial, setPartial] = useState(null);
  const narrow = useIsNarrow();
  const [showFilters, setShowFilters] = useState(!narrow);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [statusBusy, setStatusBusy] = useState(false);

  const searchRef = useRef(null);
  const search = useDebouncedValue(filters.search, 280);

  // Links from the overview arrive as ?tier= / ?focus=. They are applied and
  // then stripped, so the parameters describe an action taken rather than
  // state the page has to keep re-honouring on every later render.
  useEffect(() => {
    const tier = searchParams.get('tier');
    const focus = searchParams.get('focus');
    if (!tier && !focus) return;
    if (tier) setFilters((f) => ({ ...f, risk_tier: tier }));
    if (focus) {
      setSelectedId(focus);
      setDetailLoading(true);
      setDetailError(null);
      getAlertDetail(focus)
        .then((res) => setDetail(res.data))
        .catch((e) => setDetailError(e.response
          ? `The backend returned ${e.response.status} for alert ${focus}.`
          : 'The backend could not be reached for that alert.'))
        .finally(() => setDetailLoading(false));
    }
    const next = new URLSearchParams(searchParams);
    next.delete('tier');
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const query = useMemo(() => {
    const params = {
      page, page_size: PAGE_SIZE, sort_by: sort.by, sort_order: sort.order,
    };
    if (search.trim()) params.search = search.trim();
    if (filters.risk_tier) params.risk_tier = filters.risk_tier;
    if (filters.status) params.status = filters.status;
    if (filters.entity_type) params.entity_type = filters.entity_type;
    if (filters.model) params.model = filters.model;
    if (filters.min_confidence > 0) params.min_confidence = filters.min_confidence;
    return params;
  }, [page, sort, search, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAlerts(query);
      setRows(res.data.alerts || []);
      setTotal(res.data.total || 0);
      setPartial(res.data.offline_partial ? {
        rows: res.data.offline_rows_available,
        backendTotal: res.data.offline_backend_total,
      } : null);
    } catch (e) {
      // Swallowing this left an empty table that looked like a clean result
      // set rather than a failed request.
      setRows([]);
      setTotal(0);
      setPartial(null);
      setError(e.response
        ? `The backend returned ${e.response.status} for /api/alerts.`
        : 'Could not reach the backend, and no stored copy of this query is available offline.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  // Changing a filter invalidates the page number: page 3 of the old result
  // set is usually past the end of the new one, which reads as "no alerts".
  useEffect(() => { setPage(1); }, [search, filters.risk_tier, filters.status,
    filters.entity_type, filters.model, filters.min_confidence, sort]);

  const update = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const toggleSort = (key) => setSort((s) => (
    s.by === key
      ? { by: key, order: s.order === 'desc' ? 'asc' : 'desc' }
      : { by: key, order: key === 'entity_id' ? 'asc' : 'desc' }
  ));

  // ─── Selection ─────────────────────────────────────────────────
  const select = useCallback(async (alert) => {
    setSelectedId(alert.alert_id);
    setDetailTab('overview');
    setDetailError(null);
    // Show the row we already have while the full record loads, so the pane
    // never flashes empty.
    setDetail(alert);
    setDetailLoading(true);
    try {
      const res = await getAlertDetail(alert.alert_id);
      setDetail(res.data);
    } catch (e) {
      setDetailError(e.response
        ? `The backend returned ${e.response.status} for this alert's record.`
        : "The backend could not be reached for this alert's record.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const setStatus = async (next) => {
    if (!detail) return;
    setStatusBusy(true);
    setNote(null);
    try {
      await updateAlertStatus(detail.alert_id, next);
      setDetail((d) => ({ ...d, status: next }));
      // Keep the row in the list in step rather than refetching the page.
      setRows((list) => list.map((r) => (
        r.alert_id === detail.alert_id ? { ...r, status: next } : r
      )));
      setNote({ kind: 'ok', text: `Alert marked ${next}.` });
    } catch (e) {
      setNote({
        kind: 'error',
        text: e.response?.data?.error || e.response?.data?.detail
          || 'The backend refused the status change.',
      });
    } finally {
      setStatusBusy(false);
    }
  };

  // ─── Export ────────────────────────────────────────────────────
  const exportCsv = useCallback(async () => {
    setNote(null);
    try {
      const res = await exportAlerts();
      saveBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), 'chaintrace_alerts.csv');
      return;
    } catch { /* no server-side export: build it from what is loadable */ }

    try {
      const res = await getAlerts({ ...query, page: 1, page_size: 10000 });
      const list = res.data?.alerts || [];
      if (!list.length) { setNote({ kind: 'warn', text: 'There is nothing to export.' }); return; }
      saveBlob(new Blob([toCsv(CSV_COLUMNS, list)], { type: 'text/csv;charset=utf-8' }),
        'chaintrace_alerts.csv');
      setNote({
        kind: 'info',
        text: `Exported ${list.length.toLocaleString()} alerts from stored data — the backend's export endpoint was not reachable.`,
      });
    } catch {
      setNote({ kind: 'error', text: 'Export failed: the backend is unreachable and no stored alerts are available.' });
    }
  }, [query]);

  const exportJson = useCallback(() => {
    if (!rows.length) { setNote({ kind: 'warn', text: 'There is nothing to export.' }); return; }
    saveBlob(
      new Blob([JSON.stringify({ query, total, alerts: rows }, null, 2)], { type: 'application/json' }),
      'chaintrace_alerts.json',
    );
  }, [rows, query, total]);

  // ─── Menu bar commands ─────────────────────────────────────────
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
    'panel.detail': () => (detail ? clearSelection() : undefined),
    ...(detail ? {
      'selection.clear': clearSelection,
      'selection.copy': () => navigator.clipboard?.writeText(detail.entity_id),
      'open.graph': () => handleOpenInGraph(detail.entity_id),
    } : {}),
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && detail) clearSelection();
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, clearSelection]);

  // ─── Facets, computed from the page actually loaded ────────────
  // Labelled as such: a facet drawn from 25 rows is not a census of 4,000,
  // and presenting it as one would be a fabricated figure.
  const facets = useMemo(() => {
    const count = (key) => {
      const map = new Map();
      rows.forEach((r) => {
        const value = r[key] || 'unknown';
        map.set(value, (map.get(value) || 0) + 1);
      });
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => ({ key: label, label, count: n }));
    };
    return {
      tier: count('risk_tier').map((r) => ({ ...r, color: riskVar(r.key) })),
      model: count('model'),
      entity: count('entity_type'),
      status: count('status'),
    };
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = Object.entries(filters)
    .filter(([key, value]) => key !== 'search' && value !== '' && value !== 0).length
    + (filters.search ? 1 : 0);

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="page-toolbar-title">
          <Icon name="alertTriangle" size={14} />
          Alerts
          <span className="count">{loading ? '…' : fmtInt(total)}</span>
        </span>

        <button
          type="button"
          className={`tool-btn${showFilters ? ' active' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          title="Show or hide the filter panel"
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
            placeholder="Entity id or finding text"
            aria-label="Search alerts"
          />
          <kbd>/</kbd>
        </div>

        <span className="page-toolbar-spacer" />

        <button type="button" className="tool-btn" onClick={load} title="Reload from the backend">
          <Icon name="refresh" size={13} />
          <span>Reload</span>
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
              <MenuHeading>{fmtInt(total)} matching alerts</MenuHeading>
              <MenuItem close={close} icon="download" label="Export as CSV" onSelect={exportCsv} />
              <MenuItem close={close} icon="boxDown" label="Export page as JSON" onSelect={exportJson} />
              <MenuSeparator />
              <MenuItem
                close={close}
                icon="graph"
                label="Open selection in graph"
                disabled={!detail}
                onSelect={() => handleOpenInGraph(detail.entity_id)}
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
            from the {fmtInt(partial.rows)} alerts stored here. The backend last
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
          >
            {note.text}
          </Notice>
        </div>
      )}

      <BrowserView
        id="alerts"
        showFilters={showFilters}
        onCloseFilters={() => setShowFilters(false)}
        filters={(
          <>
            <div className="filter-block">
              <div className="filter-block-title">
                Risk tier
                {filters.risk_tier && (
                  <button className="reset" onClick={() => update({ risk_tier: '' })}>clear</button>
                )}
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
                Disposition
                {filters.status && (
                  <button className="reset" onClick={() => update({ status: '' })}>clear</button>
                )}
              </div>
              <div className="chip-row">
                <button
                  className={`chip${filters.status === '' ? ' selected' : ''}`}
                  onClick={() => update({ status: '' })}
                >Any</button>
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`chip${filters.status === s ? ' selected' : ''}`}
                    onClick={() => update({ status: filters.status === s ? '' : s })}
                  >{s}</button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block-title">
                Minimum confidence
                {filters.min_confidence > 0 && (
                  <button className="reset" onClick={() => update({ min_confidence: 0 })}>clear</button>
                )}
              </div>
              <div className="slider-control">
                <input
                  type="range" min="0" max="100" step="5"
                  value={filters.min_confidence}
                  onChange={(e) => update({ min_confidence: Number(e.target.value) })}
                  aria-label="Minimum confidence"
                />
                <span className="slider-value">{filters.min_confidence}%</span>
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block-title">
                Entity type
                {filters.entity_type && (
                  <button className="reset" onClick={() => update({ entity_type: '' })}>clear</button>
                )}
              </div>
              <select
                className="select"
                value={filters.entity_type}
                onChange={(e) => update({ entity_type: e.target.value })}
                aria-label="Entity type"
              >
                <option value="">Any type</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="filter-block">
              <div className="filter-block-title">
                Model
                {filters.model && (
                  <button className="reset" onClick={() => update({ model: '' })}>clear</button>
                )}
              </div>
              <select
                className="select"
                value={filters.model}
                onChange={(e) => update({ model: e.target.value })}
                aria-label="Model"
              >
                <option value="">Any model</option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="section-label">
              This page
              <span className="section-label-count">{rows.length}</span>
            </div>
            <div style={{ padding: '0 0 var(--space-md)' }} title="Counted from the alerts currently loaded, not from the whole result set">
              <HistogramFacet
                title="Risk tier"
                rows={facets.tier}
                selected={filters.risk_tier}
                onSelect={(key) => update({ risk_tier: filters.risk_tier === key ? '' : key })}
              />
              <HistogramFacet
                title="Disposition"
                rows={facets.status}
                selected={filters.status}
                onSelect={(key) => update({ status: filters.status === key ? '' : key })}
              />
              <HistogramFacet
                title="Model"
                rows={facets.model}
                selected={filters.model}
                onSelect={(key) => update({ model: filters.model === key ? '' : key })}
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
              <Failed title="Could not load alerts" actions={<button className="btn" onClick={load}><Icon name="refresh" size={12} /> Retry</button>}>
                {error}
              </Failed>
            ) : loading ? (
              <Loading label="Querying alerts…" />
            ) : rows.length === 0 ? (
              <Empty title="No alerts match these filters">
                {activeFilterCount > 0
                  ? 'Every filter is applied server-side, so this is the complete answer for the current parameters.'
                  : 'The backend holds no alerts. Run the pipeline over a dataset to produce some.'}
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
                          className={col.sortable ? 'sortable' : undefined}
                          onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                          aria-sort={sort.by === col.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <span className={`th-inner${col.align === 'right' ? ' right' : ''}`}>
                            {col.label}
                            {sort.by === col.key && (
                              <Icon
                                className="th-sort"
                                name={sort.order === 'asc' ? 'sortAsc' : 'sortDesc'}
                                size={10}
                              />
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((alert) => (
                      <tr
                        key={alert.alert_id}
                        className={`clickable${selectedId === alert.alert_id ? ' selected' : ''}`}
                        onClick={() => select(alert)}
                      >
                        <td>
                          <span className={`badge ${alert.risk_tier?.toLowerCase()}`}>{alert.risk_tier}</span>
                        </td>
                        <td className="mono" title={alert.entity_id}>{shortId(alert.entity_id, 10, 6)}</td>
                        <td title={alert.model}>{alert.model}</td>
                        <td className="num" style={{ color: riskVar(alert.risk_tier) }}>
                          {fmtPct(alert.confidence)}
                        </td>
                        <td className="wrap" title={alert.description}>{alert.description}</td>
                        <td>{alert.status}</td>
                        <td className="mono">{fmtTimestamp(alert.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pagination">
              <button
                className="btn btn-sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <Icon name="chevronLeft" size={11} /> Prev
              </button>
              <span className="page-info">Page {page} of {pageCount}</span>
              <button
                className="btn btn-sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <Icon name="chevronRight" size={11} />
              </button>
              <span className="pagination-spacer" />
              <span className="page-info">
                {rows.length ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length}` : '0'} of {fmtInt(total)}
              </span>
            </div>
          </>
        )}
        detail={detail && (
          <AlertDetail
            alert={detail}
            loading={detailLoading}
            error={detailError}
            tab={detailTab}
            onTab={setDetailTab}
            onClose={clearSelection}
            onStatus={setStatus}
            statusBusy={statusBusy}
            onOpenGraph={() => handleOpenInGraph(detail.entity_id)}
          />
        )}
      />
    </div>
  );
}

/** The selected alert: header, tabs, and the model's own explanation. */
function AlertDetail({
  alert, loading, error, tab, onTab, onClose, onStatus, statusBusy, onOpenGraph,
}) {
  const shap = Array.isArray(alert.shap_values) ? alert.shap_values : [];
  const maxContribution = shap.reduce(
    (m, s) => Math.max(m, Math.abs(s.contribution || 0)), 0.01,
  );

  return (
    <div className="inspector">
      <div className="detail-head">
        <div className="detail-head-main">
          <span className="detail-head-title">{shortId(alert.entity_id, 18, 12)}</span>
          <span className="detail-head-sub">
            {alert.entity_type ? `${alert.entity_type} · ` : ''}alert {shortId(alert.alert_id, 8, 6)}
          </span>
          <div className="detail-badges">
            <span className={`badge ${alert.risk_tier?.toLowerCase()}`}>{alert.risk_tier}</span>
            <span className="badge info">{fmtPct(alert.confidence)} confidence</span>
            <span className="badge">{alert.status}</span>
          </div>
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
          { key: 'explanation', label: 'Explanation', count: shap.length || undefined },
          { key: 'properties', label: 'Properties' },
        ]}
      />

      <div className="inspector-scroll">
        {error && (
          <div style={{ padding: 'var(--space-md)' }}>
            <Notice kind="warn">
              {error} The fields below are from the results list, which may be
              less complete than the full record.
            </Notice>
          </div>
        )}

        {loading && <Loading label="Loading record…" />}

        {tab === 'overview' && (
          <>
            <div className="id-block">
              <code>{alert.entity_id}</code>
              <CopyButton value={alert.entity_id} title="Copy entity identifier" />
            </div>

            <div className="collapse-body" style={{ padding: '0 var(--space-md) var(--space-md)' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {alert.description || 'The model recorded no description for this finding.'}
              </p>
            </div>

            <Collapse title="Disposition" defaultOpen>
              <div className="chip-row" style={{ padding: '0 var(--space-md)' }}>
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`chip${alert.status === s ? ' selected' : ''}`}
                    disabled={statusBusy}
                    onClick={() => onStatus(s)}
                    title={`Mark this alert ${s}`}
                  >{s}</button>
                ))}
              </div>
              <p className="inspector-note">
                Disposition is written straight to the backend. In snapshot mode
                there is no backend to write to and the change is refused rather
                than faked.
              </p>
            </Collapse>

            <Collapse title="Actions" defaultOpen>
              <div className="inspector-actions" style={{ borderBottom: 'none' }}>
                <button className="btn" onClick={onOpenGraph}>
                  <Icon name="graph" size={12} /> Open in graph
                </button>
              </div>
            </Collapse>
          </>
        )}

        {tab === 'explanation' && (
          <div style={{ padding: 'var(--space-md)' }}>
            {shap.length === 0 ? (
              <Empty icon="barChart" title="No explanation recorded">
                This alert carries no SHAP contributions. Models running in
                light mode score without producing per-feature attributions.
              </Empty>
            ) : (
              <>
                <div className="section-label" style={{ padding: '0 0 var(--space-sm)' }}>
                  SHAP feature contribution
                </div>
                <div className="shap-list">
                  {shap.map((s, i) => {
                    const contribution = s.contribution || 0;
                    const pct = Math.min(100, (Math.abs(contribution) / maxContribution) * 100);
                    return (
                      <div className="shap-row" key={`${s.feature}-${i}`}>
                        <span className="shap-label" title={s.feature}>{s.feature}</span>
                        <span className="shap-track">
                          <span
                            className={`shap-fill ${contribution >= 0 ? 'positive' : 'negative'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="shap-value">
                          {contribution >= 0 ? '+' : ''}{contribution.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="inspector-note" style={{ padding: 'var(--space-md) 0 0' }}>
                  A positive contribution pushed the score up; a negative one
                  pulled it down. Bars are scaled to the largest magnitude in
                  this alert, not across alerts.
                </p>
              </>
            )}
          </div>
        )}

        {tab === 'properties' && (
          <div className="prop-list">
            {[
              ['Alert id', alert.alert_id],
              ['Entity id', alert.entity_id],
              ['Entity type', alert.entity_type],
              ['Risk tier', alert.risk_tier],
              ['Confidence', fmtPct(alert.confidence)],
              ['Model', alert.model],
              ['Status', alert.status],
              ['Raised', fmtTimestamp(alert.timestamp)],
            ].map(([label, value]) => (
              <div className="prop-row" key={label}>
                <span className="prop-label">{label}</span>
                <span className="prop-value mono">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
