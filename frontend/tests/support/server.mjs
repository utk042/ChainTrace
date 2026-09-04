/**
 * Static host for a built frontend, with an SPA fallback.
 *
 * `/api` is either proxied to a real backend (pass --backend) or answered
 * from the bundled pipeline snapshot, so the offline test can run with
 * nothing but the repo checked out.
 *
 * This mirrors the nginx deployment closely enough to matter: sw.js is
 * served no-cache, because a cached worker is exactly the failure the
 * headers in nginx.conf and vercel.json exist to prevent.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const paginate = (rows, key, params) => {
  const page = Number(params.get('page') || 1);
  const size = Number(params.get('page_size') || 20);
  return {
    [key]: rows.slice((page - 1) * size, (page - 1) * size + size),
    total: rows.length,
    page,
    page_size: size,
  };
};

/** The subset of the API the offline test exercises, from the snapshot. */
function fromSnapshot(snapshot, pathname, params) {
  switch (pathname) {
    case '/api/health': return { ...snapshot.health, status: 'healthy' };
    case '/api/dashboard/stats': return snapshot.dashboard.stats;
    case '/api/dashboard/timeline': return snapshot.dashboard.timeline;
    case '/api/dashboard/risk-distribution': return snapshot.dashboard.risk_distribution;
    case '/api/dashboard/top-alerts': return snapshot.dashboard.top_alerts;
    case '/api/graph/data': return { ...snapshot.graph, ready: true };
    case '/api/graph/stats': return { ...snapshot.graph.stats, ready: true };
    case '/api/graph/clusters': return [];
    case '/api/graph/search': return [];
    case '/api/alerts': return paginate(snapshot.alerts.alerts || [], 'alerts', params);
    case '/api/wallets': return paginate(snapshot.wallets.wallets || [], 'wallets', params);
    case '/api/transactions': return paginate(snapshot.transactions.transactions || [], 'transactions', params);
    case '/api/settings': return snapshot.settings;
    case '/api/settings/seed-wallets': return snapshot.seed_wallets;
    case '/api/ingest/status': return { status: 'completed', progress: 100, message: 'Snapshot (no live pipeline).' };
    default: return null;
  }
}

export function createServer({ dist, snapshotPath, backend = null }) {
  const snapshot = backend ? null : JSON.parse(readFileSync(snapshotPath, 'utf8'));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      if (backend) {
        try {
          const upstream = await fetch(backend + req.url, {
            method: req.method,
            headers: { accept: 'application/json' },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
            duplex: 'half',
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(body);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream unreachable', detail: String(e) }));
        }
        return;
      }
      const body = fromSnapshot(snapshot, url.pathname, url.searchParams);
      if (body === null) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"detail":"not implemented by the test server"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
      return;
    }

    let file = join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' };
    if (file.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
}
