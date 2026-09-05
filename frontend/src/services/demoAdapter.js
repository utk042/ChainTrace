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

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function paginate(rows, params, key) {
  const page = num(params.page, 1);
  const size = num(params.page_size, 20);
  const start = (page - 1) * size;
  return { [key]: rows.slice(start, start + size), total: rows.length, page, page_size: size };
}

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

/** Breadth-first shortest path over the snapshot's own edge list. */
function pathInSnapshot(snap, source, target) {
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
  const adjacency = snap._adjacency;
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

  const byId = new Map(snap.graph.nodes.map((n) => [n.id, n]));
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

  if (url === '/api/health') return ok({ ...snap.health, demo: true }, config);

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
    return ok(snap.node_details[id] || { found: false, id }, config);
  }

  if (url.startsWith('/api/graph/neighbors/')) {
    const id = tail('/api/graph/neighbors/');
    return ok(
      snap.neighbors[id] || { nodes: [], edges: [], truncated: false, total_neighbors: 0 },
      config,
    );
  }

  if (url.startsWith('/api/graph/subgraph/')) {
    // No server to re-cut a subgraph: return the whole graph and let the
    // caller centre on the requested node.
    return ok({ ...snap.graph, ready: true, focus: tail('/api/graph/subgraph/') }, config);
  }

  if (url === '/api/graph/search') {
    return ok(searchSnapshot(snap, params.q, num(params.limit, 20), params.node_type), config);
  }

  if (url === '/api/graph/path') {
    return ok(pathInSnapshot(snap, params.source, params.target), config);
  }

  if (url === '/api/graph/stats') return ok({ ...snap.graph.stats, ready: true }, config);
  if (url === '/api/graph/clusters') return ok([], config);

  if (url === '/api/alerts') {
    const rows = snap.alerts.alerts || [];
    const filtered = rows.filter((a) => {
      if (params.risk_tier && a.risk_tier !== params.risk_tier) return false;
      if (params.status && a.status !== params.status) return false;
      if (params.search && !a.entity_id?.toLowerCase().includes(String(params.search).toLowerCase())) return false;
      return true;
    });
    return ok(paginate(filtered, params, 'alerts'), config);
  }

  if (url === '/api/wallets') {
    const rows = snap.wallets.wallets || [];
    const filtered = rows.filter((w) => {
      if (params.risk_tier && w.risk_tier !== params.risk_tier) return false;
      if (params.search && !w.address?.toLowerCase().includes(String(params.search).toLowerCase())) return false;
      if (num(params.min_score) > 0 && num(w.anomaly_score) < num(params.min_score)) return false;
      return true;
    });
    return ok(paginate(filtered, params, 'wallets'), config);
  }

  if (url.startsWith('/api/wallets/')) {
    const address = tail('/api/wallets/');
    const row = (snap.wallets.wallets || []).find((w) => w.address === address);
    return row ? ok(row, config) : fail(config, 404, 'Wallet not in this snapshot.');
  }

  if (url === '/api/transactions') {
    const rows = snap.transactions.transactions || [];
    return ok(paginate(rows, params, 'transactions'), config);
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
