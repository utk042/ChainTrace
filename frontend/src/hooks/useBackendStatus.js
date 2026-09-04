import { useState, useEffect, useCallback } from 'react';
import { getHealth, getApiBaseUrl } from '../services/api';

/**
 * Polls /api/health so the app can tell three states apart:
 *
 *   'down'  — the backend can't be reached at all
 *   'empty' — reachable, but nothing has been ingested
 *   'ready' — reachable with data
 *
 * They render identically without this, and each needs a different fix.
 */
export function useBackendStatus(pollMs = 30000) {
  const [state, setState] = useState({ status: 'checking', health: null, error: null });

  const check = useCallback(async () => {
    try {
      const res = await getHealth();
      const health = res.data;
      // An SPA rewrite that swallows /api returns index.html with a 200, so
      // a successful request is not enough: check the body's shape.
      if (!health || health.status !== 'healthy') {
        setState({ status: 'down', health: null, error: 'Unexpected response from /api/health.' });
        return;
      }
      setState({ status: health.has_data ? 'ready' : 'empty', health, error: null });
    } catch (e) {
      setState({
        status: 'down',
        health: null,
        error: e.response
          ? `Backend responded ${e.response.status}.`
          : 'No response from the backend.',
      });
    }
  }, []);

  useEffect(() => {
    check();
    if (!pollMs) return;
    const id = setInterval(check, pollMs);
    return () => clearInterval(id);
  }, [check, pollMs]);

  return { ...state, apiUrl: getApiBaseUrl(), recheck: check };
}
