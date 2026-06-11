import { useEffect, useRef } from 'react';

/** Default liveness-probe cadence — slow enough to be negligible load, prompt enough to feel "live". */
export const SESSION_POLL_MS = 60_000;

/**
 * While `active`, run `onPoll` every `intervalMs` so a server-side session expiry is detected even
 * when the user is idle (the probe's 401 trips the app's unauthorized handler → login). It is a
 * background liveness check, NOT a data refresh — keep `onPoll` cheap and side-effect-light.
 *
 * Behaviour:
 * - Skips a tick while the tab is hidden (`document.visibilityState`), so background tabs don't poll.
 * - Probes ONCE immediately when the tab returns to the foreground (it may have expired while hidden).
 * - Pass `active=false` (e.g. on the login/loading screens) to stop entirely.
 *
 * `onPoll` is read through a ref, so passing a fresh closure each render does NOT restart the timer;
 * the interval only resets when `active`/`intervalMs` change.
 */
export function useSessionPoll(active: boolean, onPoll: () => void, intervalMs: number = SESSION_POLL_MS): void {
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!active) return;
    const probe = (): void => {
      // Don't poll a backgrounded tab — wait until it's visible again (see the refocus handler).
      // (Browser-only hook — the editor is a client SPA; `document` is always present here.)
      if (document.visibilityState === 'hidden') return;
      onPollRef.current();
    };
    const timer = setInterval(probe, intervalMs);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') probe();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs]);
}
