/**
 * Service-worker lifecycle and the offline state the UI reads.
 *
 * The worker itself lives in src/sw/service-worker.js and is emitted to
 * /sw.js at build time. This module is the only thing that talks to it: it
 * registers it, watches for a newer build, reports connectivity, and exposes
 * the cache controls Settings needs.
 *
 * Registration is skipped in dev (Vite serves modules unbundled, and a stale
 * cached shell is the classic way to lose an hour to a "fixed" bug) and on
 * file:// (the single-file standalone build has nothing to cache).
 */

const SW_URL = '/sw.js';

export const swSupported = () =>
  typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator
  && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

let registration = null;
const updateListeners = new Set();

/** Notify subscribers that a newer build is installed and waiting. */
const announceUpdate = () => updateListeners.forEach((fn) => { try { fn(); } catch { /* listener's problem */ } });

export function onUpdateAvailable(fn) {
  updateListeners.add(fn);
  return () => updateListeners.delete(fn);
}

export async function registerServiceWorker() {
  if (import.meta.env.DEV) {
    // Clear anything a previous production build left on this origin, or a
    // cached shell will shadow the dev server.
    if ('serviceWorker' in navigator) {
      const existing = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(existing.map((r) => r.unregister()));
    }
    return null;
  }
  if (!swSupported()) return null;

  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  } catch (e) {
    console.warn('Service worker registration failed; the app will not work offline.', e);
    return null;
  }

  // Already superseded when the page loaded.
  if (registration.waiting && navigator.serviceWorker.controller) announceUpdate();

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // A worker that reaches 'installed' with no controller is the first
      // install, not an update — there is nothing for the user to reload for.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) announceUpdate();
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  // Pick up a new deployment on return to the tab, not only on a cold start.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration?.update().catch(() => {});
  });

  return registration;
}

/** Activate the waiting build. The controllerchange handler reloads the page. */
export function applyUpdate() {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

/** Round-trip a message to the active worker over a MessageChannel. */
function ask(message, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) { reject(new Error('No active service worker.')); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('The service worker did not respond.')), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export const getCacheStatus = () => ask({ type: 'CACHE_STATUS' });
export const clearApiCache = () => ask({ type: 'CLEAR_API_CACHE' });
export const prefetchApi = (urls) => ask({ type: 'PREFETCH_API', urls }, 120000);

export const isControlled = () => Boolean(navigator.serviceWorker?.controller);
