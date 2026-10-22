import { useEffect, useState } from 'react';

/** `value`, but only once it has stopped changing for `delayMs` — for a search box that asks the server. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return settled;
}
