import { useEffect, useRef, useMemo, useCallback } from 'react';
import { SigmaContainer, useLoadGraph, useSigma, useRegisterEvents } from '@react-sigma/core';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

/**
 * The Sigma canvas and everything that has to talk to the Sigma instance
 * directly: graph loading, camera control, hover/selection dimming, resize.
 *
 * Deliberately split out from the page so that none of these ever unmount the
 * SigmaContainer. Unmounting it destroys the WebGL context and the camera
 * along with it, which is what made "Reset View" leave the canvas blank or
 * parked at the old zoom — the page swapped the container for a spinner while
 * fetching, then mounted a fresh Sigma whose camera knew nothing about the
 * graph it was now showing. Loading state is an overlay here, never a branch
 * that removes the canvas.
 */

const SIGMA_SETTINGS = {
  defaultNodeColor: '#5FD4D0',
  defaultEdgeColor: '#242932',
  labelColor: { color: '#C6CCD5' },
  labelFont: "'IBM Plex Mono', ui-monospace, monospace",
  labelSize: 10,
  labelWeight: '500',
  labelDensity: 0.25,
  // Only label nodes that are big enough on screen to be worth reading.
  // Without this every address in a 1,500-node graph tries to draw its label
  // at once and the canvas turns into unreadable text soup.
  labelRenderedSizeThreshold: 7,
  renderEdgeLabels: false,
  enableEdgeEvents: false,
  zIndex: true,
  minCameraRatio: 0.03,
  maxCameraRatio: 12,
  // Node radius grows with the square root of zoom rather than linearly, so
  // zooming in reveals structure instead of inflating every node into a
  // circle that swallows its neighbours.
  zoomToSizeRatioFunction: (ratio) => Math.sqrt(ratio),
  itemSizesReference: 'positions',
  autoRescale: true,
  // Sigma throws if it is constructed before its container has a measured
  // width — which happens whenever the canvas mounts ahead of layout: a
  // Suspense boundary resolving, a route entered while the tab is hidden, a
  // grid settling after fonts load. The ResizeObserver below gives it the
  // right size a frame later, so this only needs to not be fatal.
  allowInvalidContainer: true,
  // Sigma's stock hover renderer paints a light chip behind the label, which
  // on this palette comes out as white text on a white box. Draw the hover
  // label with the same dark treatment as everything else.
  defaultDrawNodeHover: (context, data, settings) => {
    const size = settings.labelSize;
    const font = settings.labelFont;
    const weight = settings.labelWeight;
    if (!data.label) return;

    context.font = `${weight} ${size}px ${font}`;
    const width = context.measureText(data.label).width + 10;
    const x = Math.round(data.x + data.size + 4);
    const y = Math.round(data.y - size / 2 - 3);

    context.fillStyle = 'rgba(18, 21, 26, 0.94)';
    context.strokeStyle = '#3D4552';
    context.lineWidth = 1;
    context.beginPath();
    context.rect(x, y, width, size + 8);
    context.fill();
    context.stroke();

    context.fillStyle = '#EEF0F2';
    context.fillText(data.label, x + 5, y + size + 1);
  },
};

// Above this many neighbours, stop forcing every label on at once.
const LABEL_ALL_BELOW = 14;

const DIM_NODE = '#20242c';
const DIM_EDGE = '#171a20';
const HIGHLIGHT_EDGE = '#5FD4D0';
const PATH_EDGE = '#F0883E';

function GraphLoader({ graphData, onGraphLoaded }) {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();

  useEffect(() => {
    if (!graphData) return;

    const graph = new Graph({ multi: false, type: 'undirected' });

    (graphData.nodes || []).forEach((node) => {
      if (graph.hasNode(node.id)) return;
      graph.addNode(node.id, {
        x: typeof node.x === 'number' ? node.x : Math.random() * 1000 - 500,
        y: typeof node.y === 'number' ? node.y : Math.random() * 1000 - 500,
        size: node.size || 4,
        baseSize: node.size || 4,
        label: node.label || node.id,
        color: node.color || '#5FD4D0',
        baseColor: node.color || '#5FD4D0',
        node_type: node.node_type,
        risk_tier: node.risk_tier,
        anomaly_score: node.anomaly_score,
        cluster_id: node.cluster_id,
        degree: node.metadata?.degree,
      });
    });

    (graphData.edges || []).forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
      if (graph.hasEdge(edge.source, edge.target)) return;
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color: edge.color || DIM_EDGE,
        baseColor: edge.color || DIM_EDGE,
        // Edge widths sit under 1px at rest: at this node count the edges are
        // context, and anything thicker reads as a solid mat of colour.
        size: Math.min(1.6, 0.4 + (edge.weight || 1) * 0.15),
        edge_type: edge.edge_type,
      });
    });

    loadGraph(graph);
    // The camera keeps whatever position it had from the previous graph, which
    // for a new dataset is meaningless — reset it so a fresh load always opens
    // framed on the data.
    sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    onGraphLoaded?.(graph);
  }, [graphData, loadGraph, sigma, onGraphLoaded]);

  return null;
}

/** Keeps Sigma's canvas in step with its container's real pixel size. */
function ResizeHandler() {
  const sigma = useSigma();

  useEffect(() => {
    const container = sigma.getContainer();
    if (!container || typeof ResizeObserver === 'undefined') return;

    // Sigma only re-reads its dimensions on window resize, so it misses every
    // layout change that doesn't resize the window: the sidebar collapsing,
    // the inspector panel opening, a phone rotating, a flex parent settling
    // after fonts load. The canvas then keeps its stale size and the graph
    // renders squashed or clipped. Observing the container itself covers all
    // of them.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        sigma.resize();
        sigma.refresh();
      });
    });

    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [sigma]);

  return null;
}

/**
 * Hover / selection emphasis, filtering and path highlighting, all expressed
 * as reducers so they are pure presentation — no mutation of the underlying
 * graph, and instant to toggle.
 */
function Reducers({ hovered, selected, filters, pathEdges, pathNodes, searchMatches }) {
  const sigma = useSigma();

  const focusNode = hovered || selected;

  const neighborSet = useMemo(() => {
    if (!focusNode) return null;
    const graph = sigma.getGraph();
    if (!graph.hasNode(focusNode)) return null;
    return new Set([focusNode, ...graph.neighbors(focusNode)]);
  }, [focusNode, sigma, searchMatches]);

  useEffect(() => {
    const typeFilter = filters?.types;
    const minScore = filters?.minScore || 0;
    const hasPath = pathNodes && pathNodes.size > 0;

    sigma.setSetting('nodeReducer', (node, data) => {
      const res = { ...data };

      if (typeFilter && !typeFilter[data.node_type]) {
        res.hidden = true;
        return res;
      }
      if (minScore > 0 && (data.anomaly_score || 0) < minScore) {
        res.hidden = true;
        return res;
      }

      if (hasPath) {
        if (pathNodes.has(node)) {
          res.color = PATH_EDGE;
          res.size = data.baseSize * 1.4;
          res.zIndex = 2;
          res.forceLabel = true;
        } else {
          res.color = DIM_NODE;
          res.label = '';
          res.zIndex = 0;
        }
        return res;
      }

      if (searchMatches && searchMatches.size > 0 && searchMatches.has(node)) {
        res.color = HIGHLIGHT_EDGE;
        res.size = data.baseSize * 1.5;
        res.zIndex = 2;
        res.forceLabel = true;
        return res;
      }

      if (neighborSet) {
        if (node === selected || node === hovered) {
          res.size = data.baseSize * 1.35;
          res.zIndex = 3;
          res.forceLabel = true;
        } else if (neighborSet.has(node)) {
          res.zIndex = 2;
          // Labels are forced only when the neighbourhood is small enough to
          // read. A 60-edge hub would otherwise stack 60 addresses on top of
          // each other in a few hundred pixels — worse than no labels at all.
          // Above the cap, Sigma's own density rules pick a legible subset and
          // zooming in reveals the rest.
          res.forceLabel = neighborSet.size <= LABEL_ALL_BELOW;
        } else {
          // Dim rather than hide: the shape of the surrounding graph is still
          // useful context, it just shouldn't compete with the neighbourhood
          // being examined.
          res.color = DIM_NODE;
          res.label = '';
          res.zIndex = 0;
        }
      }

      return res;
    });

    sigma.setSetting('edgeReducer', (edge, data) => {
      const res = { ...data };
      const graph = sigma.getGraph();
      const [source, target] = graph.extremities(edge);

      if (typeFilter) {
        const sType = graph.getNodeAttribute(source, 'node_type');
        const tType = graph.getNodeAttribute(target, 'node_type');
        if (!typeFilter[sType] || !typeFilter[tType]) {
          res.hidden = true;
          return res;
        }
      }

      if (hasPath) {
        if (pathEdges.has(`${source}\u0000${target}`)) {
          res.color = PATH_EDGE;
          res.size = 2.5;
          res.zIndex = 2;
        } else {
          res.color = DIM_EDGE;
          res.zIndex = 0;
        }
        return res;
      }

      if (neighborSet) {
        if (source === focusNode || target === focusNode) {
          res.color = HIGHLIGHT_EDGE;
          res.size = Math.max(1.2, data.size);
          res.zIndex = 1;
        } else {
          res.color = DIM_EDGE;
          res.zIndex = 0;
        }
      }

      return res;
    });

    sigma.refresh();
  }, [sigma, hovered, selected, filters, pathEdges, pathNodes, searchMatches, neighborSet, focusNode]);

  return null;
}

function Events({ onNodeClick, onNodeHover, onStageClick }) {
  const registerEvents = useRegisterEvents();

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onNodeClick?.(node),
      enterNode: ({ node }) => onNodeHover?.(node),
      leaveNode: () => onNodeHover?.(null),
      clickStage: () => onStageClick?.(),
    });
  }, [registerEvents, onNodeClick, onNodeHover, onStageClick]);

  return null;
}

/**
 * Exposes imperative camera / layout operations to the page through a ref,
 * so the toolbar can drive the canvas without the page holding the Sigma
 * instance itself.
 */
function Controller({ controlRef, onLayoutRunning }) {
  const sigma = useSigma();

  const focusOn = useCallback((nodeId, ratio = 0.28) => {
    const graph = sigma.getGraph();
    if (!graph.hasNode(nodeId)) return false;
    // Node coordinates have to be read through the renderer, not the graph:
    // Sigma rescales the layout into its own display space, so the raw x/y
    // from the layout would send the camera somewhere off-canvas.
    const pos = sigma.getNodeDisplayData(nodeId);
    if (!pos) return false;
    sigma.getCamera().animate(
      { x: pos.x, y: pos.y, ratio },
      { duration: 480, easing: 'quadraticInOut' },
    );
    return true;
  }, [sigma]);

  useEffect(() => {
    controlRef.current = {
      focusOn,
      fit: () => sigma.getCamera().animate(
        { x: 0.5, y: 0.5, ratio: 1, angle: 0 },
        { duration: 420, easing: 'quadraticInOut' },
      ),
      zoomIn: () => sigma.getCamera().animatedZoom({ duration: 200 }),
      zoomOut: () => sigma.getCamera().animatedUnzoom({ duration: 200 }),
      snapshot: () => {
        // Sigma renders across stacked canvases (edges, nodes, labels), so a
        // usable export has to composite them onto one surface in order.
        const canvases = sigma.getCanvases();
        const order = ['edges', 'nodes', 'edgeLabels', 'labels', 'hovers'];
        const first = canvases.nodes;
        if (!first) return null;
        const out = document.createElement('canvas');
        out.width = first.width;
        out.height = first.height;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#07080a';
        ctx.fillRect(0, 0, out.width, out.height);
        order.forEach((layer) => {
          if (canvases[layer]) ctx.drawImage(canvases[layer], 0, 0);
        });
        return out.toDataURL('image/png');
      },
      relayout: () => {
        const graph = sigma.getGraph();
        if (graph.order === 0) return;
        onLayoutRunning?.(true);
        // Run ForceAtlas2 synchronously in a bounded number of iterations.
        // The server's spring layout is a reasonable first frame; this lets an
        // investigator untangle a specific view without a round-trip.
        const settings = forceAtlas2.inferSettings(graph);
        forceAtlas2.assign(graph, {
          iterations: Math.max(50, Math.min(300, Math.round(12000 / Math.max(1, graph.order)))),
          settings: { ...settings, adjustSizes: true, gravity: 0.6, scalingRatio: 12 },
        });
        sigma.refresh();
        sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 400 });
        onLayoutRunning?.(false);
      },
      addFragment: (fragment, anchorId) => {
        const graph = sigma.getGraph();
        const anchor = graph.hasNode(anchorId) ? graph.getNodeAttributes(anchorId) : null;
        let added = 0;

        (fragment.nodes || []).forEach((node, i) => {
          if (graph.hasNode(node.id)) return;
          // Place new nodes on a ring around the node they came from, so an
          // expansion reads as growth out of that node rather than a scatter.
          const angle = (i / Math.max(1, fragment.nodes.length)) * Math.PI * 2;
          const radius = 60 + Math.random() * 40;
          graph.addNode(node.id, {
            x: (anchor?.x || 0) + Math.cos(angle) * radius,
            y: (anchor?.y || 0) + Math.sin(angle) * radius,
            size: node.size || 4,
            baseSize: node.size || 4,
            label: node.label || node.id,
            color: node.color || '#5FD4D0',
            baseColor: node.color || '#5FD4D0',
            node_type: node.node_type,
            risk_tier: node.risk_tier,
            anomaly_score: node.anomaly_score,
            cluster_id: node.cluster_id,
            degree: node.metadata?.degree,
          });
          added += 1;
        });

        (fragment.edges || []).forEach((edge) => {
          if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
          if (graph.hasEdge(edge.source, edge.target)) return;
          graph.addEdge(edge.source, edge.target, {
            color: DIM_EDGE,
            baseColor: DIM_EDGE,
            size: 0.6,
            edge_type: edge.edge_type,
          });
        });

        sigma.refresh();
        return added;
      },
      getStats: () => {
        const graph = sigma.getGraph();
        return { nodes: graph.order, edges: graph.size };
      },
      hasNode: (id) => sigma.getGraph().hasNode(id),
    };
  }, [sigma, focusOn, controlRef, onLayoutRunning]);

  return null;
}

export default function GraphCanvas({
  graphData,
  controlRef,
  hovered,
  selected,
  filters,
  pathNodes,
  pathEdges,
  searchMatches,
  onNodeClick,
  onNodeHover,
  onStageClick,
  onGraphLoaded,
  onLayoutRunning,
}) {
  const emptyRef = useRef(new Set());

  return (
    <SigmaContainer className="graph-canvas" settings={SIGMA_SETTINGS}>
      <GraphLoader graphData={graphData} onGraphLoaded={onGraphLoaded} />
      <ResizeHandler />
      <Controller controlRef={controlRef} onLayoutRunning={onLayoutRunning} />
      <Events
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onStageClick={onStageClick}
      />
      <Reducers
        hovered={hovered}
        selected={selected}
        filters={filters}
        pathNodes={pathNodes || emptyRef.current}
        pathEdges={pathEdges || emptyRef.current}
        searchMatches={searchMatches || emptyRef.current}
      />
    </SigmaContainer>
  );
}
