import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy-to-clipboard with a transient "copied" flag keyed by an id. The flag clears itself after a
 * short delay; the timer is cancelled on unmount AND before a rapid re-copy (so a second copy can't
 * orphan the first's reset timer). `onCopied` fires ONLY on a successful write — e.g. to raise a
 * toast. Shared by every copy surface (code rails, library) so the behaviour can't drift.
 */
export function useCopy(onCopied?: () => void): [string | null, (text: string, id: string) => void] {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopiedRef = useRef(onCopied);
  onCopiedRef.current = onCopied;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback((text: string, id: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id);
        onCopiedRef.current?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
      })
      .catch(() => setCopiedId(null));
  }, []);
  return [copiedId, copy];
}
