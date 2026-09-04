/**
 * ChainTrace offline-first service worker.
 *
 * Built by the `chaintraceServiceWorker` plugin in vite.config.js, which
 * fills in the build id and precache manifest for the bundle it just
 * produced. Do not load this file directly — it is a template.
 *
 * Three caches, three lifetimes:
 *
 *   shell  — the app itself (HTML, JS, CSS, fonts, icons), keyed by build.
 *            Cache-first, because a hashed asset never changes and the whole
 *            point is that a cold start with no network still renders.
 *   assets — lazily-loaded route chunks picked up on first use, same build key.
 *   api    — GET responses from the backend, kept ACROSS builds and stamped
 *            with the time they were fetched. Network-first: live data wins
 *            whenever the backend answers, and the stamp lets the UI say
 *            exactly how old the fallback is rather than passing stale
 *            forensic data off as current.
 *
 * A snapshot of an investigation must never be mistaken for the live state,
 * so every cache hit carries `x-chaintrace-cache: hit` and
 * `x-chaintrace-cached-at`, and the UI surfaces both.
 */

const BUILD_ID = '__BUILD_ID__';
const PRECACHE_URLS = __PRECACHE__;

const SHELL_CACHE = `ct-shell-${BUILD_ID}`;
const ASSET_CACHE = `ct-assets-${BUILD_ID}`;
const API_CACHE = 'ct-api-v1';

/** The document served for every client-side route. */
const SHELL_URL = new URL('index.html', self.registration.scope).pathname;

/** Cap on stored API responses; oldest insertions are evicted first. */
const API_CACHE_LIMIT = 160;

/** How long to wait on the network before falling back to cache, in ms. */
const NETWORK_TIMEOUT = 6000;

const CACHE_HEADER = 'x-chaintrace-cache';
const CACHED_AT_HEADER = 'x-chaintrace-cached-at';

// ─── Install ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, not addAll: one 404 on an optional asset would otherwise
    // reject the whole install and leave the app with no offline shell.
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch { /* asset unavailable at install time; runtime will retry */ }
    }));
  })());
});

// ─── Activate ───────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE, API_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.map((n) => (keep.has(n) || !n.startsWith('ct-') ? null : caches.delete(n))));
    // Navigation preload would race our cache-first shell for no gain.
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable();
    }
    await self.clients.claim();
  })());
});

// ─── Helpers ────────────────────────────────────────────────────────

/** Copy a response, adding the cache-provenance headers. */
async function stamp(response, when) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, when);
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** Mark a response on its way out of the cache so the UI can label it. */
function markAsHit(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHE_HEADER, 'hit');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

const isApiRequest = (url) => url.pathname === '/api' || url.pathname.startsWith('/api/');

const isPrecachedAsset = (url) =>
  url.origin === self.location.origin
  && (url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/fonts/')
    || url.pathname.startsWith('/icons/')
    || url.pathname.endsWith('.webmanifest'));

/** Network with a deadline, so a hung connection still falls back to cache. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ─── Strategies ─────────────────────────────────────────────────────

/**
 * The app shell. Cache-first and deliberately so: an investigator opening
 * the app on a disconnected machine gets the interface immediately, and a
 * newer build is picked up by the update flow rather than by blocking the
 * first paint on a network round trip.
 */
async function handleNavigation(event) {
  const shell = await caches.open(SHELL_CACHE);
  // Both names are precached; fall back to the scope root if a host serves
  // the document without an index.html path of its own.
  const cached = await shell.match(SHELL_URL) || await shell.match(self.registration.scope);
  if (cached) {
    // Refresh the shell in the background for the *next* load.
    event.waitUntil((async () => {
      try {
        const fresh = await fetch(SHELL_URL, { cache: 'reload' });
        if (fresh.ok) (await caches.open(SHELL_CACHE)).put(SHELL_URL, fresh);
      } catch { /* offline: keep what we have */ }
    })());
    return cached;
  }
  try {
    return await fetch(event.request);
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>ChainTrace — offline</title>'
      + '<body style="background:#000;color:#e8e8f0;font:14px system-ui;padding:40px">'
      + '<h1 style="font-size:18px">ChainTrace is not cached yet</h1>'
      + '<p style="color:#8a8a99;max-width:46em">This browser has never loaded the app while online, so there is '
      + 'nothing stored to open. Connect once and the whole interface — including the bundled snapshot — '
      + 'stays available offline afterwards.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/** Hashed build output: immutable, so a cache hit is always correct. */
async function handleAsset(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    (await caches.open(ASSET_CACHE)).put(request, response.clone());
  }
  return response;
}

/**
 * Backend reads. Live data wins; the cache is the fallback, never the
 * default, and what it returns is labelled with its age.
 */
async function handleApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetchWithTimeout(request.clone(), NETWORK_TIMEOUT);
    if (response.ok) {
      const stamped = await stamp(response.clone(), new Date().toISOString());
      await cache.put(request, stamped);
      trimCache(API_CACHE, API_CACHE_LIMIT);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return markAsHit(cached);
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (isApiRequest(url)) {
    event.respondWith(handleApi(request));
    return;
  }
  if (isPrecachedAsset(url)) {
    event.respondWith(handleAsset(request));
  }
});

// ─── Client messaging ───────────────────────────────────────────────

async function cacheStatus() {
  const names = (await caches.keys()).filter((n) => n.startsWith('ct-'));
  let shellEntries = 0;
  let apiEntries = 0;
  let newestApi = null;
  for (const name of names) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    if (name === API_CACHE) {
      apiEntries = keys.length;
      for (const key of keys) {
        const res = await cache.match(key);
        const at = res?.headers.get(CACHED_AT_HEADER);
        if (at && (!newestApi || at > newestApi)) newestApi = at;
      }
    } else {
      shellEntries += keys.length;
    }
  }
  let usage = null;
  if (navigator.storage?.estimate) {
    try { usage = (await navigator.storage.estimate()).usage ?? null; } catch { /* unsupported */ }
  }
  return { buildId: BUILD_ID, shellEntries, apiEntries, newestApi, usage };
}

/** Warm the API cache so a named set of reads survives going offline. */
async function prefetch(urls) {
  const cache = await caches.open(API_CACHE);
  let stored = 0;
  const failed = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) { failed.push(url); continue; }
      await cache.put(url, await stamp(response, new Date().toISOString()));
      stored += 1;
    } catch { failed.push(url); }
  }
  await trimCache(API_CACHE, API_CACHE_LIMIT);
  return { stored, failed };
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (payload) => event.ports?.[0]?.postMessage(payload);

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'CACHE_STATUS') {
    event.waitUntil(cacheStatus().then(reply, (e) => reply({ error: String(e) })));
    return;
  }
  if (data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE).then(() => reply({ cleared: true }), (e) => reply({ error: String(e) })));
    return;
  }
  if (data.type === 'PREFETCH_API') {
    event.waitUntil(prefetch(data.urls || []).then(reply, (e) => reply({ error: String(e) })));
  }
});
