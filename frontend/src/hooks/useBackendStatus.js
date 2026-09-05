import { useState, useEffect, useCallback, useRef } from 'react';
import { getHealth, getApiBaseUrl } from '../services/api';

import { REQUIRED_API_REVISION } from '../services/apiContract';

export { REQUIRED_API_REVISION };
import { useOnline } from './useOnline';

/**
 * Polls /api/health so the app can tell seven states apart:
 *
 *   'down'     — the backend can't be reached and nothing is stored
 *   'offline'  — no network, but the service worker has data from earlier
 *   'stale'    — reachable, but running older code than this frontend
 *   'degraded' — reachable, but it cannot read its own database
 *   'empty'    — reachable, and the database really is empty
 *   'ready'    — reachable with data
 *   'checking' — first probe in flight
 *
 * They render identically without this, and each needs a different fix.
 *
 * 'degraded' is the one that was missing. The backend used to answer a failed
 * database read with `has_data: false`, so a broken database and an empty one
 * arrived here as the same thing: the app told the operator to go and ingest
 * data while the pages next to the banner rendered thousands of wallets from
 * that same database. Now the backend reports `db_error`, and this keeps the
 * two apart.
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
      // 'degraded' is still ChainTrace answering; only an unrecognised body
      // (an SPA rewrite serving index.html, a proxy error page) is 'down'.
      if (!health || (health.status !== 'healthy' && health.status !== 'degraded')) {
        setState({ status: 'down', health: null, cachedAt: null, error: 'Unexpected response from /api/health.' });
        return;
      }
      if (res.fromCache) {
        // The service worker answered because the backend didn't. The data
        // is real but it is as old as its stamp says.
        setState({ status: 'offline', health, cachedAt: res.cachedAt, error: null });
        return;
      }
      // A backend older than this UI answers with the old response shapes,
      // and the pages render a confusing half-populated result: a pipeline
      // failure with no stage breakdown, an error panel with no message. That
      // reads as a new bug rather than as a server that needs restarting, so
      // it is called out before anything else is judged.
      const revision = Number(health.api_revision ?? 0);
      if (revision < REQUIRED_API_REVISION) {
        setState({
          status: 'stale', health, cachedAt: null, revision,
          error: `This interface expects backend revision ${REQUIRED_API_REVISION}, `
            + `but the backend is answering with revision ${revision || 'unknown (pre-versioning)'}.`,
        });
        return;
      }

      if (health.db_error) {
        setState({
          status: 'degraded', health, cachedAt: null,
          error: `The backend cannot read its database: ${health.db_error}`,
        });
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
