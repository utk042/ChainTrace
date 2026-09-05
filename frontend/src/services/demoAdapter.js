/**
 * Offline demo mode.
 *
 * A snapshot of a real pipeline run (4,970 synthetic transactions, full
 * analysis) is bundled with the frontend and served through a custom axios
 * adapter, so every page renders genuine output with no backend at all.
 *
 * This exists because a static build with no reachable API is not a rare
 * misconfiguration — it is the normal state of a Vercel deployment whose
 * VITE_API_URL was never set, of a shared build link, and of a laptop opening
 * the dist/ folder on a plane. All of those previously showed empty pages.
 *
 * It is a snapshot, not a simulation: the numbers, scores, alerts and graph
 * structure are exactly what the pipeline produced, but nothing recomputes.
 * Ingestion, settings writes and re-runs are refused rather than faked, and
 * the UI labels the session as a snapshot throughout — a forensic tool must
 * never leave an operator unsure whether what they are reading is live.
 */

import { REQUIRED_API_REVISION } from './apiContract';
import {
  num, sortRows, paginate, filterAlerts, filterWallets, filterTransactions,
} from './localQuery';

const DEMO_KEY = 'CT_DEMO_MODE';

export const isDemoMode = () => {
  try {
    if (localStorage.getItem(DEMO_KEY) === '1') return true;
  } catch { /* storage unavailable (private mode) — fall through */ }
  return import.meta.env.VITE_DEMO_MODE === 'true';
};

export const setDemoMode = (on) => {
  try {
    if (on) localStorage.setItem(DEMO_KEY, '1');
    else localStorage.removeItem(DEMO_KEY);
  } catch { /* ignore */ }
};

let snapshotPromise = null;
const loadSnapshot = () => {
  // Dynamic import keeps the ~1.6 MB snapshot out of the main bundle.
  if (!snapshotPromise) snapshotPromise = import('../demo/snapshot.json').then((m) => m.default);
  return snapshotPromise;
};

/** Pre-warm the snapshot so the first page doesn't wait on the import. */
export const preloadSnapshot = () => (isDemoMode() ? loadSnapshot() : Promise.resolve(null));

const ok = (data, config) => ({
  data, status: 200, statusText: 'OK',
  headers: { 'x-chaintrace-demo': '1' },
  config, request: {},
});

const fail = (config, status, message) => {
  const error = new Error(message);
  error.response = { data: { error: message }, status, statusText: 'Demo mode', headers: {}, config };
  error.config = config;
  return Promise.reject(error);
};

function searchSnapshot(snap, q, limit, nodeType) {
  const needle = String(q || '').toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const node of snap.graph.nodes) {
    if (nodeType && node.node_type !== nodeType) continue;
    const id = node.id.toLowerCase();
    if (!id.includes(needle)) continue;
    const rank = id === needle ? 0 : id.startsWith(needle) ? 1 : 2;
    scored.push({
      rank,
      row: {
        id: node.id,
        node_type: node.node_type,
        risk_tier: node.risk_tier,
        anomaly_score: node.anomaly_score,
        degree: node.metadata?.degree,
      },
    });
  }
  scored.sort((a, b) => a.rank - b.rank
    || (b.row.anomaly_score || 0) - (a.row.anomaly_score || 0)
    || (b.row.degree || 0) - (a.row.degree || 0));
  return scored.slice(0, limit).map((s) => s.row);
}

/**
 * Undirected adjacency over the snapshot's edge list, built once.
 *
 * The backend answers expansion, isolation and path queries by walking its
 * own graph. Every one of those needs the same index here, so it is built on
 * first use and kept on the snapshot object.
 */
function adjacencyOf(snap) {
  if (!snap._adjacency) {
    const adjacency = new Map();
    for (const e of snap.graph.edges) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, []);
      if (!adjacency.has(e.target)) adjacency.set(e.target, []);
      adjacency.get(e.source).push([e.target, e.edge_type]);
      adjacency.get(e.target).push([e.source, e.edge_type]);
    }
    snap._adjacency = adjacency;
  }
  return snap._adjacency;
}

/** Nodes by id, built once. */
function nodesById(snap) {
  if (!snap._nodesById) {
    snap._nodesById = new Map(snap.graph.nodes.map((n) => [n.id, n]));
  }
  return snap._nodesById;
}

const degreeOf = (snap, id) => (adjacencyOf(snap).get(id) || []).length;

/** The nodes+edges fragment shape the canvas merges, cut from the snapshot. */
function fragmentOf(snap, ids) {
  const byId = nodesById(snap);
  const keep = new Set([...ids].filter((id) => byId.has(id)));
  const nodes = [...keep].map((id) => {
    const n = byId.get(id);
    return {
      ...n,
      metadata: { ...(n.metadata || {}), degree: n.metadata?.degree ?? degreeOf(snap, id) },
    };
  });
  const edges = snap.graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}

/**
 * One hop out from a node, as /api/graph/neighbors returns it.
 *
 * The snapshot ships a precomputed answer for sixty entities. The other six
 * hundred-odd nodes on the canvas fell through to an empty fragment, and the
 * Graph Explorer reported that as "all neighbours are already on the canvas"
 * — the expand button doing nothing, with a message saying it had worked.
 * Everything needed to answer properly is in the edge list.
 */
function neighborsInSnapshot(snap, id, limit) {
  const precomputed = snap.neighbors?.[id];
  if (precomputed) return precomputed;

  const adjacency = adjacencyOf(snap);
  if (!adjacency.has(id)) {
    return { nodes: [], edges: [], truncated: false, total_neighbors: 0 };
  }
  const unique = [...new Set(adjacency.get(id).map(([other]) => other))];
  const total = unique.length;
  // Highest-degree neighbours first, as the router orders them: those are
  // the ones that connect onward.
  unique.sort((a, b) => degreeOf(snap, b) - degreeOf(snap, a));
  const kept = unique.slice(0, limit);
  return {
    ...fragmentOf(snap, [id, ...kept]),
    truncated: total > kept.length,
    total_neighbors: total,
  };
}

/** The n-hop ego network around an entity, as /api/graph/subgraph returns it. */
function subgraphInSnapshot(snap, id, hops, maxNodes) {
  const adjacency = adjacencyOf(snap);
  if (!adjacency.has(id)) return null;

  const seen = new Set([id]);
  let frontier = [id];
  for (let depth = 0; depth < hops && seen.size < maxNodes; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const [other] of adjacency.get(current) || []) {
        if (seen.has(other)) continue;
        seen.add(other);
        next.push(other);
        if (seen.size >= maxNodes) break;
      }
      if (seen.size >= maxNodes) break;
    }
    frontier = next;
    if (!frontier.length) break;
  }
  const fragment = fragmentOf(snap, seen);
  return {
    ...fragment,
    clusters: snap.graph.clusters,
    stats: {
      total_nodes: fragment.nodes.length,
      total_edges: fragment.edges.length,
      cluster_count: new Set(fragment.nodes.map((n) => n.cluster_id).filter((c) => c != null)).size,
    },
    ready: true,
    focus: id,
  };
}

/** The empty graph payload the router returns, with its reason. */
const emptyGraph = (reason) => ({
  nodes: [], edges: [], clusters: {},
  stats: { total_nodes: 0, total_edges: 0, cluster_count: 0 },
  ready: false,
  reason,
});

/** /api/graph/clusters, summarised from the snapshot's own cluster map. */
function clustersInSnapshot(snap) {
  const byId = nodesById(snap);
  const summaries = Object.entries(snap.graph.clusters || {}).map(([clusterId, wallets]) => {
    let totalSent = 0;
    let totalReceived = 0;
    let txCount = 0;
    for (const address of wallets) {
      const attrs = snap.node_details?.[address]?.attributes || byId.get(address)?.metadata || {};
      totalSent += num(attrs.total_sent);
      totalReceived += num(attrs.total_received);
      txCount += num(attrs.tx_count);
    }
    return {
      cluster_id: Number(clusterId),
      wallet_count: wallets.length,
      total_sent: Number(totalSent.toFixed(8)),
      total_received: Number(totalReceived.toFixed(8)),
      tx_count: txCount,
      wallets: wallets.slice(0, 10),
    };
  });
  return summaries.sort((a, b) => b.tx_count - a.tx_count || b.wallet_count - a.wallet_count);
}

/** Breadth-first shortest path over the snapshot's own edge list. */
function pathInSnapshot(snap, source, target) {
  const adjacency = adjacencyOf(snap);
  if (!adjacency.has(source)) return { found: false, reason: `'${source}' is not in the snapshot.` };
  if (!adjacency.has(target)) return { found: false, reason: `'${target}' is not in the snapshot.` };
  if (source === target) return { found: false, reason: 'Source and target are the same entity.' };

  const prev = new Map([[source, null]]);
  const queue = [source];
  while (queue.length) {
    const current = queue.shift();
    if (current === target) break;
    for (const [next, edgeType] of adjacency.get(current) || []) {
      if (prev.has(next)) continue;
      prev.set(next, [current, edgeType]);
      queue.push(next);
    }
  }
  if (!prev.has(target)) {
    return { found: false, reason: 'No connecting path exists within the snapshot.' };
  }

  const ids = [];
  const hops = [];
  for (let at = target; at !== null;) {
    ids.unshift(at);
    const step = prev.get(at);
    if (!step) break;
    hops.unshift({ source: step[0], target: at, edge_type: step[1], amount: null });
    at = step[0];
  }

  const byId = nodesById(snap);
  return {
    found: true,
    length: ids.length - 1,
    path: ids.map((id) => {
      const n = byId.get(id) || {};
      return { id, node_type: n.node_type, risk_tier: n.risk_tier, anomaly_score: n.anomaly_score };
    }),
    hops,
  };
}

const WRITE_REFUSED =
  'This is an offline snapshot with no backend attached, so it cannot run the '
  + 'pipeline or change stored settings. Point the app at a running backend in '
  + 'Settings to do that.';

export async function demoAdapter(config) {
  const snap = await loadSnapshot();
  const url = (config.url || '').split('?')[0];
  const params = config.params || {};
  const method = (config.method || 'get').toLowerCase();

  if (method !== 'get') {
    return fail(config, 503, WRITE_REFUSED);
  }

  // /api/graph/node/<id> and friends carry the id in the path.
  const tail = (prefix) => decodeURIComponent(url.slice(prefix.length));

  if (url === '/api/health') {
    // The snapshot predates the revision field, and in snapshot mode this
    // build is the backend — so it is current by construction. Without this
    // the app would report itself as running against an out-of-date server.
    return ok({
      ...snap.health, status: 'healthy',
      api_revision: REQUIRED_API_REVISION, demo: true,
    }, config);
  }

  if (url === '/api/dashboard/stats') return ok(snap.dashboard.stats, config);
  if (url === '/api/dashboard/timeline') return ok(snap.dashboard.timeline, config);
  if (url === '/api/dashboard/risk-distribution') return ok(snap.dashboard.risk_distribution, config);
  if (url === '/api/dashboard/top-alerts') return ok(snap.dashboard.top_alerts, config);

  if (url === '/api/graph/data') {
    let { nodes, edges } = snap.graph;
    if (params.node_type) {
      const keep = new Set(nodes.filter((n) => n.node_type === params.node_type).map((n) => n.id));
      for (const e of edges) {
        if (keep.has(e.source)) keep.add(e.target);
        if (keep.has(e.target)) keep.add(e.source);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    }
    const max = num(params.max_nodes, 1500);
    if (nodes.length > max) {
      const keep = new Set(nodes.slice(0, max).map((n) => n.id));
      nodes = nodes.filter((n) => keep.has(n.id));
      edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    }
    return ok({ ...snap.graph, nodes, edges, ready: true }, config);
  }

  if (url.startsWith('/api/graph/node/')) {
    const id = tail('/api/graph/node/');
    // A bare `found: false` left the inspector showing UNKNOWN with no
    // explanation, which reads as a bug rather than as the limit of a
    // sample. The inspector renders `detail`, so say what happened.
    return ok(snap.node_details[id] || {
      found: false,
      id,
      reason: 'not_in_snapshot',
      detail: `'${id}' is not in this snapshot. It carries a 700-node sample `
        + 'of one pipeline run, not the whole entity graph — connect to a '
        + 'backend to look this entity up.',
    }, config);
  }

  if (url.startsWith('/api/graph/neighbors/')) {
    const id = tail('/api/graph/neighbors/');
    return ok(neighborsInSnapshot(snap, id, num(params.limit, 60)), config);
  }

  if (url.startsWith('/api/graph/subgraph/')) {
    // A real ego network, walked over the snapshot's edges. Returning the
    // whole graph here was what made "Isolate" and "Open in graph" report
    // success while changing nothing on the canvas.
    const id = tail('/api/graph/subgraph/');
    const sub = subgraphInSnapshot(snap, id, num(params.hops, 2), num(params.max_nodes, 600));
    return ok(sub || emptyGraph(
      `'${id}' is not in the snapshot's sampled graph, so it has no `
      + 'neighbourhood to isolate here. Connect to a backend to trace it.',
    ), config);
  }

  if (url === '/api/graph/search') {
    return ok(searchSnapshot(snap, params.q, num(params.limit, 20), params.node_type), config);
  }

  if (url === '/api/graph/path') {
    return ok(pathInSnapshot(snap, params.source, params.target), config);
  }

  if (url === '/api/graph/stats') return ok({ ...snap.graph.stats, ready: true }, config);
  // The snapshot carries its cluster map; answering [] here reported "the
  // backend has not computed any wallet clusters" over 135 of them.
  if (url === '/api/graph/clusters') return ok(clustersInSnapshot(snap), config);

  if (url === '/api/alerts') {
    const filtered = filterAlerts(snap.alerts.alerts || [], params);
    return ok(paginate(sortRows(filtered, params, 'confidence'), params, 'alerts'), config);
  }

  if (url === '/api/alerts/export') {
    // No server to stream a CSV; the page builds one from the rows it can
    // load instead, and says that is what it did.
    return fail(config, 404, 'Snapshot mode has no server-side export endpoint.');
  }

  if (url.startsWith('/api/alerts/')) {
    const alertId = tail('/api/alerts/');
    const row = (snap.alerts.alerts || []).find((a) => a.alert_id === alertId);
    return row ? ok(row, config) : fail(config, 404, 'Alert not in this snapshot.');
  }

  if (url === '/api/wallets') {
    const filtered = filterWallets(snap.wallets.wallets || [], params);
    return ok(paginate(sortRows(filtered, params, 'anomaly_score'), params, 'wallets'), config);
  }

  if (url.startsWith('/api/wallets/')) {
    const address = tail('/api/wallets/');
    const row = (snap.wallets.wallets || []).find((w) => w.address === address);
    return row ? ok(row, config) : fail(config, 404, 'Wallet not in this snapshot.');
  }

  if (url === '/api/transactions') {
    const filtered = filterTransactions(snap.transactions.transactions || [], params);
    return ok(paginate(sortRows(filtered, params, 'timestamp'), params, 'transactions'), config);
  }

  if (url.startsWith('/api/transactions/')) {
    const txid = tail('/api/transactions/');
    const row = (snap.transactions.transactions || []).find((t) => t.txid === txid);
    return row ? ok(row, config) : fail(config, 404, 'Transaction not in this snapshot.');
  }

  if (url === '/api/settings') return ok(snap.settings, config);
  if (url === '/api/settings/seed-wallets') return ok(snap.seed_wallets, config);

  if (url === '/api/ingest/status') {
    return ok({
      status: 'completed', progress: 100, stage: null, stages: [],
      message: 'Snapshot loaded (no live pipeline).',
    }, config);
  }

  if (url === '/api/ingest/logs' || url === '/api/logs') {
    // A snapshot has no server behind it, so there is no log to tail. Say so
    // rather than 404-ing the panel into an error the operator has to decode.
    return ok({
      run_id: null,
      status: 'completed',
      records: [{
        ts: snap.generated_from || null,
        level: 'INFO',
        logger: 'snapshot',
        message: 'Snapshot mode: no backend is attached, so there is no server log to show.',
      }],
      log_file: null,
    }, config);
  }

  return fail(config, 404, `No snapshot data for ${url}.`);
}
