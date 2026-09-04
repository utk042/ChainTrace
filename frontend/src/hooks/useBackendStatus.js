import { useState, useEffect, useCallback, useRef } from 'react';
import { getHealth, getApiBaseUrl } from '../services/api';
import { useOnline } from './useOnline';

/**
 * Polls /api/health so the app can tell five states apart:
 *
 *   'down'    — the backend can't be reached and nothing is stored
 *   'offline' — no network, but the service worker has data from earlier
 *   'empty'   — reachable, but nothing has been ingested
 *   'ready'   — reachable with data
 *   'checking'— first probe in flight
 *
 * They render identically without this, and each needs a different fix.
 */
export function useBackendStatus(pollMs = 30000) {
  const [state, setState] = useState({
    status: 'checking', health: null, error: null, cachedAt: null,
  });
  const online = useOnline();
  // Kept in a ref so the poll interval isn't torn down and restarted every
  // time connectivity flaps.
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const check = useCallback(async () => {
    try {
      const res = await getHealth();
      const health = res.data;
      // An SPA rewrite that swallows /api returns index.html with a 200, so
      // a successful request is not enough: check the body's shape.
      if (!health || health.status !== 'healthy') {
        setState({ status: 'down', health: null, cachedAt: null, error: 'Unexpected response from /api/health.' });
        return;
      }
      if (res.fromCache) {
        // The service worker answered because the backend didn't. The data
        // is real but it is as old as its stamp says.
        setState({ status: 'offline', health, cachedAt: res.cachedAt, error: null });
        return;
      }
      setState({ status: health.has_data ? 'ready' : 'empty', health, cachedAt: null, error: null });
    } catch (e) {
      setState({
        status: 'down',
        health: null,
        cachedAt: null,
        error: !onlineRef.current
          ? 'This device is offline and nothing is stored for this backend yet.'
          : e.response
            ? `Backend responded ${e.response.status}.`
            : 'No response from the backend.',
      });
    }
  }, []);

  useEffect(() => {
    check();
    if (!pollMs) return undefined;
    const id = setInterval(() => {
      // Polling a backend the machine provably cannot reach only burns the
      // request timeout; the 'online' event re-checks the moment it can.
      if (onlineRef.current) check();
    }, pollMs);
    return () => clearInterval(id);
  }, [check, pollMs]);

  // Re-probe immediately on reconnect rather than waiting out the interval.
  useEffect(() => { if (online) check(); }, [online, check]);

  return { ...state, online, apiUrl: getApiBaseUrl(), recheck: check };
}
