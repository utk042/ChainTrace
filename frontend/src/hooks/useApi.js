import { useState, useEffect, useCallback } from 'react';

export function useApi(apiCall, params = null, autoFetch = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState(null);

  const fetch = useCallback(async (overrideParams) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiCall(overrideParams || params);
      setData(res.data);
      return res.data;
    } catch (err) {
      setError(err.message || 'An error occurred');
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiCall, params]);

  useEffect(() => {
    if (autoFetch) fetch();
  }, []);

  return { data, loading, error, refetch: fetch };
}

export function usePolling(apiCall, interval = 2000, enabled = false) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      try {
        const res = await apiCall();
        setData(res.data);
      } catch (err) {
        // silently fail polling
      }
    };

    poll();
    const id = setInterval(poll, interval);
    return () => clearInterval(id);
  }, [enabled, interval]);

  return data;
}
