import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '@react-sigma/core/lib/style.css';
import GraphCanvas from '../components/Graph/GraphCanvas';
import NodeInspector from '../components/Graph/NodeInspector';
import Icon from '../components/Icon';
import Tabs from '../components/ui/Tabs';
import Menu, { MenuItem, MenuSeparator, MenuHeading } from '../components/ui/Menu';
import { HistogramGroup, HistogramRow } from '../components/ui/Histogram';
import { Empty } from '../components/ui/States';
import { useResizablePane } from '../hooks/useResizablePane';
import { useCommands } from '../services/commands';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { TYPE_LEGEND, RISK_LEGEND, RISK_COLORS, TYPE_COLORS } from '../theme';
import { shortId, fmtInt } from '../services/format';
import { saveUrl, saveBlob, fileStamp } from '../services/download';
import {
  getGraphData, getSubgraph, searchGraph,
  getNodeDetail, getNeighbors, findPath, getClusters,
} from '../services/api';

const NODE_TYPES = TYPE_LEGEND;

const LAYOUTS = [
  { key: 'spring', label: 'Force-directed' },
  { key: 'kamada_kawai', label: 'Kamada-Kawai' },
  { key: 'circular', label: 'Circular' },
];

const DEFAULT_TYPES = { wallet: true, transaction: true, ip: true };

/**
 * Link analysis over the entity graph, laid out as the Gotham Graph
 * application: a grouped toolbar, a find box floating over a dot-grid
 * canvas, canvas furniture along the bottom, and a right-hand panel that
 * switches between the histogram of what is drawn and the record for what
 * is selected.
 *
 * The histogram is computed from the nodes actually on the canvas, and its
 * rows are filter controls — so the figure beside a type is always the
 * number of that type you are looking at, never a stale total.
 */
export default function GraphExplorer() {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [emptyReason, setEmptyReason] = useState(null);

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [expanding, setExpanding] = useState(false);

  // A ?q= on the URL is how global search hands an identifier to this page,
  // and it makes a search shareable as a link.
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [searchMatches, setSearchMatches] = useState(new Set());

  const [types, setTypes] = useState(DEFAULT_TYPES);
  const [minScore, setMinScore] = useState(0);
  const [layout, setLayout] = useState('spring');
  const [panel, setPanel] = useState(null);      // 'filters' | 'path' | 'keys' | null
  const [sideTab, setSideTab] = useState('summary');
  // Below this width the side panel overlays the canvas, so it must not
  // start open — it would hide the graph on load.
  const narrow = useMediaQuery('(max-width: 860px)');
  const [showSide, setShowSide] = useState(!narrow);

  const [pathSource, setPathSource] = useState(null);
  const [pathQuery, setPathQuery] = useState('');
  const [pathResult, setPathResult] = useState(null);
  const [pathBusy, setPathBusy] = useState(false);

  const [liveStats, setLiveStats] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [relayouting, setRelayouting] = useState(false);
  const [toast, setToast] = useState(null);

  const control = useRef({});
  const searchInput = useRef(null);
  const focusAfterLoad = useRef(null);

  const { width: sideWidth, splitterProps } = useResizablePane('graph-side', {
    initial: 300, min: 250, max: 520, edge: 'right',
  });

  const filters = useMemo(() => ({ types, minScore }), [types, minScore]);

  const pathNodes = useMemo(
    () => new Set(pathResult?.found ? pathResult.path.map((p) => p.id) : []),
    [pathResult],
  );
  // Edge keys come from the serialiser, so path edges are matched on their
  // endpoints instead.
  const pathEdges = useMemo(() => {
    const pairs = new Set();
    for (const hop of pathResult?.hops || []) {
      pairs.add(`${hop.source}\u0000${hop.target}`);
      pairs.add(`${hop.target}\u0000${hop.source}`);
    }
    return pairs;
  }, [pathResult]);

  const flash = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // ── Data loading ────────────────────────────────────────────────
  const load = useCallback(async (opts = {}) => {
    setLoading(true);
    setError(null);
    setEmptyReason(null);
    try {
      const res = await getGraphData({ layout: opts.layout || layout, max_nodes: 1500 });
      const data = res.data || {};
      setGraphData(data);
      if (!data.nodes?.length) setEmptyReason(data.reason || 'The graph is empty.');
    } catch (e) {
      // A frontend with no backend and a backend with no data look identical
      // on a blank canvas but need different fixes.
      setError(e.response
        ? `The backend returned ${e.response.status} for /api/graph/data.`
        : 'Cannot reach the backend. Check the API URL in Settings.');
      setGraphData({ nodes: [], edges: [], stats: {} });
    } finally {
      setLoading(false);
    }
  }, [layout]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clusters are a separate, optional read: the panel says so when the
  // backend has not computed any rather than showing an empty group.
  useEffect(() => {
    getClusters().then((res) => setClusters(res.data || [])).catch(() => setClusters([]));
  }, [graphData]);

  // ── Selection ───────────────────────────────────────────────────
  const selectNode = useCallback(async (nodeId, { center = true } = {}) => {
    setSelected(nodeId);
    setDetail({ id: nodeId, node_type: null });
    setDetailLoading(true);
    setSideTab('selection');
    setShowSide(true);
    if (center) control.current.focusOn?.(nodeId);
    try {
      const res = await getNodeDetail(nodeId);
      if (res.data?.found) setDetail(res.data);
      // Keep the backend's reason. Collapsing every outcome to a bare
      // `found: false` is what turned "the graph you are looking at is older
      // than the data behind it" into a blank panel labelled UNKNOWN.
      else setDetail({ node_type: 'unknown', ...res.data, id: nodeId, found: false });
    } catch (e) {
      setDetail({
        id: nodeId,
        node_type: 'unknown',
        found: false,
        reason: 'request_failed',
        detail: e.response
          ? `The backend returned ${e.response.status} for this entity's record.`
          : "The backend could not be reached for this entity's record.",
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setDetail(null);
    setSideTab('summary');
  }, []);

  // ── Search ──────────────────────────────────────────────────────
  // Keep the URL in step with the box, so a reload or a shared link lands on
  // the same search. `replace` keeps typing out of the history stack.
  useEffect(() => {
    const current = searchParams.get('q') || '';
    const next = query.trim();
    if (current === next) return;
    const params = new URLSearchParams(searchParams);
    if (next) params.set('q', next);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  }, [query, searchParams, setSearchParams]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearchMatches(new Set());
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchGraph(query.trim(), { limit: 12 });
        if (cancelled) return;
        const rows = res.data || [];
        setResults(rows);
        setSearchMatches(new Set(rows.map((r) => r.id)));
      } catch {
        if (!cancelled) { setResults([]); setSearchMatches(new Set()); }
      }
    }, 220);   // debounce: one request per pause, not per keystroke
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // ── Actions ─────────────────────────────────────────────────────
  const handleExpand = useCallback(async (nodeId) => {
    if (!nodeId) return;
    setExpanding(true);
    try {
      const res = await getNeighbors(nodeId, 60);
      const added = control.current.addFragment?.(res.data, nodeId) || 0;
      setLiveStats(control.current.getStats?.());
      flash(added > 0
        ? `Added ${added} connected ${added === 1 ? 'entity' : 'entities'}${res.data.truncated ? ` (of ${res.data.total_neighbors})` : ''}.`
        : 'All neighbours are already on the canvas.');
    } catch {
      flash('Could not expand this node.');
    } finally {
      setExpanding(false);
    }
  }, [flash]);

  const handleIsolate = useCallback(async (nodeId, hops = 2) => {
    setLoading(true);
    try {
      const res = await getSubgraph(nodeId, hops);
      if (!res.data?.nodes?.length) { flash('No subgraph available for that entity.'); return; }
      focusAfterLoad.current = nodeId;
      setGraphData(res.data);
      setEmptyReason(null);
    } catch {
      flash('Could not load that subgraph.');
    } finally {
      setLoading(false);
    }
  }, [flash]);

  const handleGraphLoaded = useCallback((graph) => {
    setLiveStats({ nodes: graph.order, edges: graph.size });
    const target = focusAfterLoad.current;
    if (target) {
      focusAfterLoad.current = null;
      // One frame after load, once the node has display coordinates.
      requestAnimationFrame(() => selectNode(target));
    }
  }, [selectNode]);

  /** Full reset: original graph, no filters, no selection, camera framed. */
  const handleReset = useCallback(async () => {
    setTypes(DEFAULT_TYPES);
    setMinScore(0);
    setQuery('');
    setResults([]);
    setSearchMatches(new Set());
    setPathResult(null);
    setPathSource(null);
    setPathQuery('');
    clearSelection();
    setHovered(null);
    await load();
    control.current.fit?.();
  }, [load, clearSelection]);

  const handlePathSearch = useCallback(async () => {
    if (!pathSource || !pathQuery.trim()) return;
    setPathBusy(true);
    try {
      const res = await findPath(pathSource, pathQuery.trim());
      setPathResult(res.data);
      if (!res.data?.found) flash(res.data?.reason || 'No path found.');
    } catch {
      flash('Path search failed.');
    } finally {
      setPathBusy(false);
    }
  }, [pathSource, pathQuery, flash]);

  const startPath = useCallback((nodeId) => {
    setPathSource(nodeId);
    setPathResult(null);
    setPanel('path');
  }, []);

  const exportPng = useCallback(() => {
    const url = control.current.snapshot?.();
    if (!url) return flash('Nothing to export yet.');
    // A data URL, so there is nothing to revoke.
    saveUrl(url, `chaintrace-graph-${fileStamp()}.png`);
    return flash('Graph exported as PNG.');
  }, [flash]);

  const exportJson = useCallback(() => {
    if (!graphData?.nodes?.length) return flash('Nothing to export yet.');
    const blob = new Blob([JSON.stringify(graphData, null, 2)], { type: 'application/json' });
    saveBlob(blob, `chaintrace-graph-${fileStamp()}.json`);
    return flash('Graph exported as JSON.');
  }, [graphData, flash]);

  useEffect(() => { if (narrow) setShowSide(false); }, [narrow]);

  // ── Menu bar commands ───────────────────────────────────────────
  useCommands({
    reload: () => load(),
    'export.png': exportPng,
    'export.json': exportJson,
    'find.focus': () => searchInput.current?.focus(),
    'filters.clear': () => { setTypes(DEFAULT_TYPES); setMinScore(0); },
    'panel.filters': () => setPanel((p) => (p === 'filters' ? null : 'filters')),
    'panel.summary': () => { setShowSide((v) => !v); setSideTab('summary'); },
    'panel.detail': () => { setShowSide(true); setSideTab('selection'); },
    'graph.fit': () => control.current.fit?.(),
    'graph.relayout': () => control.current.relayout?.(),
    'help.shortcuts': () => setPanel((p) => (p === 'keys' ? null : 'keys')),
    ...(selected ? {
      'graph.expand': () => handleExpand(selected),
      'graph.path': () => startPath(selected),
      'selection.clear': clearSelection,
      'selection.copy': () => navigator.clipboard?.writeText(selected),
    } : {}),
  });

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // Bare keys only. Without this, Ctrl/Cmd+R resets the graph on its way
      // to reloading the page, Ctrl+F fits it instead of opening find, and
      // Cmd+C re-centres the selection instead of copying.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
        || e.target.isContentEditable;
      if (e.key === 'Escape') {
        if (typing) { e.target.blur(); return; }
        clearSelection();
        setPathResult(null);
        setPanel(null);
        return;
      }
      if (typing) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          searchInput.current?.focus();
          break;
        case 'f': control.current.fit?.(); break;
        case 'r': handleReset(); break;
        case 'l': control.current.relayout?.(); break;
        case 'e': if (selected) handleExpand(selected); break;
        case 'c': if (selected) control.current.focusOn?.(selected); break;
        case '+': case '=': control.current.zoomIn?.(); break;
        case '-': case '_': control.current.zoomOut?.(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, handleExpand, handleReset, clearSelection]);

  // ── Histogram over what is actually drawn ───────────────────────
  const drawn = useMemo(() => {
    const nodes = graphData?.nodes || [];
    const visible = nodes.filter((n) => (
      types[n.node_type] !== false && (n.anomaly_score || 0) >= minScore
    ));
    const byType = new Map();
    const byTier = new Map();
    visible.forEach((n) => {
      byType.set(n.node_type, (byType.get(n.node_type) || 0) + 1);
      const tier = n.risk_tier || 'Normal';
      byTier.set(tier, (byTier.get(tier) || 0) + 1);
    });
    return { visible, byType, byTier };
  }, [graphData, types, minScore]);

  const stats = graphData?.stats || {};
  const shownNodes = liveStats?.nodes ?? stats.total_nodes ?? 0;
  const shownEdges = liveStats?.edges ?? stats.total_edges ?? 0;
  const activeFilters = Object.values(types).filter(Boolean).length < 3 || minScore > 0;

  const typeMax = Math.max(...NODE_TYPES.map((t) => drawn.byType.get(t.key) || 0), 1);
  const tierRows = ['Critical', 'High', 'Elevated', 'Low', 'Normal']
    .filter((t) => drawn.byTier.has(t))
    .map((t) => ({ tier: t, count: drawn.byTier.get(t) }));
  const tierMax = Math.max(...tierRows.map((r) => r.count), 1);

  return (
    <div className={`graph-page${showSide ? '' : ' no-side'}`} style={{ '--graph-panel-w': `${sideWidth}px` }}>
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="graph-toolbar">
        <div className="tool-group">
          <span className="tool-group-label">View</span>
          <div className="tool-group-items">
            <button className="tool-btn" onClick={() => control.current.fit?.()} title="Fit to view (F)">
              <Icon name="crosshair" size={13} /> <span>Fit</span>
            </button>
            <button className="tool-btn" onClick={() => control.current.zoomIn?.()} title="Zoom in (+)">
              <Icon name="plus" size={13} />
            </button>
            <button className="tool-btn" onClick={() => control.current.zoomOut?.()} title="Zoom out (−)">
              <Icon name="minus" size={13} />
            </button>
          </div>
        </div>

        <div className="tool-group">
          <span className="tool-group-label">Organise</span>
          <div className="tool-group-items">
            <select
              className="tool-select"
              value={layout}
              onChange={(e) => { setLayout(e.target.value); load({ layout: e.target.value }); }}
              title="Layout computed on the server"
              aria-label="Server layout"
            >
              {LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
            <button
              className="tool-btn"
              onClick={() => control.current.relayout?.()}
              disabled={relayouting}
              title="Re-run the force layout on what is currently drawn (L)"
            >
              <Icon name="layers" size={13} /> <span>{relayouting ? 'Laying out…' : 'Re-layout'}</span>
            </button>
            <button className="tool-btn" onClick={handleReset} title="Reset view and filters (R)">
              <Icon name="rotateCcw" size={13} /> <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="tool-group">
          <span className="tool-group-label">Filter</span>
          <div className="tool-group-items">
            <button
              className={`tool-btn${panel === 'filters' ? ' active' : ''}`}
              onClick={() => setPanel(panel === 'filters' ? null : 'filters')}
              title="Node type and score filters"
            >
              <Icon name="filter" size={13} /> <span>Filters</span>
              {activeFilters && <i className="tool-dot" />}
            </button>
          </div>
        </div>

        <div className="tool-group">
          <span className="tool-group-label">Selection</span>
          <div className="tool-group-items">
            <button
              className="tool-btn"
              disabled={!selected || expanding}
              onClick={() => handleExpand(selected)}
              title="Add the selected node's neighbours (E)"
            >
              <Icon name="expand" size={13} /> <span>Expand</span>
            </button>
            <button
              className={`tool-btn${panel === 'path' ? ' active' : ''}`}
              disabled={!selected}
              onClick={() => startPath(selected)}
              title="Trace the shortest connection from the selected node"
            >
              <Icon name="route" size={13} /> <span>Trace</span>
            </button>
            <button
              className="tool-btn"
              disabled={!selected}
              onClick={() => handleIsolate(selected, 2)}
              title="Redraw the canvas as this node's two-hop neighbourhood"
            >
              <Icon name="crosshair" size={13} /> <span>Isolate</span>
            </button>
          </div>
        </div>

        <span className="page-toolbar-spacer" />

        <div className="tool-group">
          <span className="tool-group-label">Panel</span>
          <div className="tool-group-items">
            <button
              className={`tool-btn${showSide ? ' active' : ''}`}
              onClick={() => setShowSide((v) => !v)}
              title="Show or hide the side panel"
            >
              <Icon name="panelRight" size={13} />
            </button>
            <button
              className={`tool-btn${panel === 'keys' ? ' active' : ''}`}
              onClick={() => setPanel(panel === 'keys' ? null : 'keys')}
              title="Keyboard shortcuts"
            >
              <Icon name="info" size={13} />
            </button>
            <Menu
              align="right"
              trigger={({ toggle, open }) => (
                <button className={`tool-btn${open ? ' active' : ''}`} onClick={toggle} title="Export">
                  <Icon name="download" size={13} /> <span>Export</span>
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <MenuHeading>{fmtInt(shownNodes)} nodes on canvas</MenuHeading>
                  <MenuItem close={close} icon="image" label="Export canvas as PNG" onSelect={exportPng} />
                  <MenuItem close={close} icon="boxDown" label="Export graph as JSON" onSelect={exportJson} />
                  <MenuSeparator />
                  <MenuItem
                    close={close}
                    icon="copy"
                    label="Copy selected identifier"
                    disabled={!selected}
                    onSelect={() => navigator.clipboard?.writeText(selected)}
                  />
                </>
              )}
            </Menu>
          </div>
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────── */}
      <div className="graph-stage">
        <GraphCanvas
          graphData={graphData}
          controlRef={control}
          hovered={hovered}
          selected={selected}
          filters={filters}
          pathNodes={pathNodes}
          pathEdges={pathEdges}
          searchMatches={searchMatches}
          onNodeClick={(id) => selectNode(id)}
          onNodeHover={setHovered}
          onStageClick={clearSelection}
          onGraphLoaded={handleGraphLoaded}
          onLayoutRunning={setRelayouting}
        />

        {/* Find box, floating over the canvas as in the Graph application. */}
        <div className="graph-find">
          <div className="graph-find-input">
            <Icon name="search" size={13} />
            <input
              ref={searchInput}
              type="text"
              placeholder="Find artifacts, objects and links…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find in graph"
            />
            {query && (
              <button className="icon-btn" onClick={() => setQuery('')} title="Clear" aria-label="Clear search">
                <Icon name="close" size={12} />
              </button>
            )}
            <kbd>/</kbd>
          </div>

          {results.length > 0 && (
            <div className="graph-find-results">
              {results.map((r) => (
                <button key={r.id} onClick={() => { selectNode(r.id); setQuery(''); }} title={r.id}>
                  <span className={`legend-dot ${r.node_type}`} />
                  <code>{shortId(r.id, 14, 8)}</code>
                  <span className="graph-find-meta">
                    {r.risk_tier && <span className={`badge ${r.risk_tier.toLowerCase()}`}>{r.risk_tier}</span>}
                    {r.degree != null && <span>{r.degree} links</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Overlay, never a branch that unmounts the canvas. */}
        {loading && (
          <div className="graph-overlay">
            <div className="spinner" />
            <span>Building entity graph…</span>
          </div>
        )}

        {!loading && (error || emptyReason) && (
          <div className="graph-overlay">
            <Icon name={error ? 'alertTriangle' : 'graph'} size={26} />
            <h3>{error ? 'Backend unreachable' : 'Nothing to display'}</h3>
            <p>{error || emptyReason}</p>
            <div className="graph-overlay-actions">
              <button className="btn" onClick={() => load()}>
                <Icon name="refresh" size={12} /> Retry
              </button>
              <Link className="btn btn-outline" to={error ? '/settings' : '/ingest'}>
                {error ? 'Open Settings' : 'Go to Ingest'}
              </Link>
            </div>
          </div>
        )}

        {/* Filters */}
        {panel === 'filters' && (
          <div className="graph-float">
            <header className="panel-header">
              <span className="panel-title"><Icon name="filter" size={12} /> Filters</span>
              <span className="panel-header-actions">
                <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close filters">
                  <Icon name="close" size={12} />
                </button>
              </span>
            </header>
            <div className="graph-float-body">
              <div className="col">
                {NODE_TYPES.map((t) => (
                  <label key={t.key} className="check">
                    <input
                      type="checkbox"
                      checked={types[t.key]}
                      onChange={() => setTypes((p) => ({ ...p, [t.key]: !p[t.key] }))}
                    />
                    <i className="legend-dot" style={{ background: t.color }} />
                    <span>{t.label}</span>
                    <span className="muted mono" style={{ marginLeft: 'auto' }}>
                      {fmtInt(drawn.byType.get(t.key) || 0)}
                    </span>
                  </label>
                ))}
              </div>

              <div className="col">
                <span className="field-label">Minimum anomaly score</span>
                <div className="slider-control">
                  <input
                    type="range" min="0" max="100" step="5"
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    aria-label="Minimum anomaly score"
                  />
                  <span className="slider-value">{minScore}</span>
                </div>
              </div>

              <button
                className="btn btn-block"
                onClick={() => { setTypes(DEFAULT_TYPES); setMinScore(0); }}
                disabled={!activeFilters}
              >
                Clear filters
              </button>
            </div>
          </div>
        )}

        {/* Path finder */}
        {panel === 'path' && (
          <div className="graph-float">
            <header className="panel-header">
              <span className="panel-title"><Icon name="route" size={12} /> Trace connection</span>
              <span className="panel-header-actions">
                <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close">
                  <Icon name="close" size={12} />
                </button>
              </span>
            </header>
            <div className="graph-float-body">
              <div className="path-endpoint">
                <span>From</span>
                <code title={pathSource}>{shortId(pathSource, 14, 10)}</code>
              </div>
              <div className="path-endpoint">
                <span>To</span>
                <input
                  className="input"
                  type="text"
                  placeholder="Paste an address, txid or IP"
                  value={pathQuery}
                  onChange={(e) => setPathQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePathSearch()}
                />
              </div>
              <button
                className="btn btn-primary btn-block"
                onClick={handlePathSearch}
                disabled={pathBusy || !pathQuery.trim()}
              >
                {pathBusy ? 'Searching…' : 'Find shortest path'}
              </button>

              {pathResult?.found && (
                <div className="path-result">
                  <p>{pathResult.length} hop{pathResult.length === 1 ? '' : 's'}</p>
                  <ol>
                    {pathResult.path.map((n, i) => (
                      <li key={n.id}>
                        <button onClick={() => selectNode(n.id)} title={n.id}>
                          <span className={`legend-dot ${n.node_type}`} />
                          <code>{shortId(n.id, 10, 6)}</code>
                        </button>
                        {i < pathResult.hops.length && (
                          <em>{pathResult.hops[i].edge_type?.replace(/_/g, ' ')}</em>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {pathResult && !pathResult.found && (
                <p className="inspector-note" style={{ padding: 0 }}>{pathResult.reason}</p>
              )}
            </div>
          </div>
        )}

        {/* Shortcuts */}
        {panel === 'keys' && (
          <div className="graph-float">
            <header className="panel-header">
              <span className="panel-title"><Icon name="info" size={12} /> Keyboard shortcuts</span>
              <span className="panel-header-actions">
                <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close">
                  <Icon name="close" size={12} />
                </button>
              </span>
            </header>
            <div className="graph-float-body">
              <div className="shortcut-list">
                {[
                  ['/', 'Focus find'],
                  ['F', 'Fit graph to view'],
                  ['R', 'Reset view and filters'],
                  ['L', 'Re-run force layout'],
                  ['E', 'Expand selected node'],
                  ['C', 'Centre selected node'],
                  ['+ / −', 'Zoom in / out'],
                  ['Esc', 'Clear selection'],
                ].map(([k, d]) => (
                  <div key={k}><kbd>{k}</kbd><span>{d}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Canvas furniture */}
        <div className="graph-footer">
          <div className="graph-legend">
            {NODE_TYPES.map((t) => (
              <span key={t.key} className="legend-item">
                <i className="legend-dot" style={{ background: t.color }} />{t.label}
              </span>
            ))}
            <i className="legend-sep" />
            {RISK_LEGEND.map((r) => (
              <span key={r.label} className="legend-item">
                <i className="legend-dot" style={{ background: r.color }} />{r.label}
              </span>
            ))}
          </div>
          <div className="graph-count">
            {fmtInt(shownNodes)} nodes · {fmtInt(shownEdges)} edges
            {stats.cluster_count ? ` · ${stats.cluster_count} clusters` : ''}
            {stats.truncated && (
              <span className="graph-count-warn" title="Only the most connected part of the graph is drawn">
                {' '}· sample of {fmtInt(stats.graph_total_nodes)}
              </span>
            )}
          </div>
        </div>

        <div className="graph-zoom">
          <button onClick={() => control.current.zoomIn?.()} title="Zoom in (+)" aria-label="Zoom in">
            <Icon name="plus" size={13} />
          </button>
          <button onClick={() => control.current.zoomOut?.()} title="Zoom out (−)" aria-label="Zoom out">
            <Icon name="minus" size={13} />
          </button>
          <button onClick={() => control.current.fit?.()} title="Fit (F)" aria-label="Fit to view">
            <Icon name="crosshair" size={13} />
          </button>
        </div>

        {toast && <div className="toast" role="status">{toast}</div>}
      </div>

      {/* ── Side panel ──────────────────────────────────────────── */}
      {showSide && (
        <aside className="graph-side" style={{ position: 'relative' }}>
          <div {...splitterProps} className={`${splitterProps.className} splitter-edge`} />
          <Tabs
            active={sideTab}
            onChange={setSideTab}
            tabs={[
              { key: 'summary', label: 'Histogram' },
              { key: 'selection', label: 'Selection', count: selected ? 1 : undefined },
            ]}
          />

          {sideTab === 'summary' && (
            <div className="browser-scroll">
              <HistogramGroup title="Object types" total={fmtInt(drawn.visible.length)}>
                {NODE_TYPES.map((t) => (
                  <HistogramRow
                    key={t.key}
                    label={t.label}
                    color={TYPE_COLORS[t.key]}
                    count={drawn.byType.get(t.key) || 0}
                    max={typeMax}
                    selected={types[t.key] === false ? false : undefined}
                    onSelect={() => setTypes((p) => ({ ...p, [t.key]: !p[t.key] }))}
                    title={`${t.label}: ${fmtInt(drawn.byType.get(t.key) || 0)} drawn — click to ${types[t.key] ? 'hide' : 'show'}`}
                  />
                ))}
              </HistogramGroup>

              <HistogramGroup title="Risk tier" total={fmtInt(drawn.visible.length)}>
                {tierRows.length === 0 ? (
                  <div className="histogram-empty">No scored nodes on the canvas.</div>
                ) : tierRows.map((r) => (
                  <HistogramRow
                    key={r.tier}
                    label={r.tier}
                    color={RISK_COLORS[r.tier]}
                    count={r.count}
                    max={tierMax}
                  />
                ))}
              </HistogramGroup>

              <HistogramGroup title="Clusters" total={fmtInt(clusters.length)} defaultOpen={false}>
                {clusters.length === 0 ? (
                  <div className="histogram-empty">
                    The backend has not computed any wallet clusters for this dataset.
                  </div>
                ) : clusters.slice(0, 20).map((c) => (
                  <HistogramRow
                    key={c.cluster_id}
                    label={`Cluster ${c.cluster_id}`}
                    count={c.wallet_count}
                    max={Math.max(...clusters.map((x) => x.wallet_count), 1)}
                    onSelect={c.wallets?.[0] ? () => selectNode(c.wallets[0]) : undefined}
                    title={`${c.wallet_count} wallets · ${c.tx_count} transactions`}
                  />
                ))}
              </HistogramGroup>

              <div className="section-label">Canvas</div>
              <div className="prop-list">
                <div className="prop-row">
                  <span className="prop-label">Nodes drawn</span>
                  <span className="prop-value mono">{fmtInt(shownNodes)}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">Edges drawn</span>
                  <span className="prop-value mono">{fmtInt(shownEdges)}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">Passing filters</span>
                  <span className="prop-value mono">{fmtInt(drawn.visible.length)}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">Layout</span>
                  <span className="prop-value">{LAYOUTS.find((l) => l.key === layout)?.label}</span>
                </div>
              </div>
            </div>
          )}

          {sideTab === 'selection' && (
            detail ? (
              <NodeInspector
                detail={detail}
                loading={detailLoading}
                expanding={expanding}
                onClose={clearSelection}
                onFocus={(id) => control.current.focusOn?.(id)}
                onExpand={handleExpand}
                onSelectNode={(id) => {
                  if (control.current.hasNode?.(id)) selectNode(id);
                  else handleIsolate(id, 1);
                }}
                onPathFrom={startPath}
                onReload={() => { clearSelection(); load(); }}
              />
            ) : (
              <Empty icon="crosshair" title="Nothing selected">
                Click a node on the canvas, or find one with the search box, to
                see its record here.
              </Empty>
            )
          )}
        </aside>
      )}
    </div>
  );
}
