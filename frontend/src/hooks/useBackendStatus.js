import { useState, useEffect, useCallback } from 'react';
import { getHealth, getApiBaseUrl } from '../services/api';

/**
 * Polls /api/health so the whole app can tell three states apart:
 *
 *   'down'  — the backend can't be reached at all
 *   'empty' — reachable, but nothing has been ingested
 *   'ready' — reachable with data
 *
 * All three used to render as blank pages, which is exactly what a fresh
 * Vercel + Render deployment looks like on first load: a static build whose
 * VITE_API_URL was never set has no backend at all, and a free-tier backend
 * that just cold-started has an empty database. Same empty screen, completely
 * different fixes.
 */
export function useBackendStatus(pollMs = 30000) {
  const [state, setState] = useState({ status: 'checking', health: null, error: null });

  const check = useCallback(async () => {
    try {
      const res = await getHealth();
      const health = res.data;
      // A Vercel SPA rewrite that swallows /api returns index.html with a 200,
      // so "the request succeeded" is not enough — the body has to actually
      // look like the health payload.
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
