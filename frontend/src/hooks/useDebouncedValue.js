import { useEffect, useState } from 'react';

/**
 * Delays a value until it stops changing.
 *
 * The table pages refetch whenever their search term changes, so binding a
 * text input straight to that term fires one request per keystroke — twelve
 * round trips to type an address, each one a full paginated query the server
 * has to run.
 */
export function useDebouncedValue(value, delayMs = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
