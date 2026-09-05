import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getDashboardStats, getProvenance, subscribeProvenance, isDemoMode,
} from '../services/api';
import { useBackendStatus } from '../hooks/useBackendStatus';
import { VIEWS, viewForPath } from './views';

const VIEW_BY_KEY = new Map(VIEWS.map((v) => [v.key, v]));

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

  const refreshStats = useCallback(async () => {
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
    provenance, tabs, activeTab, activeTabId, activeView, openKeys,
    openTab, switchTab, closeTab, closeView,
    shortcutsOpen, openShortcuts, closeShortcuts, toggleShortcuts,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
