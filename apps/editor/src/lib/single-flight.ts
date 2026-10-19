import { useRef, useState } from 'react';

/**
 * Collapse a burst of reload requests into at most ONE run in flight plus ONE trailing run.
 *
 * Live-refresh views re-read their list on every change-stream event, and a bulk operation emits one
 * event PER ITEM: moving 450 files to the Recycle Bin sent ~900 list reads, and the session's request
 * budget refused most of them with a 429. Re-reading per event also let two reads answer out of
 * order, so an older list could overwrite a newer one.
 *
 * A request that arrives while a run is in flight only marks the flight dirty; when the run settles,
 * one more run starts and reads the state every one of those changes produced. Runs never overlap,
 * so their answers cannot arrive out of order. The returned promise settles when the flight that
 * covers this request ends: it rejects with the last run's error if that run failed, so a caller that
 * `void`s the trigger must pass a run that handles its own errors. A failed run does not drop
 * requests that arrived during it.
 *
 * The flight is claimed BEFORE `run` is called, so a run that throws synchronously or requests a
 * reload itself joins this flight instead of starting a second one. (A run must not AWAIT its own
 * trigger: that flight only ends after the run does.)
 */
export function singleFlight(run: () => Promise<unknown>): () => Promise<void> {
  let flight: Promise<void> | null = null;
  let again = false;

  return () => {
    if (flight) {
      again = true;
      return flight;
    }
    let settle!: (failure: { error: unknown } | null) => void;
    const current = new Promise<void>((resolve, reject) => {
      settle = (failure) => (failure ? reject(failure.error) : resolve());
    });
    flight = current;
    void (async () => {
      let failure: { error: unknown } | null;
      do {
        again = false;
        failure = null;
        try {
          await run();
        } catch (error) {
          failure = { error };
        }
      } while (again);
      flight = null;
      settle(failure);
    })();
    return current;
  };
}

/**
 * {@link singleFlight} for a component: the trigger keeps its identity across renders, and every run
 * calls the function from the LATEST render, so a trailing run sees current props and state.
 */
export function useSingleFlight(run: () => Promise<unknown>): () => Promise<void> {
  const latest = useRef(run);
  latest.current = run;
  const [trigger] = useState(() => singleFlight(() => latest.current()));
  return trigger;
}
