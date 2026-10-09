import { useLayoutEffect, useRef } from 'react';

/** Jump to the top of the page at once. `instant` beats any `scroll-behavior: smooth` in CSS, so the
 *  page never glides up through the content it is leaving. */
export function scrollToTopNow(): void {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

/**
 * Start the page at the top whenever `value` changes (a tab, say) — not on mount, and not on a re-render
 * that keeps it. Runs as a LAYOUT effect, so when the old content and the new swap in one commit the jump
 * lands before the browser paints: no frame of the new content mid-page, none of the old at the top.
 *
 * `skip(prev, next)` hands a change to someone else — a view that ANIMATES its own swap must jump only
 * once its old content has faded out (see SettingsView), or the top of the old content flashes first.
 */
export function useScrollTopOnChange<T>(value: T, skip?: (prev: T, next: T) => boolean): void {
  const prev = useRef(value);
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (Object.is(from, value) || skip?.(from, value)) return;
    scrollToTopNow();
    // A rerun for a new `skip` alone finds `from === value` and does nothing, so an inline one is fine.
  }, [value, skip]);
}
