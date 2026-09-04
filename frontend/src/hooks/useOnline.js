import { useEffect, useState } from 'react';

/**
 * Browser connectivity.
 *
 * `navigator.onLine` only knows whether the machine has *a* network, not
 * whether the backend is reachable — a captive portal or a dead API host
 * both read as online. It is still worth having: going offline is the one
 * transition we learn about instantly, without waiting for a request to
 * time out, so the UI can stop polling and say so straight away. Whether the
 * backend actually answers is useBackendStatus's job.
 */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
