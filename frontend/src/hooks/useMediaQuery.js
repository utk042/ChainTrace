import { useEffect, useState } from 'react';

/**
 * Subscribe to a media query.
 *
 * Read synchronously on the first render so a pane that should start closed
 * on a narrow window never flashes open and then collapses.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * True at the width where the three-pane Browser drops its filter column —
 * below this the filter pane is an overlay, so it must not start open.
 */
export const useIsNarrow = () => useMediaQuery('(max-width: 1080px)');

export default useMediaQuery;
