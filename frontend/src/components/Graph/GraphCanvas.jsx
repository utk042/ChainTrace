import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { SigmaContainer, useLoadGraph, useSigma, useRegisterEvents } from '@react-sigma/core';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { EdgeArrowProgram, createEdgeArrowProgram } from 'sigma/rendering';
import { CANVAS, nodeColor, edgeColor } from '../../theme';
import { riskVar } from '../../services/format';
import { NodeTileProgram } from './nodeRenderer';
import { glyphFor } from './nodeGlyphs';

/**
 * Slender, sharp directional arrow program.
 * Compact proportions ensure converging arrows never fuse into a solid clump
 * or obscure node labels underneath.
 */
const ArrowProgram = createEdgeArrowProgram({
  lengthToThicknessRatio: 1.6,
  widenessToThicknessRatio: 1.15,
});

/** Converts hex or rgba colors to a semi-transparent rgba string. */
function toAlphaColor(color, alpha = 0.4) {
  if (!color) return `rgba(95, 107, 124, ${alpha})`;
  if (color.startsWith('rgba')) {
    return color.replace(/[\d.]+\)$/, `${alpha})`);
  }
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const num = parseInt(hex, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
  return color;
}

/**
 * Tiles have to stay big enough for their pictogram to read. Degree still
 * drives the size — a hub should still look like one — but over a range that
 * cannot shrink a node into an unidentifiable speck.
 */
const tileSize = (raw) => Math.max(6, Math.min(13, raw || 6));

/**
 * Addresses are 34-62 characters. Printed in full under every node they
 * overlap into an unreadable mat, which is most of what made the old canvas
 * look like noise. Gotham labels are short names; this is the nearest
 * equivalent for an identifier.
 */
function nodeLabel(value) {
  if (!value) return '';
  const text = String(value);
  return text.length <= 18 ? text : `${text.slice(0, 8)}…${text.slice(-6)}`;
}

/**
 * The Sigma canvas and everything that talks to the Sigma instance directly:
 * graph loading, camera control, hover/selection dimming, resize.
 *
 * Split out from the page so nothing here ever unmounts the SigmaContainer —
 * that destroys the WebGL context and the camera with it. Loading state must
 * stay an overlay, never a branch that removes the canvas.
 */

/**
 * Checks whether a Sigma instance is fully alive with mounted WebGL contexts
 * and registered programs. Prevents calling refresh/resize on unmounted or
 * killed instances during React StrictMode or HMR transitions.
 */
function isSigmaAlive(sigma) {
  try {
    return Boolean(
      sigma &&
      sigma.getContainer?.() &&
      sigma.webGLContexts?.nodes &&
      sigma.webGLContexts?.edges &&
      sigma.nodePrograms &&
      (sigma.nodePrograms.tile || sigma.nodePrograms.def)
    );
  } catch {
    return false;
  }
}

const SIGMA_SETTINGS = {
  // Square pictogram tiles with the label underneath, as in the Gotham graph
  // application. See nodeRenderer.js.
  defaultNodeType: 'tile',
  // Register both 'tile' and 'def' to prevent Sigma from unregistering 'def'
  // and triggering an internal program corruption bug.
  nodeProgramClasses: {
    tile: NodeTileProgram,
    def: NodeTileProgram,
  },
  nodeHoverProgramClasses: {
    tile: NodeTileProgram,
    def: NodeTileProgram,
  },
  defaultEdgeType: 'arrow',
  edgeProgramClasses: {
    arrow: ArrowProgram,
    def: ArrowProgram,
  },
  defaultNodeColor: CANVAS.highlight,
  defaultEdgeColor: CANVAS.edge,
  labelColor: { color: CANVAS.label },
  labelFont: "'IBM Plex Mono', ui-monospace, monospace",
  labelSize: 11,
  labelWeight: '500',
  // Sparser than the default: labels now sit under their node rather than
  // beside it, so two neighbours competing for the same strip of canvas
  // collide head-on instead of merely crowding.
  labelDensity: 0.16,
  // Label only nodes large enough on screen to read; otherwise a
  // 1,500-node graph draws every address at once.
  labelRenderedSizeThreshold: 9,
  renderEdgeLabels: false,
  enableEdgeEvents: false,
  zIndex: true,
  minCameraRatio: 0.03,
  maxCameraRatio: 12,
  // sqrt rather than linear, so zooming in reveals structure instead of
  // inflating every node until it swallows its neighbours.
  zoomToSizeRatioFunction: (ratio) => Math.sqrt(ratio),
  itemSizesReference: 'positions',
  minEdgeThickness: 0.35,
  autoRescale: true,
  // Sigma throws if constructed before its container has a measured width,
  // which happens when the canvas mounts ahead of layout. The ResizeObserver
  // below corrects the size a frame later.
  allowInvalidContainer: true,
};

// Above this many neighbours, let Sigma's density rules pick the labels
// instead of forcing all of them on.
const LABEL_ALL_BELOW = 14;

const DIM_NODE = CANVAS.dimNode;
const DIM_EDGE = CANVAS.dimEdge;
const HIGHLIGHT_EDGE = CANVAS.highlight;
const PATH_EDGE = CANVAS.path;

function GraphLoader({ graphData, onGraphLoaded }) {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();

  useEffect(() => {
    if (!graphData) return;
    if (!isSigmaAlive(sigma)) return;

    const graph = new Graph({ multi: false, type: 'directed' });

    (graphData.nodes || []).forEach((node) => {
      if (graph.hasNode(node.id)) return;
      graph.addNode(node.id, {
        type: 'tile',
        x: typeof node.x === 'number' ? node.x : Math.random() * 1000 - 500,
        y: typeof node.y === 'number' ? node.y : Math.random() * 1000 - 500,
        size: tileSize(node.size),
        baseSize: tileSize(node.size),
        label: nodeLabel(node.label || node.id),
        image: glyphFor(node.node_type),
        color: nodeColor(node.node_type, node.risk_tier),
        baseColor: nodeColor(node.node_type, node.risk_tier),
        node_type: node.node_type,
        risk_tier: node.risk_tier,
        anomaly_score: node.anomaly_score,
        cluster_id: node.cluster_id,
        degree: node.metadata?.degree,
      });
    });

    (graphData.edges || []).forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
      if (graph.hasEdge(edge.id) || graph.hasEdge(edge.source, edge.target)) return;
      const edgeCol = toAlphaColor(edgeColor(edge.edge_type), 0.38);
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color: edgeCol,
        baseColor: edgeCol,
        size: 0.45,
        edge_type: edge.edge_type,
        type: 'arrow',
      });
    });

    try {
      loadGraph(graph);
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    } catch (err) {
      console.warn('loadGraph failed:', err);
    }
    onGraphLoaded?.(graph);
  }, [graphData, loadGraph, sigma, onGraphLoaded]);

  return null;
}

/** Keeps Sigma's canvas in step with its container's real pixel size. */
function ResizeHandler() {
  const sigma = useSigma();

  useEffect(() => {
    const container = sigma?.getContainer?.();
    if (!container || typeof ResizeObserver === 'undefined') return;

    // Sigma only re-reads its dimensions on window resize, so it misses
    // layout changes that don't resize the window (the inspector opening, a
    // flex parent settling) and keeps a stale canvas size. Observing the
    // container covers those.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!isSigmaAlive(sigma)) return;
        try {
          sigma.resize();
          sigma.refresh();
        } catch (err) {
          console.warn('sigma resize/refresh skipped:', err);
        }
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
 * Hover/selection emphasis, filtering and path highlighting as reducers:
 * pure presentation, no mutation of the underlying graph.
 */
function Reducers({ hovered, selected, filters, pathEdges, pathNodes, searchMatches }) {
  const sigma = useSigma();

  const focusNode = hovered || selected;

  const neighborSet = useMemo(() => {
    if (!focusNode || !isSigmaAlive(sigma)) return null;
    const graph = sigma.getGraph();
    if (!graph.hasNode(focusNode)) return null;
    return new Set([focusNode, ...graph.neighbors(focusNode)]);
  }, [focusNode, sigma, searchMatches]);

  useEffect(() => {
    if (!isSigmaAlive(sigma)) return;

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
          // Only force labels on a neighbourhood small enough to read; a
          // 60-edge hub would stack 60 addresses in a few hundred pixels.
          res.forceLabel = neighborSet.size <= LABEL_ALL_BELOW;
        } else {
          // Dimmed, not hidden: the surrounding shape is still context.
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

      if (minScore > 0) {
        const sScore = graph.getNodeAttribute(source, 'anomaly_score') || 0;
        const tScore = graph.getNodeAttribute(target, 'anomaly_score') || 0;
        if (sScore < minScore || tScore < minScore) {
          res.hidden = true;
          return res;
        }
      }

      if (hasPath) {
        if (pathEdges.has(`${source}\u0000${target}`)) {
          res.color = PATH_EDGE;
          res.size = 0.95;
          res.type = 'arrow';
          res.zIndex = 2;
        } else {
          res.color = 'rgba(40, 48, 58, 0.12)';
          res.size = 0.3;
          res.zIndex = 0;
        }
        return res;
      }

      if (neighborSet) {
        if (source === focusNode || target === focusNode) {
          res.color = 'rgba(76, 144, 240, 0.72)';
          res.size = 0.75;
          res.type = 'arrow';
          res.zIndex = 1;
        } else {
          res.color = 'rgba(40, 48, 58, 0.12)';
          res.size = 0.3;
          res.zIndex = 0;
        }
      }

      return res;
    });

    if (isSigmaAlive(sigma)) {
      try {
        sigma.refresh();
      } catch (err) {
        console.warn('sigma.refresh skipped in Reducers:', err);
      }
    }
  }, [sigma, hovered, selected, filters, pathEdges, pathNodes, searchMatches, neighborSet, focusNode]);

  return null;
}

function NodeInteractions({ onNodeClick, onNodeDoubleClick, onNodeHover, onStageClick, onTooltipChange }) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const draggedNodeRef = useRef(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!isSigmaAlive(sigma)) return;
    const container = sigma.getContainer();
    if (!container) return;

    const handleMouseMove = (e) => {
      if (!draggedNodeRef.current) return;
      isDraggingRef.current = true;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const graphPos = sigma.viewportToGraph({ x: mouseX, y: mouseY });
      const graph = sigma.getGraph();
      if (graph.hasNode(draggedNodeRef.current)) {
        graph.setNodeAttribute(draggedNodeRef.current, 'x', graphPos.x);
        graph.setNodeAttribute(draggedNodeRef.current, 'y', graphPos.y);
      }
    };

    const handleMouseUp = () => {
      if (draggedNodeRef.current) {
        draggedNodeRef.current = null;
        container.style.cursor = 'grab';
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 60);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    registerEvents({
      downNode: (e) => {
        draggedNodeRef.current = e.node;
        isDraggingRef.current = false;
        container.style.cursor = 'grabbing';
        e.preventSigmaDefault();
      },
      clickNode: (e) => {
        if (!isDraggingRef.current) {
          onNodeClick?.(e.node);
        }
      },
      doubleClickNode: (e) => {
        e.preventSigmaDefault();
        onNodeDoubleClick?.(e.node);
      },
      enterNode: (e) => {
        if (!draggedNodeRef.current) {
          container.style.cursor = 'pointer';
        }
        onNodeHover?.(e.node);
        const graph = sigma.getGraph();
        if (graph.hasNode(e.node)) {
          const attrs = graph.getNodeAttributes(e.node);
          const rect = container.getBoundingClientRect();
          const orig = e.event.original;
          const clientX = orig ? orig.clientX : (e.event.x + rect.left);
          const clientY = orig ? orig.clientY : (e.event.y + rect.top);
          onTooltipChange?.({
            id: e.node,
            attrs,
            x: clientX,
            y: clientY,
          });
        }
      },
      leaveNode: () => {
        if (!draggedNodeRef.current) {
          container.style.cursor = 'grab';
        }
        onNodeHover?.(null);
        onTooltipChange?.(null);
      },
      clickStage: () => {
        onStageClick?.();
      },
    });

    container.style.cursor = 'grab';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sigma, registerEvents, onNodeClick, onNodeDoubleClick, onNodeHover, onStageClick, onTooltipChange]);

  return null;
}

/** Exposes camera and layout operations to the page through a ref. */
function Controller({ controlRef, onLayoutRunning }) {
  const sigma = useSigma();

  const focusOn = useCallback((nodeId, customRatio) => {
    if (!isSigmaAlive(sigma)) return false;
    const graph = sigma.getGraph();
    if (!graph.hasNode(nodeId)) return false;

    // Ensure container dimensions are up to date if tab was just unhidden
    const container = sigma.getContainer();
    if (container && (container.offsetWidth > 0 || container.offsetHeight > 0)) {
      const dims = sigma.getDimensions();
      if (dims.width === 0 || dims.height === 0) {
        try {
          sigma.resize();
          sigma.refresh();
        } catch {}
      }
    }

    // Read through the renderer, not the graph: Sigma rescales the layout
    // into its own display space, so raw x/y would aim off-canvas.
    let pos = sigma.getNodeDisplayData(nodeId);
    if (!pos) {
      try {
        sigma.refresh();
        pos = sigma.getNodeDisplayData(nodeId);
      } catch {}
    }
    if (!pos) return false;

    const currentRatio = sigma.getCamera().getState().ratio;
    // Deep zoom into the selected node (0.075) so that the entity, its pictogram,
    // and its immediate connections are prominent and comfortable to inspect.
    // If already zoomed in closer (< 0.09), preserve the current zoom level.
    const ratio = typeof customRatio === 'number'
      ? customRatio
      : (currentRatio < 0.09 ? currentRatio : 0.075);

    sigma.getCamera().animate(
      { x: pos.x, y: pos.y, ratio },
      { duration: 420, easing: 'quadraticInOut' },
    );
    return true;
  }, [sigma]);

  useEffect(() => {
    controlRef.current = {
      focusOn,
      fit: () => {
        if (!isSigmaAlive(sigma)) return;
        sigma.getCamera().animate(
          { x: 0.5, y: 0.5, ratio: 1, angle: 0 },
          { duration: 420, easing: 'quadraticInOut' },
        );
      },
      zoomIn: () => {
        if (isSigmaAlive(sigma)) sigma.getCamera().animatedZoom({ duration: 200 });
      },
      zoomOut: () => {
        if (isSigmaAlive(sigma)) sigma.getCamera().animatedUnzoom({ duration: 200 });
      },
      snapshot: () => {
        if (!isSigmaAlive(sigma)) return null;
        // Sigma renders across stacked canvases; composite them in order.
        const canvases = sigma.getCanvases();
        const order = ['edges', 'nodes', 'edgeLabels', 'labels', 'hovers'];
        const first = canvases.nodes;
        if (!first) return null;
        const out = document.createElement('canvas');
        out.width = first.width;
        out.height = first.height;
        const ctx = out.getContext('2d');
        ctx.fillStyle = CANVAS.background;
        ctx.fillRect(0, 0, out.width, out.height);
        order.forEach((layer) => {
          if (canvases[layer]) ctx.drawImage(canvases[layer], 0, 0);
        });
        return out.toDataURL('image/png');
      },
      relayout: () => {
        if (!isSigmaAlive(sigma)) return;
        const graph = sigma.getGraph();
        if (graph.order === 0) return;
        onLayoutRunning?.(true);
        // Bounded synchronous run: untangles the current view without a
        // round-trip to the server's layout.
        const settings = forceAtlas2.inferSettings(graph);
        forceAtlas2.assign(graph, {
          iterations: Math.max(50, Math.min(300, Math.round(12000 / Math.max(1, graph.order)))),
          settings: { ...settings, adjustSizes: true, gravity: 0.6, scalingRatio: 12 },
        });
        if (isSigmaAlive(sigma)) {
          try {
            sigma.refresh();
            sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 400 });
          } catch {}
        }
        onLayoutRunning?.(false);
      },
      addFragment: (fragment, anchorId) => {
        if (!isSigmaAlive(sigma)) return 0;
        const graph = sigma.getGraph();
        const anchor = graph.hasNode(anchorId) ? graph.getNodeAttributes(anchorId) : null;
        let added = 0;

        (fragment.nodes || []).forEach((node, i) => {
          if (graph.hasNode(node.id)) return;
          // Ring placement around the parent, so the expansion reads as
          // growth out of that node.
          const angle = (i / Math.max(1, fragment.nodes.length)) * Math.PI * 2;
          const radius = 60 + Math.random() * 40;
          graph.addNode(node.id, {
            type: 'tile',
            x: (anchor?.x || 0) + Math.cos(angle) * radius,
            y: (anchor?.y || 0) + Math.sin(angle) * radius,
            size: tileSize(node.size),
            baseSize: tileSize(node.size),
            label: nodeLabel(node.label || node.id),
            image: glyphFor(node.node_type),
            color: nodeColor(node.node_type, node.risk_tier),
            baseColor: nodeColor(node.node_type, node.risk_tier),
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
          const edgeCol = toAlphaColor(edgeColor(edge.edge_type), 0.38);
          graph.addEdge(edge.source, edge.target, {
            color: edgeCol,
            baseColor: edgeCol,
            size: 0.45,
            edge_type: edge.edge_type,
            type: 'arrow',
          });
        });

        if (isSigmaAlive(sigma)) {
          try {
            sigma.refresh();
          } catch {}
        }
        return added;
      },
      getStats: () => {
        if (!isSigmaAlive(sigma)) return { nodes: 0, edges: 0 };
        const graph = sigma.getGraph();
        return { nodes: graph.order, edges: graph.size };
      },
      hasNode: (id) => isSigmaAlive(sigma) && sigma.getGraph().hasNode(id),
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
  onNodeDoubleClick,
  onNodeHover,
  onStageClick,
  onGraphLoaded,
  onLayoutRunning,
}) {
  const emptyRef = useRef(new Set());
  const [tooltip, setTooltip] = useState(null);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <SigmaContainer className="graph-canvas" settings={SIGMA_SETTINGS}>
        <GraphLoader graphData={graphData} onGraphLoaded={onGraphLoaded} />
        <ResizeHandler />
        <Controller controlRef={controlRef} onLayoutRunning={onLayoutRunning} />
        <NodeInteractions
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeHover={onNodeHover}
          onStageClick={onStageClick}
          onTooltipChange={setTooltip}
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

      {tooltip && (
        <div
          className="graph-tooltip"
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 270, tooltip.x + 14),
            top: Math.min(window.innerHeight - 170, tooltip.y + 14),
          }}
        >
          <div className="graph-tooltip-header">
            <span className={`graph-tooltip-type ${tooltip.attrs.node_type || ''}`}>
              {tooltip.attrs.node_type || 'entity'}
            </span>
            {tooltip.attrs.risk_tier && (
              <span
                className="graph-tooltip-badge"
                style={{ background: riskVar(tooltip.attrs.risk_tier) }}
              >
                {tooltip.attrs.risk_tier}
              </span>
            )}
          </div>
          <div className="graph-tooltip-id mono">{tooltip.id}</div>
          <div className="graph-tooltip-details">
            {tooltip.attrs.anomaly_score != null && (
              <div className="graph-tooltip-row">
                <span>Anomaly score</span>
                <span className="mono">{Number(tooltip.attrs.anomaly_score).toFixed(1)}</span>
              </div>
            )}
            {tooltip.attrs.degree != null && (
              <div className="graph-tooltip-row">
                <span>Connections</span>
                <span className="mono">{tooltip.attrs.degree}</span>
              </div>
            )}
          </div>
          <div className="graph-tooltip-hint">
            Click to select · Double-click to expand · Drag to move
          </div>
        </div>
      )}
    </div>
  );
}
