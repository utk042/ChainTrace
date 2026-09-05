/**
 * A tiny command registry, so the menu bar can drive whichever page is
 * mounted without the shell importing every page.
 *
 * A menu whose items do nothing on the page you are looking at is worse than
 * no menu at all, so the registry is the source of truth for *enablement*:
 * a page registers the commands it can actually service, the menu bar
 * subscribes, and anything unregistered renders disabled rather than
 * silently swallowing the click.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

/** name -> handler. One handler per command; the mounted page owns it. */
const registry = new Map();
const listeners = new Set();

let snapshot = [];

function publish() {
  // A fresh array identity per change, so useSyncExternalStore sees it.
  snapshot = [...registry.keys()].sort();
  listeners.forEach((fn) => { try { fn(); } catch { /* listener's problem */ } });
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function registerCommands(handlers) {
  const names = Object.keys(handlers);
  names.forEach((name) => registry.set(name, handlers[name]));
  publish();
  return () => {
    // Only drop the handler still owned by this caller: a route transition
    // can mount the next page before the previous one unmounts.
    names.forEach((name) => {
      if (registry.get(name) === handlers[name]) registry.delete(name);
    });
    publish();
  };
}

export const hasCommand = (name) => registry.has(name);

export function runCommand(name, arg) {
  const handler = registry.get(name);
  if (!handler) return false;
  handler(arg);
  return true;
}

/**
 * Register a page's commands for as long as it is mounted.
 *
 * `handlers` is re-read on every render, so callers may pass a fresh object
 * literal. The registration effect only re-runs when the *set of names*
 * changes; the handlers it registers always dispatch through the latest
 * render's closures.
 */
export function useCommands(handlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  const names = Object.keys(handlers).sort().join('|');

  useEffect(() => {
    const stable = {};
    for (const name of names ? names.split('|') : []) {
      stable[name] = (arg) => latest.current[name]?.(arg);
    }
    return registerCommands(stable);
  }, [names]);
}

/** The set of currently registered command names, as reactive state. */
export function useAvailableCommands() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
