// Loads the Tailwind reference payload once per session.
//
// It is ~1.8 MB of JSON, so it is deliberately NOT bundled into the editor: it is fetched on first
// open of the reference modal and kept at module scope thereafter, so every later open is instant.
// The route serves it with a content ETag and `cache-control: no-cache`, so even a full page reload
// usually costs a conditional request and a 304 rather than the payload.
import { useEffect, useState } from 'react';
import type { TailwindReference } from '@sitewright/tailwind-reference/meta';

let cache: TailwindReference | null = null;
let inFlight: Promise<TailwindReference> | null = null;

/** Fetch (or reuse) the reference. Concurrent callers share one request. */
export function loadTailwindReference(): Promise<TailwindReference> {
  if (cache) return Promise.resolve(cache);
  inFlight ??= fetch('/authoring/tailwind/reference')
    .then((r) => {
      if (!r.ok) throw new Error(`reference unavailable (${r.status})`);
      return r.json() as Promise<TailwindReference>;
    })
    .then((data) => {
      cache = data;
      inFlight = null;
      return data;
    })
    .catch((err: unknown) => {
      // Clear the shared promise so a later open retries rather than replaying the failure forever.
      inFlight = null;
      throw err;
    });
  return inFlight;
}

export interface ReferenceState {
  reference: TailwindReference | null;
  loading: boolean;
  error: boolean;
}

/** The reference as component state, with the load kicked off on mount. */
export function useTailwindReference(): ReferenceState {
  const [state, setState] = useState<ReferenceState>(() => ({
    reference: cache,
    loading: cache === null,
    error: false,
  }));

  useEffect(() => {
    if (cache) return;
    let alive = true;
    loadTailwindReference()
      .then((reference) => alive && setState({ reference, loading: false, error: false }))
      .catch(() => alive && setState({ reference: null, loading: false, error: true }));
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/** Test seam: drop the module-level cache between suites. */
export function resetTailwindReferenceCache(): void {
  cache = null;
  inFlight = null;
}
