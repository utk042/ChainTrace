import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { SigmaContainer, useLoadGraph, useSigma, useRegisterEvents } from '@react-sigma/core';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import {
  EdgeArrowProgram, createEdgeArrowProgram, EdgeLineProgram, NodePointProgram,
} from 'sigma/rendering';
import Icon from '../Icon';
import { CANVAS, nodeColor } from '../../theme';
import { riskVar, fmtInt } from '../../services/format';
import { NodeTileProgram, NodeDiscProgram } from './nodeRenderer';
import { glyphFor } from './nodeGlyphs';
import { orient, isFlow, FLOW_COLORS, describeEdge, layerOf } from './edgeSemantics';

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
  // application. See nodeRenderer.js. The Shape control swaps the type on
  // every node; all three are registered up front because Sigma resolves a
  // node's program by name at render time.
  defaultNodeType: 'tile',
  // 'def' is registered too, to prevent Sigma unregistering it and
  // triggering an internal program corruption bug.
  nodeProgramClasses: {
    tile: NodeTileProgram,
    disc: NodeDiscProgram,
    dot: NodePointProgram,
    def: NodeTileProgram,
  },
  nodeHoverProgramClasses: {
    tile: NodeTileProgram,
    disc: NodeDiscProgram,
    dot: NodePointProgram,
    def: NodeTileProgram,
  },
  // Two edge programs: an arrow for a movement of value, a plain line for a
  // relationship that has no direction. See edgeSemantics.js — an arrowhead
  // on a co-input edge would claim a payment the heuristic never asserted.
  defaultEdgeType: 'line',
  edgeProgramClasses: {
    arrow: ArrowProgram,
    line: EdgeLineProgram,
    def: EdgeLineProgram,
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
  // Hovering a link is how you read a relationship you did not select.
  enableEdgeEvents: true,
  zIndex: true,
  minCameraRatio: 0.03,
  maxCameraRatio: 12,
  // sqrt rather than linear, so zooming in reveals structure instead of
  // inflating every node until it swallows its neighbours.
  zoomToSizeRatioFunction: (ratio) => Math.sqrt(ratio),
  itemSizesReference: 'positions',
  // Sigma hit-tests edges through a downsized picking buffer, so a sub-pixel
  // line is not merely hard to hover — it occupies no pixel in that buffer
  // and cannot be hovered at all. One pixel is the floor for an edge that is
  // meant to be interactive, and it reads better besides.
  minEdgeThickness: 1,
  autoRescale: true,
  // Sigma throws if constructed before its container has a measured width,
  // which happens when the canvas mounts ahead of layout. The ResizeObserver
  // below corrects the size a frame later.
  allowInvalidContainer: true,
};

// Above this many neighbours, let Sigma's density rules pick the labels
// instead of forcing all of them on.
const LABEL_ALL_BELOW = 14;

/**
 * Above this many edges the canvas stops drawing the inferred ones.
 *
 * The co-input heuristic connects every pair of wallets spent together, so a
 * transaction with 174 inputs contributes 15,051 edges on its own. A view of
 * a thousand nodes arrived carrying seventeen thousand links and rendered as
 * a solid mat: the tiles were legible, nothing between them was, and the
 * structure the graph exists to show was the thing hidden.
 *
 * Flows are never withheld — they are the evidence. Inferences are context,
 * and come back the moment there is room for them: when something is
 * selected, its own neighbourhood is drawn in full whatever the total.
 */
const EDGE_BUDGET = 4000;

const DIM_NODE = CANVAS.dimNode;
const DIM_EDGE = CANVAS.dimEdge;
const HIGHLIGHT_EDGE = CANVAS.highlight;
const PATH_EDGE = CANVAS.path;


/**
 * How one relationship is drawn.
 *
 * A flow gets its direction's colour and an arrowhead; an inference gets a
 * muted line and none. `amount` rides along so the edge tooltip can say how
 * much moved without another request.
 */
function edgeAttributes(edge) {
  const flow = isFlow(edge.edge_type);
  const base = toAlphaColor(FLOW_COLORS[edge.edge_type] || FLOW_COLORS.unknown, flow ? 0.55 : 0.3);
  return {
    color: base,
    baseColor: base,
    size: flow ? 1.4 : 0.9,
    edge_type: edge.edge_type,
    amount: edge.metadata?.amount ?? edge.amount ?? null,
    flow,
    type: flow ? 'arrow' : 'line',
  };
}

function GraphLoader({ graphData, onGraphLoaded, nodeShape }) {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();

  // Held in refs, not read from the closure.
  //
  // Rebuilding the graph tears down every node and edge and puts the camera
  // back to its default, which on screen is a hard flash of the whole canvas.
  // It must happen when the data changes and at no other time — but these two
  // props are recreated whenever the page re-renders, and the page re-renders
  // on every hover, every keystroke in the find box and every poll. With them
  // in the dependency array the canvas was reloading itself continuously
  // while data was coming in, which is what the flicker was.
  const onLoadedRef = useRef(onGraphLoaded);
  onLoadedRef.current = onGraphLoaded;
  const shapeRef = useRef(nodeShape);
  shapeRef.current = nodeShape;

  useEffect(() => {
    if (!graphData) return;
    if (!isSigmaAlive(sigma)) return;
    const nodeShapeNow = shapeRef.current;

    const graph = new Graph({ multi: false, type: 'directed' });

    (graphData.nodes || []).forEach((node) => {
      if (graph.hasNode(node.id)) return;
      graph.addNode(node.id, {
        type: nodeShapeNow || 'tile',
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

    const typeOf = (id) => (graph.hasNode(id) ? graph.getNodeAttribute(id, 'node_type') : null);

    (graphData.edges || []).forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
      // Re-derived from the node types, so an edge stored the wrong way round
      // — every edge in the bundled snapshot, which predates the backend
      // ordering them — still points the way the money moved.
      const { source, target } = orient(edge, typeOf);
      if (graph.hasEdge(edge.id) || graph.hasEdge(source, target)) return;
      graph.addEdgeWithKey(edge.id, source, target, edgeAttributes(edge));
    });

    try {
      loadGraph(graph);
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    } catch (err) {
      console.warn('loadGraph failed:', err);
    }
    onLoadedRef.current?.(graph);
    // Deliberately not keyed on nodeShape: reloading the graph to change a
    // shape would throw away the camera and any expansion on the canvas. A
    // shape change is applied in place by ShapeSwitcher below.
  }, [graphData, loadGraph, sigma]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Swaps every node's program in place, without reloading the graph. */
function ShapeSwitcher({ nodeShape }) {
  const sigma = useSigma();
  useEffect(() => {
    if (!isSigmaAlive(sigma)) return;
    const graph = sigma.getGraph();
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'type', nodeShape || 'tile');
    });
    try { sigma.refresh(); } catch { /* mid-teardown */ }
  }, [sigma, nodeShape]);
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
function Reducers({
  hovered, selected, filters, pathEdges, pathNodes, searchMatches,
  hoveredEdge, onDensityChange, graphData,
}) {
  const sigma = useSigma();
  // Reported out of the effect, never a reason to re-run it.
  const onDensityRef = useRef(onDensityChange);
  onDensityRef.current = onDensityChange;

  const focusNode = hovered || selected;

  const neighborSet = useMemo(() => {
    if (!focusNode || !isSigmaAlive(sigma)) return null;
    const graph = sigma.getGraph();
    if (!graph.hasNode(focusNode)) return null;
    return new Set([focusNode, ...graph.neighbors(focusNode)]);
    // Keyed on graphData, not on searchMatches: this reads the loaded graph's
    // adjacency, so it goes stale when a new graph is loaded and not when a
    // search finds different nodes in the one already on screen.
  }, [focusNode, sigma, graphData]);

  // The two nodes a hovered edge joins, so hovering a link reads the same way
  // hovering a node does.
  const edgeEnds = useMemo(() => {
    if (!hoveredEdge || !isSigmaAlive(sigma)) return null;
    const graph = sigma.getGraph();
    if (!graph.hasEdge(hoveredEdge)) return null;
    const [source, target] = graph.extremities(hoveredEdge);
    return { source, target, set: new Set([source, target]) };
  }, [hoveredEdge, sigma]);

  useEffect(() => {
    if (!isSigmaAlive(sigma)) return;

    const typeFilter = filters?.types;
    const layerFilter = filters?.layers;
    const minScore = filters?.minScore || 0;
    const hasPath = pathNodes && pathNodes.size > 0;

    const graph = sigma.getGraph();
    // Over budget, inferred links are held back until there is a reason to
    // draw them. Reported upward so the canvas can say so rather than let an
    // investigator read a thinned graph as the whole one.
    const overBudget = graph.size > EDGE_BUDGET;

    /** One rule, used to draw and to count, so the two cannot disagree. */
    const withhold = (edge, data, source, target) => {
      if (!overBudget || data.flow) return false;
      if (edge === hoveredEdge) return false;
      if (focusNode && (source === focusNode || target === focusNode)) return false;
      return true;
    };

    /** A link layer the operator has switched off in the filter panel. */
    const layerHidden = (data) => Boolean(layerFilter)
      && layerFilter[layerOf(data.edge_type)] === false;

    // Counted here in one pass, not tallied inside the reducer: Sigma runs
    // the reducer once per render layer, so a counter incremented in it
    // reported several times the number of edges that exist.
    let withheld = 0;
    if (overBudget) {
      graph.forEachEdge((edge, data, source, target) => {
        // A link the operator has already hidden is not being withheld from
        // them, and counting it as such would inflate the notice into
        // claiming the canvas is holding back their own filter.
        if (layerHidden(data)) return;
        if (withhold(edge, data, source, target)) withheld += 1;
      });
    }

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

      if (edgeEnds) {
        if (edgeEnds.set.has(node)) {
          res.size = data.baseSize * 1.45;
          res.zIndex = 3;
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
      const [source, target] = graph.extremities(edge);

      // Switched off in the filter panel.
      if (layerHidden(data)) {
        res.hidden = true;
        return res;
      }

      // An inferred link on a graph too dense to draw. Kept for a selection's
      // own neighbourhood and for a hovered edge, which is where the
      // relationship is actually being read.
      if (withhold(edge, data, source, target)) {
        res.hidden = true;
        return res;
      }

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

      if (edgeEnds) {
        if (edge === hoveredEdge) {
          res.color = HIGHLIGHT_EDGE;
          res.size = Math.max(1.6, (data.size || 0.6) * 2.6);
          res.zIndex = 3;
        } else {
          res.color = 'rgba(40, 48, 58, 0.12)';
          res.size = 0.3;
          res.zIndex = 0;
        }
        return res;
      }

      if (neighborSet) {
        if (source === focusNode || target === focusNode) {
          // Keep the direction's own colour, brightened: which way the value
          // went is the point of looking at a neighbourhood.
          res.color = toAlphaColor(FLOW_COLORS[data.edge_type] || FLOW_COLORS.unknown,
            data.flow ? 0.95 : 0.5);
          res.size = data.flow ? 1.1 : 0.6;
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

    onDensityRef.current?.(overBudget ? { withheld, total: graph.size } : null);
    // `graphData` is a dependency because the reducers read the loaded graph's
    // size to decide whether it is over budget. Without it the effect never
    // re-ran after the graph arrived, so the edge count it judged was the one
    // from before anything was loaded — always zero, and the notice never
    // appeared on the graphs that needed it.
  }, [
    sigma, hovered, selected, filters, pathEdges, pathNodes, searchMatches,
    neighborSet, focusNode, edgeEnds, hoveredEdge, graphData,
  ]);

  return null;
}

function NodeInteractions({
  onNodeClick, onNodeDoubleClick, onNodeHover, onStageClick, onTooltipChange,
  onEdgeHover, onNodeContextMenu,
}) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const draggedNodeRef = useRef(null);
  const isDraggingRef = useRef(false);
  // Which node the pointer is over, so the cursor can go back to 'pointer'
  // rather than 'grab' when a drag or a pan ends on top of one.
  const overNodeRef = useRef(false);
  const panningRef = useRef(false);

  useEffect(() => {
    if (!isSigmaAlive(sigma)) return;
    const container = sigma.getContainer();
    if (!container) return;

    /**
     * The canvas says what the mouse would do here.
     *
     *   grabbing  a drag is under way — a node is being moved, or the camera
     *             is being panned with the button held
     *   pointer   over a node, which is clickable
     *   grab      empty canvas, which can be dragged
     *
     * It only ever showed grab/grabbing around a node drag, so panning the
     * camera — the thing done most — left the cursor claiming the canvas was
     * merely draggable while it was being dragged.
     */
    const applyCursor = () => {
      if (draggedNodeRef.current || panningRef.current) container.style.cursor = 'grabbing';
      else if (overNodeRef.current) container.style.cursor = 'pointer';
      else container.style.cursor = 'grab';
    };

    const handleMouseDown = (e) => {
      // Left button on empty canvas: Sigma is about to pan the camera.
      if (e.button === 0 && !draggedNodeRef.current && !overNodeRef.current) {
        panningRef.current = true;
        applyCursor();
      }
    };

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
      panningRef.current = false;
      if (draggedNodeRef.current) {
        draggedNodeRef.current = null;
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 60);
      }
      applyCursor();
    };

    // Sigma raises rightClickNode itself; this only stops the browser's own
    // menu covering ours. Off a node the browser menu is left alone — an
    // application that takes right-click everywhere also takes away
    // "copy image" and "inspect".
    const handleContextMenu = (e) => {
      if (overNodeRef.current) e.preventDefault();
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    registerEvents({
      downNode: (e) => {
        // Left button only: a right-click must open the menu, not start a
        // drag that then swallows the click.
        if (e.event?.original && e.event.original.button !== 0) return;
        draggedNodeRef.current = e.node;
        isDraggingRef.current = false;
        applyCursor();
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
      rightClickNode: (e) => {
        e.preventSigmaDefault();
        const orig = e.event?.original;
        const rect = container.getBoundingClientRect();
        onNodeContextMenu?.({
          node: e.node,
          x: orig ? orig.clientX : e.event.x + rect.left,
          y: orig ? orig.clientY : e.event.y + rect.top,
        });
      },
      enterEdge: (e) => {
        const graph = sigma.getGraph();
        if (!graph.hasEdge(e.edge)) return;
        const [source, target] = graph.extremities(e.edge);
        const orig = e.event?.original;
        const rect = container.getBoundingClientRect();
        onEdgeHover?.({
          edge: e.edge,
          source,
          target,
          attrs: graph.getEdgeAttributes(e.edge),
          x: orig ? orig.clientX : e.event.x + rect.left,
          y: orig ? orig.clientY : e.event.y + rect.top,
        });
      },
      leaveEdge: () => onEdgeHover?.(null),
      enterNode: (e) => {
        overNodeRef.current = true;
        applyCursor();
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
        overNodeRef.current = false;
        applyCursor();
        onNodeHover?.(null);
        onTooltipChange?.(null);
      },
      clickStage: () => {
        onStageClick?.();
      },
    });

    applyCursor();

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    sigma, registerEvents, onNodeClick, onNodeDoubleClick, onNodeHover,
    onStageClick, onTooltipChange, onEdgeHover, onNodeContextMenu,
  ]);

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
            type: graph.order ? (graph.getNodeAttribute(graph.nodes()[0], 'type') || 'tile') : 'tile',
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

        const typeOf = (id) => (graph.hasNode(id) ? graph.getNodeAttribute(id, 'node_type') : null);
        (fragment.edges || []).forEach((edge) => {
          if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
          const { source, target } = orient(edge, typeOf);
          if (graph.hasEdge(source, target)) return;
          graph.addEdge(source, target, edgeAttributes(edge));
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
  nodeShape = 'tile',
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  onStageClick,
  onGraphLoaded,
  onLayoutRunning,
  onNodeContextMenu,
  onDensity,
}) {
  const emptyRef = useRef(new Set());
  const [tooltip, setTooltip] = useState(null);
  const [edgeHover, setEdgeHover] = useState(null);
  const [density, setDensity] = useState(null);
  // The notice has been read and put away. Reset when a different graph is
  // loaded, because the next one withholds a different number of links and
  // that is a fact about the new view, not the dismissed one.
  const [densityDismissed, setDensityDismissed] = useState(false);
  useEffect(() => { setDensityDismissed(false); }, [graphData]);

  const handleEdgeHover = useCallback((info) => setEdgeHover(info), []);
  const handleDensity = useCallback((info) => {
    setDensity((prev) => {
      if (!info && !prev) return prev;
      if (info && prev && info.withheld === prev.withheld && info.total === prev.total) return prev;
      onDensity?.(info);
      return info;
    });
  }, [onDensity]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <SigmaContainer className="graph-canvas" settings={SIGMA_SETTINGS}>
        <GraphLoader graphData={graphData} onGraphLoaded={onGraphLoaded} nodeShape={nodeShape} />
        <ShapeSwitcher nodeShape={nodeShape} />
        <ResizeHandler />
        <Controller controlRef={controlRef} onLayoutRunning={onLayoutRunning} />
        <NodeInteractions
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeHover={onNodeHover}
          onStageClick={onStageClick}
          onTooltipChange={setTooltip}
          onEdgeHover={handleEdgeHover}
          onNodeContextMenu={onNodeContextMenu}
        />
        <Reducers
          hovered={hovered}
          selected={selected}
          filters={filters}
          pathNodes={pathNodes || emptyRef.current}
          pathEdges={pathEdges || emptyRef.current}
          searchMatches={searchMatches || emptyRef.current}
          hoveredEdge={edgeHover?.edge || null}
          onDensityChange={handleDensity}
          graphData={graphData}
        />
      </SigmaContainer>

      {density && !densityDismissed && (
        <div className="graph-density-note" role="status">
          <span className="graph-density-dot" />
          <span className="graph-density-text">
            Showing {fmtInt(density.total - density.withheld)} of {fmtInt(density.total)} links.
            Co-input and IP relationships are held back at this density — select
            a node to see its own, or isolate a smaller neighbourhood. Payments
            are never hidden.
          </span>
          <button
            type="button"
            className="icon-btn graph-density-close"
            onClick={() => setDensityDismissed(true)}
            title="Dismiss — the drawn and held-back counts stay in the Summary panel"
            aria-label="Dismiss the density notice"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {edgeHover && (
        <div
          className="graph-tooltip"
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 280, edgeHover.x + 14),
            top: Math.min(window.innerHeight - 150, edgeHover.y + 14),
          }}
        >
          <div className="graph-tooltip-header">
            <span className="graph-tooltip-type">
              {edgeHover.attrs.flow ? 'payment' : 'inference'}
            </span>
          </div>
          <div className="graph-tooltip-details">
            <div className="graph-tooltip-row">
              <span>From</span>
              <span className="mono">{nodeLabel(edgeHover.source)}</span>
            </div>
            <div className="graph-tooltip-row">
              <span>To</span>
              <span className="mono">{nodeLabel(edgeHover.target)}</span>
            </div>
            {edgeHover.attrs.amount != null && (
              <div className="graph-tooltip-row">
                <span>Amount</span>
                <span className="mono">{Number(edgeHover.attrs.amount).toFixed(8)} BTC</span>
              </div>
            )}
          </div>
          <div className="graph-tooltip-hint">
            {describeEdge(edgeHover.attrs.edge_type)}
          </div>
        </div>
      )}

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
