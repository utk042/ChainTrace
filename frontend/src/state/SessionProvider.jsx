import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getDashboardStats, getPipelineStatus, getProvenance, subscribeProvenance,
  isDemoMode,
} from '../services/api';
import { useBackendStatus } from '../hooks/useBackendStatus';
import { VIEWS, viewForPath } from './views';

const VIEW_BY_KEY = new Map(VIEWS.map((v) => [v.key, v]));

// How often the pipeline is polled. Fast while a run is on, because the stage
// tracker and the gate over the data views are both read off it; slow
// otherwise, only to notice a run someone started from another window.
const INGEST_POLL_ACTIVE_MS = 1500;
const INGEST_POLL_IDLE_MS = 8000;

// How long a launch may stay "sent but not yet a run" before the app stops
// believing in it. Longer than the slowest launch request's own timeout
// (fetch-real's five minutes), so it only ever fires for a request that went
// away without settling at all — and then the app opens back up rather than
// sitting behind a gate for a run that will never start.
const LAUNCH_GRACE_MS = 6 * 60 * 1000;

let tabCounter = 1;

function makeTab(view, count = 1) {
  const id = `tab-${view.key}-${tabCounter++}`;
  const label = count > 1 ? `${view.label} (${count})` : view.label;
  return {
    id,
    key: view.key,
    label,
    path: view.path,
    icon: view.icon,
  };
}

/**
 * The state the workstation chrome needs, held once.
 */
const SessionContext = createContext(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

export function SessionProvider({ children }) {
  const backend = useBackendStatus();
  const location = useLocation();
  const navigate = useNavigate();

  const demo = isDemoMode();
  const status = demo ? 'demo' : backend.status;

  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Read by refreshStats rather than closed over, so the callback stays
  // stable while still refusing to read a table that is mid-rewrite.
  const ingestingRef = useRef(false);

  const refreshStats = useCallback(async () => {
    // A run has truncated the tables and is refilling them; counting rows now
    // returns a number that describes neither the old dataset nor the new one.
    if (ingestingRef.current) return;
    setStatsLoading(true);
    try {
      const res = await getDashboardStats();
      setStats(res.data);
      setStatsError(null);
    } catch (e) {
      setStats(null);
      setStatsError(e.response
        ? `The backend returned ${e.response.status} for /api/dashboard/stats.`
        : 'The dashboard counters could not be fetched.');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (backend.status === 'checking') return;
    refreshStats();
  }, [backend.status, refreshStats]);

  const [provenance, setProvenance] = useState(getProvenance);
  useEffect(() => subscribeProvenance(setProvenance), []);

  // ─── The pipeline, polled once for the whole window ────────────
  //
  // This used to live inside the Ingest page, which meant nothing else in the
  // app knew a run was on: the Overview, Wallets, Transactions, Alerts and
  // Graph tabs went on reading and drawing tables that the run had already
  // truncated, so an investigator could be looking at a wallet list belonging
  // to a dataset that no longer existed. Held here, every view can be held
  // back until the run finishes.
  const [ingest, setIngest] = useState(null);
  // A launch that has been sent but that the backend has not started reporting
  // yet. "Fetch live blockchain data" spends a minute pulling blocks before it
  // calls /run at all, and for that whole minute /api/ingest/status still
  // describes the *previous* run. Without this flag the poll would overwrite
  // the optimistic state with that stale record and swing the gate open over a
  // dataset that is about to be cleared.
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  // Whether the pipeline has been asked about even once.
  //
  // Until it has, a run may or may not be on, and a data view mounted on that
  // guess loads and paints a dataset the run has already truncated — a flash
  // of the old case, on every page load made during a run. Unknown is treated
  // as "wait", not as "no run".
  const [ingestKnown, setIngestKnown] = useState(demo);

  const ingesting = launching || ingest?.status === 'running';

  // Declared before the effects below so they see the current value: effects
  // run in declaration order, and the one that re-reads the counters after a
  // run must not be turned away by a flag still saying the run is on.
  useEffect(() => { ingestingRef.current = ingesting; }, [ingesting]);

  const applyIngest = useCallback((data) => {
    if (!data?.status) return;
    const settled = data.status === 'running' || data.status === 'error';
    // The backend has picked the launch up (or refused it): its record is
    // authoritative again.
    if (settled && launchingRef.current) {
      launchingRef.current = false;
      setLaunching(false);
    }
    setIngest((prev) => (launchingRef.current && !settled ? prev : data));
  }, []);

  const refreshIngest = useCallback(async () => {
    try {
      const res = await getPipelineStatus();
      applyIngest(res.data);
      return res.data;
    } catch {
      // A failed poll says nothing about the run. Keeping the last known
      // state is what stops the gate flickering open on one dropped request
      // and briefly showing the half-written dataset underneath.
      return null;
    }
  }, [applyIngest]);

  // Called by the Ingest page the moment it sends a launch, so the other tabs
  // close over their data on that click rather than up to a poll later.
  const noteIngestStarted = useCallback((seed) => {
    launchingRef.current = true;
    setLaunching(true);
    setIngest((prev) => ({ ...(prev || {}), ...(seed || {}), status: 'running' }));
  }, []);

  // The launch never reached a run — the request was refused, or the fetch it
  // depended on failed. The gate has to open again, or the app is locked out
  // of its own data until it is reloaded.
  const noteIngestFailed = useCallback((message) => {
    launchingRef.current = false;
    setLaunching(false);
    setIngest((prev) => ({
      ...(prev || {}), status: 'error', progress: 0, message, stages: prev?.stages || [],
    }));
  }, []);

  useEffect(() => {
    if (!launching) return undefined;
    const timer = setTimeout(() => {
      launchingRef.current = false;
      setLaunching(false);
    }, LAUNCH_GRACE_MS);
    return () => clearTimeout(timer);
  }, [launching]);

  useEffect(() => {
    // A snapshot has no pipeline behind it; polling one would only ask the
    // adapter the same question forever.
    if (demo) return undefined;
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      const data = await refreshIngest();
      if (cancelled) return;
      // Settled either way: a backend that cannot be reached is not a reason
      // to hold the views back — they report an unreachable backend better
      // than a spinner does.
      setIngestKnown(true);
      const active = launchingRef.current || data?.status === 'running';
      timer = setTimeout(tick, active ? INGEST_POLL_ACTIVE_MS : INGEST_POLL_IDLE_MS);
    };
    tick();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [demo, refreshIngest]);

  // A finished run replaced the dataset, so the counters in the status bar
  // describe the old one until they are re-read.
  const wasIngesting = useRef(false);
  const recheckBackend = backend.recheck;
  useEffect(() => {
    if (ingesting) { wasIngesting.current = true; return; }
    if (!wasIngesting.current) return;
    wasIngesting.current = false;
    refreshStats();
    recheckBackend?.();
  }, [ingesting, refreshStats, recheckBackend]);

  // ─── Keyboard reference ────────────────────────────────────────
  // Held here rather than in a page, so Help -> Keyboard shortcuts works
  // from every tab. It used to be Graph Explorer state, which left the menu
  // item disabled everywhere else.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const toggleShortcuts = useCallback(() => setShortcutsOpen((v) => !v), []);

  // ─── Workspace tabs ────────────────────────────────────────────
  // Each tab is { id, key, label, path, icon }.
  // Tabs are persistent: switching tabs changes activeTabId and syncs URL,
  // without unmounting views.
  const [tabs, setTabs] = useState(() => {
    const initialView = viewForPath(location.pathname);
    return [makeTab(initialView)];
  });

  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id || 'tab-overview-1');

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) || tabs[0],
    [tabs, activeTabId],
  );

  const activeView = useMemo(
    () => VIEW_BY_KEY.get(activeTab?.key) || VIEWS[0],
    [activeTab],
  );

  // Sync tab selection if browser back/forward or navigation changes location.pathname
  useEffect(() => {
    const view = viewForPath(location.pathname);
    if (!view) return;
    const currentActive = tabs.find((t) => t.id === activeTabId);
    if (currentActive && currentActive.key === view.key) return;

    const existing = tabs.find((t) => t.key === view.key);
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      const newTab = makeTab(view, 1);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
  }, [location.pathname, activeTabId, tabs]);

  // Switch to an existing tab
  const switchTab = useCallback((tabId) => {
    const target = tabs.find((t) => t.id === tabId);
    if (target) {
      setActiveTabId(target.id);
      navigate(target.path);
    }
  }, [tabs, navigate]);

  // Open a tab: if forceNew is true (e.g. from TitleBar '+'), always create a new tab instance
  // If forceNew is false and tab already exists, switch to it
  const openTab = useCallback((viewKey, options = {}) => {
    const { forceNew = false, path } = options;
    const view = VIEW_BY_KEY.get(viewKey) || VIEWS[0];

    const existing = tabs.filter((t) => t.key === viewKey);
    if (!forceNew && existing.length > 0) {
      const target = existing[0];
      if (path) target.path = path;
      setActiveTabId(target.id);
      navigate(path || target.path);
      return;
    }

    const count = existing.length + 1;
    const newTab = makeTab(view, count);
    if (path) newTab.path = path;
    setTabs((prevTabs) => [...prevTabs, newTab]);
    setActiveTabId(newTab.id);
    navigate(path || newTab.path);
  }, [tabs, navigate]);

  // Close a tab
  const closeTab = useCallback((tabId) => {
    if (tabs.length <= 1) return; // Never close the last tab
    const index = tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);

    if (activeTabId === tabId) {
      const nextIndex = Math.min(index, nextTabs.length - 1);
      const fallback = nextTabs[nextIndex];
      if (fallback) {
        setActiveTabId(fallback.id);
        navigate(fallback.path);
      }
    }
  }, [tabs, activeTabId, navigate]);

  // Backward-compatible openKeys
  const openKeys = useMemo(() => tabs.map((t) => t.key), [tabs]);

  // Backward-compatible closeView
  const closeView = useCallback((key) => {
    const matching = tabs.find((t) => t.key === key);
    if (matching) closeTab(matching.id);
  }, [tabs, closeTab]);

  const value = useMemo(() => ({
    backend,
    status,
    demo,
    shortcutsOpen,
    openShortcuts,
    closeShortcuts,
    toggleShortcuts,
    stats,
    statsError,
    statsLoading,
    refreshStats,
    provenance,
    ingest,
    ingesting,
    ingestKnown,
    refreshIngest,
    noteIngestStarted,
    noteIngestFailed,
    tabs,
    activeTab,
    activeTabId,
    activeView,
    openKeys,
    openTab,
    switchTab,
    closeTab,
    closeView,
  }), [
    backend, status, demo, stats, statsError, statsLoading, refreshStats,
    provenance, ingest, ingesting, ingestKnown, refreshIngest,
    noteIngestStarted, noteIngestFailed,
    tabs, activeTab, activeTabId, activeView, openKeys,
    openTab, switchTab, closeTab, closeView,
    shortcutsOpen, openShortcuts, closeShortcuts, toggleShortcuts,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
