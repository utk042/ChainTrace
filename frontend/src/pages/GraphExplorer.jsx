import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '@react-sigma/core/lib/style.css';
import GraphCanvas from '../components/Graph/GraphCanvas';
import NodeInspector from '../components/Graph/NodeInspector';
import Icon from '../components/Icon';
import { TYPE_LEGEND, RISK_LEGEND } from '../theme';
import { saveUrl, saveBlob, fileStamp } from '../services/download';
import {
  getGraphData, getSubgraph, searchGraph,
  getNodeDetail, getNeighbors, findPath,
} from '../services/api';

const NODE_TYPES = TYPE_LEGEND;

const LAYOUTS = [
  { key: 'spring', label: 'Force-directed' },
  { key: 'kamada_kawai', label: 'Kamada-Kawai' },
  { key: 'circular', label: 'Circular' },
];

const DEFAULT_TYPES = { wallet: true, transaction: true, ip: true };

function shortId(id, head = 10, tail = 8) {
  if (!id || id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

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

  // A ?q= on the URL is how the global search box in the top bar hands an
  // identifier to this page, and it makes a search shareable as a link.
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [searchMatches, setSearchMatches] = useState(new Set());

  const [types, setTypes] = useState(DEFAULT_TYPES);
  const [minScore, setMinScore] = useState(0);
  const [layout, setLayout] = useState('spring');
  const [panel, setPanel] = useState(null);      // 'filters' | 'legend' | 'keys' | null

  const [pathSource, setPathSource] = useState(null);
  const [pathQuery, setPathQuery] = useState('');
  const [pathResult, setPathResult] = useState(null);
  const [pathBusy, setPathBusy] = useState(false);

  const [liveStats, setLiveStats] = useState(null);
  const [relayouting, setRelayouting] = useState(false);
  const [toast, setToast] = useState(null);

  const control = useRef({});
  const searchInput = useRef(null);
  const focusAfterLoad = useRef(null);

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
      const res = await getGraphData({
        layout: opts.layout || layout,
        max_nodes: 1500,
      });
      const data = res.data || {};
      setGraphData(data);
      if (!data.nodes?.length) {
        setEmptyReason(data.reason || 'The graph is empty.');
      }
    } catch (e) {
      // A frontend with no backend and a backend with no data look
      // identical on a blank canvas but need different fixes.
      setError(
        e.response
          ? `Backend returned ${e.response.status} for /api/graph/data.`
          : 'Cannot reach the backend. Check the API URL in Settings.',
      );
      setGraphData({ nodes: [], edges: [], stats: {} });
    } finally {
      setLoading(false);
    }
  }, [layout]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection ───────────────────────────────────────────────────
  const selectNode = useCallback(async (nodeId, { center = true } = {}) => {
    setSelected(nodeId);
    setDetail({ id: nodeId, node_type: null });
    setDetailLoading(true);
    // Selection centres the node at a readable zoom.
    if (center) control.current.focusOn?.(nodeId);
    try {
      const res = await getNodeDetail(nodeId);
      if (res.data?.found) setDetail(res.data);
      else setDetail({ id: nodeId, node_type: 'unknown', found: false });
    } catch {
      setDetail({ id: nodeId, node_type: 'unknown', found: false });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setDetail(null);
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
      return;
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
    setExpanding(true);
    try {
      const res = await getNeighbors(nodeId, 60);
      const added = control.current.addFragment?.(res.data, nodeId) || 0;
      setLiveStats(control.current.getStats?.());
      flash(
        added > 0
          ? `Added ${added} connected ${added === 1 ? 'entity' : 'entities'}${res.data.truncated ? ` (of ${res.data.total_neighbors})` : ''}.`
          : 'All neighbours are already on the canvas.',
      );
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
      if (!res.data?.nodes?.length) {
        flash('No subgraph available for that entity.');
        return;
      }
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

  const stats = graphData?.stats || {};
  const shownNodes = liveStats?.nodes ?? stats.total_nodes ?? 0;
  const shownEdges = liveStats?.edges ?? stats.total_edges ?? 0;
  const activeFilters = Object.values(types).filter(Boolean).length < 3 || minScore > 0;

  return (
    <div className="graph-page">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="graph-toolbar">
        <div className="graph-search">
          <Icon name="search" size={14} style={{ opacity: 0.5 }} />
          <input
            ref={searchInput}
            type="text"
            placeholder="Search address, txid or IP…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} title="Clear">
              <Icon name="close" size={13} />
            </button>
          )}
          <kbd>/</kbd>

          {results.length > 0 && (
            <div className="graph-search-results">
              {results.map((r) => (
                <button key={r.id} onClick={() => { selectNode(r.id); setQuery(''); }}>
                  <span className={`legend-dot ${r.node_type}`} />
                  <code>{shortId(r.id, 12, 8)}</code>
                  <span className="graph-search-meta">
                    {r.risk_tier && <em className={`badge ${r.risk_tier.toLowerCase()}`}>{r.risk_tier}</em>}
                    {r.degree != null && `${r.degree} links`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="graph-toolbar-actions">
          <button
            className={`tool-btn${activeFilters ? ' active' : ''}`}
            onClick={() => setPanel(panel === 'filters' ? null : 'filters')}
            title="Filters"
          >
            <Icon name="filter" size={14} /> <span>Filters</span>
            {activeFilters && <i className="tool-dot" />}
          </button>

          <select
            className="tool-select"
            value={layout}
            onChange={(e) => { setLayout(e.target.value); load({ layout: e.target.value }); }}
            title="Server layout"
          >
            {LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>

          <button className="tool-btn" onClick={() => control.current.relayout?.()}
                  disabled={relayouting} title="Re-run force layout on the current view (L)">
            <Icon name="layers" size={14} /> <span>{relayouting ? 'Laying out…' : 'Re-layout'}</span>
          </button>

          <div className="tool-divider" />

          <button className="tool-btn" onClick={() => control.current.fit?.()} title="Fit to view (F)">
            <Icon name="crosshair" size={14} /> <span>Fit</span>
          </button>
          <button className="tool-btn" onClick={handleReset} title="Reset everything (R)">
            <Icon name="rotateCcw" size={14} /> <span>Reset</span>
          </button>

          <div className="tool-divider" />

          <button className="tool-btn" onClick={exportPng} title="Export PNG">
            <Icon name="image" size={14} />
          </button>
          <button className="tool-btn" onClick={exportJson} title="Export JSON">
            <Icon name="download" size={14} />
          </button>
          <button className={`tool-btn${panel === 'keys' ? ' active' : ''}`}
                  onClick={() => setPanel(panel === 'keys' ? null : 'keys')} title="Shortcuts">
            <Icon name="info" size={14} />
          </button>
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

        {/* Overlay, never a branch that unmounts the canvas. */}
        {loading && (
          <div className="graph-overlay">
            <div className="spinner" />
            <span>Building entity graph…</span>
          </div>
        )}

        {!loading && (error || emptyReason) && (
          <div className="graph-overlay graph-overlay-message">
            <Icon name={error ? 'alertTriangle' : 'graph'} size={26} />
            <h3>{error ? 'Backend unreachable' : 'Nothing to display'}</h3>
            <p>{error || emptyReason}</p>
            <div className="graph-overlay-actions">
              <button className="btn btn-outline" onClick={() => load()}>
                <Icon name="refresh" size={13} /> Retry
              </button>
              <Link className="btn btn-outline" to={error ? '/settings' : '/ingest'}>
                {error ? 'Open Settings' : 'Go to Ingest'}
              </Link>
            </div>
          </div>
        )}

        {/* Filters */}
        {panel === 'filters' && (
          <div className="graph-panel graph-panel-left">
            <header>
              <Icon name="filter" size={13} /> Filters
              <button className="icon-btn" onClick={() => setPanel(null)}><Icon name="close" size={13} /></button>
            </header>
            <div className="graph-panel-body">
              {NODE_TYPES.map((t) => (
                <label key={t.key} className="filter-check">
                  <input
                    type="checkbox"
                    checked={types[t.key]}
                    onChange={() => setTypes((p) => ({ ...p, [t.key]: !p[t.key] }))}
                  />
                  <span className="legend-dot" style={{ background: t.color }} />
                  {t.label}
                </label>
              ))}
              <div className="filter-slider">
                <span>Minimum anomaly score<b>{minScore}</b></span>
                <input type="range" min="0" max="100" step="5"
                       value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
              </div>
              <button className="btn btn-outline" style={{ width: '100%' }}
                      onClick={() => { setTypes(DEFAULT_TYPES); setMinScore(0); }}>
                Clear filters
              </button>
            </div>
          </div>
        )}

        {/* Path finder */}
        {panel === 'path' && (
          <div className="graph-panel graph-panel-left">
            <header>
              <Icon name="route" size={13} /> Trace connection
              <button className="icon-btn" onClick={() => setPanel(null)}><Icon name="close" size={13} /></button>
            </header>
            <div className="graph-panel-body">
              <div className="path-endpoint">
                <span>FROM</span>
                <code>{shortId(pathSource, 12, 8)}</code>
              </div>
              <div className="path-endpoint">
                <span>TO</span>
                <input
                  type="text"
                  placeholder="Paste an address, txid or IP"
                  value={pathQuery}
                  onChange={(e) => setPathQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePathSearch()}
                />
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }}
                      onClick={handlePathSearch} disabled={pathBusy || !pathQuery.trim()}>
                {pathBusy ? 'Searching…' : 'Find shortest path'}
              </button>

              {pathResult?.found && (
                <div className="path-result">
                  <p>{pathResult.length} hop{pathResult.length === 1 ? '' : 's'}</p>
                  <ol>
                    {pathResult.path.map((n, i) => (
                      <li key={n.id}>
                        <button onClick={() => selectNode(n.id)}>
                          <span className={`legend-dot ${n.node_type}`} />
                          <code>{shortId(n.id, 8, 6)}</code>
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
                <p className="inspector-note">{pathResult.reason}</p>
              )}
            </div>
          </div>
        )}

        {/* Shortcuts */}
        {panel === 'keys' && (
          <div className="graph-panel graph-panel-left">
            <header>
              <Icon name="info" size={13} /> Shortcuts
              <button className="icon-btn" onClick={() => setPanel(null)}><Icon name="close" size={13} /></button>
            </header>
            <div className="graph-panel-body shortcut-list">
              {[
                ['/', 'Focus search'],
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
        )}

        {/* Legend + stats */}
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
          <div className="graph-stats">
            {shownNodes.toLocaleString()} nodes · {shownEdges.toLocaleString()} edges
            {stats.cluster_count ? ` · ${stats.cluster_count} clusters` : ''}
            {stats.truncated && (
              <span className="graph-stats-warn" title="Only the most connected part of the graph is drawn">
                {' '}· sample of {stats.graph_total_nodes?.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Zoom controls */}
        <div className="graph-zoom">
          <button onClick={() => control.current.zoomIn?.()} title="Zoom in (+)"><Icon name="plus" size={14} /></button>
          <button onClick={() => control.current.zoomOut?.()} title="Zoom out (−)"><Icon name="minus" size={14} /></button>
          <button onClick={() => control.current.fit?.()} title="Fit (F)"><Icon name="crosshair" size={14} /></button>
        </div>

        {toast && <div className="graph-toast">{toast}</div>}
      </div>

      {/* ── Inspector ───────────────────────────────────────────── */}
      {detail && (
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
        />
      )}
    </div>
  );
}
