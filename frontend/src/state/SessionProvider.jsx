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

/**
 * The state the workstation chrome needs, held once.
 *
 * Before this, the top bar polled /api/health on its own, the banner polled
 * it again, and the dashboard fetched the same counters a third time — three
 * requests describing one backend, free to disagree with each other on
 * screen. There is now one health poll, one set of counters, and one place
 * that knows which views are open.
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
  // Snapshot mode answers /api/health from bundled data, which would
  // otherwise report a healthy backend that isn't there.
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
      // An em dash on every counter reads as "nothing ingested". When the
      // figures are missing because the request failed, say which.
      setStats(null);
      setStatsError(e.response
        ? `The backend returned ${e.response.status} for /api/dashboard/stats.`
        : 'The dashboard counters could not be fetched.');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Refetched whenever the backend's state changes, not once on mount: the
  // counters used to be read a single time and, if that read failed, every
  // figure stayed an em dash for the life of the page.
  useEffect(() => {
    if (backend.status === 'checking') return;
    refreshStats();
  }, [backend.status, refreshStats]);

  // Where the data on screen came from — live, service-worker cache, or the
  // bundled snapshot. A forensic tool must never leave that ambiguous.
  const [provenance, setProvenance] = useState(getProvenance);
  useEffect(() => subscribeProvenance(setProvenance), []);

  // ─── Workspace tabs ────────────────────────────────────────────
  // Navigating opens a view; the tab strip is the set of views open in this
  // window, exactly as the title bar works on the Gotham workstation.
  const [openKeys, setOpenKeys] = useState(() => [viewForPath(location.pathname).key]);
  const activeView = viewForPath(location.pathname);

  useEffect(() => {
    setOpenKeys((keys) => (keys.includes(activeView.key) ? keys : [...keys, activeView.key]));
  }, [activeView.key]);

  const closeView = useCallback((key) => {
    const index = openKeys.indexOf(key);
    if (index === -1 || openKeys.length <= 1) return;   // never close the last tab
    const next = openKeys.filter((k) => k !== key);
    setOpenKeys(next);
    // Closing the view you are looking at lands on its neighbour rather than
    // on a blank workspace. Navigation is kept out of the state updater so a
    // double-invoked render can't route twice.
    if (key === activeView.key) {
      const fallback = VIEW_BY_KEY.get(next[Math.min(index, next.length - 1)]);
      if (fallback) navigate(fallback.path);
    }
  }, [openKeys, activeView.key, navigate]);

  const value = useMemo(() => ({
    backend,
    status,
    demo,
    stats,
    statsError,
    statsLoading,
    refreshStats,
    provenance,
    activeView,
    openKeys,
    closeView,
  }), [
    backend, status, demo, stats, statsError, statsLoading, refreshStats,
    provenance, activeView, openKeys, closeView,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
