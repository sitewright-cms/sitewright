import { describe, it, expect, vi } from 'vitest';
import { JsonDataCache } from '../src/http/json-data-cache.js';
import { JsonDataError } from '../src/publish/json-data.js';

/** A controllable clock + fetcher, so TTLs are asserted rather than slept through. */
function harness(opts: { okTtlMs?: number; errTtlMs?: number; maxTotalBytes?: number } = {}) {
  let t = 1_000_000;
  const calls: string[] = [];
  let impl: (url: string) => Promise<unknown> = async (url) => ({ from: url });
  const cache = new JsonDataCache({
    now: () => t,
    fetchImpl: async (url: string) => {
      calls.push(url);
      return impl(url);
    },
    ...opts,
  });
  return {
    cache,
    calls,
    advance: (ms: number) => {
      t += ms;
    },
    setImpl: (fn: (url: string) => Promise<unknown>) => {
      impl = fn;
    },
  };
}

const URL_A = 'https://data.example.com/a.json';
const URL_B = 'https://data.example.com/b.json';

describe('JsonDataCache', () => {
  it('resolve() fetches once, then serves the snapshot within its TTL', async () => {
    const h = harness();
    const first = await h.cache.resolve('p1', URL_A);
    expect(first?.data).toEqual({ from: URL_A });
    expect(first?.error).toBeUndefined();
    expect(first?.bytes).toBeGreaterThan(0);

    h.advance(59_000);
    const second = await h.cache.resolve('p1', URL_A);
    expect(second?.data).toEqual({ from: URL_A });
    expect(h.calls).toHaveLength(1); // still ONE outbound request
  });

  it('re-fetches once the TTL has passed', async () => {
    const h = harness();
    await h.cache.resolve('p1', URL_A);
    h.advance(61_000);
    await h.cache.resolve('p1', URL_A);
    expect(h.calls).toHaveLength(2);
  });

  it('a URL change invalidates — the old payload answers a different question', async () => {
    const h = harness();
    await h.cache.resolve('p1', URL_A);
    const next = await h.cache.resolve('p1', URL_B);
    expect(next?.data).toEqual({ from: URL_B });
    expect(h.calls).toEqual([URL_A, URL_B]);
  });

  it('clearing the URL drops the entry at once, not at the next TTL', async () => {
    const h = harness();
    await h.cache.resolve('p1', URL_A);
    expect(await h.cache.resolve('p1', undefined)).toBeUndefined();
    expect(h.cache.totalBytes).toBe(0);
    // …and the next configured read is a real fetch, not the stale payload.
    await h.cache.resolve('p1', URL_A);
    expect(h.calls).toEqual([URL_A, URL_A]);
  });

  // ★ THE POINT OF THE WHOLE CACHE. The single-page preview renders per keystroke; an unreachable
  // host costs the full 8s timeout per attempt. Without caching the FAILURE, every character typed
  // would queue another one — the editor would be slower against a broken URL than against no URL.
  it('caches FAILURES too, so a dead source costs one attempt per TTL and not one per render', async () => {
    const h = harness();
    h.setImpl(async () => {
      throw new JsonDataError('JSON data fetch timed out');
    });
    const first = await h.cache.resolve('p1', URL_A);
    expect(first?.error).toBe('JSON data fetch timed out');
    expect(first?.data).toBeUndefined();
    expect(first?.bytes).toBe(0);

    for (let i = 0; i < 20; i++) await h.cache.resolve('p1', URL_A);
    expect(h.calls).toHaveLength(1); // 20 renders, ONE outbound attempt

    // A failure ages out faster than a success, so a fixed URL recovers without a restart.
    h.advance(31_000);
    h.setImpl(async (url) => ({ from: url }));
    expect((await h.cache.resolve('p1', URL_A))?.data).toEqual({ from: URL_A });
  });

  it('resolve() never rejects — a preview must not 500 because a tenant JSON host is down', async () => {
    const h = harness();
    h.setImpl(async () => {
      throw new Error('ECONNREFUSED'); // not even a JsonDataError
    });
    const snap = await h.cache.resolve('p1', URL_A);
    expect(snap?.error).toBe('JSON data fetch failed');
  });

  it('coalesces concurrent callers onto ONE request', async () => {
    const h = harness();
    let release!: (v: unknown) => void;
    h.setImpl(() => new Promise((res) => (release = res)));
    const all = Promise.all([
      h.cache.resolve('p1', URL_A),
      h.cache.resolve('p1', URL_A),
      h.cache.resolve('p1', URL_A),
    ]);
    release({ ok: true });
    const [a, b, c] = await all;
    expect(h.calls).toHaveLength(1);
    expect(a?.data).toEqual({ ok: true });
    expect(b?.data).toEqual({ ok: true });
    expect(c?.data).toEqual({ ok: true });
  });

  describe('snapshot() — the per-keystroke path', () => {
    it('never awaits the network: a cold miss returns nothing and warms in the background', async () => {
      const h = harness();
      expect(h.cache.snapshot('p1', URL_A)).toBeUndefined();
      // Wait on the STATE, not on `calls` — the harness records a call when the fetch STARTS, so
      // `calls.length === 1` is true while the payload is still in flight and would race.
      await vi.waitFor(() => expect(h.cache.snapshot('p1', URL_A)?.data).toEqual({ from: URL_A }));
    });

    it('a burst of cold renders makes ONE request, not one per render', async () => {
      // ★ The property that protects a tenant's JSON host: `snapshot()` is called per keystroke, and
      // before the first payload lands every one of those calls is a cold miss.
      const h = harness();
      for (let i = 0; i < 50; i++) expect(h.cache.snapshot('p1', URL_A)).toBeUndefined();
      await vi.waitFor(() => expect(h.cache.snapshot('p1', URL_A)?.data).toEqual({ from: URL_A }));
      expect(h.calls).toHaveLength(1);
    });

    it('serves a STALE snapshot immediately and revalidates behind it', async () => {
      const h = harness();
      await h.cache.resolve('p1', URL_A);
      h.setImpl(async () => ({ from: 'fresher' }));
      h.advance(61_000);

      // The stale value is returned NOW — a preview showing slightly old data beats a preview that stalls.
      expect(h.cache.snapshot('p1', URL_A)?.data).toEqual({ from: URL_A });
      await vi.waitFor(() => expect(h.cache.snapshot('p1', URL_A)?.data).toEqual({ from: 'fresher' }));
    });

    it('a hundred renders against a fresh entry make no requests at all', async () => {
      const h = harness();
      await h.cache.resolve('p1', URL_A);
      for (let i = 0; i < 100; i++) expect(h.cache.snapshot('p1', URL_A)?.data).toEqual({ from: URL_A });
      expect(h.calls).toHaveLength(1);
    });
  });

  it('bounds total cached bytes, evicting least-recently-used and never the newest', async () => {
    // Each payload ~1 KB; a 3 KB ceiling holds about three of them.
    const h = harness({ maxTotalBytes: 3_000 });
    h.setImpl(async (url) => ({ pad: 'x'.repeat(900), url }));
    for (const id of ['p1', 'p2', 'p3']) await h.cache.resolve(id, URL_A);
    expect(h.cache.totalBytes).toBeLessThanOrEqual(3_000);

    // Touch p2 so p1 is the least recently used, then push a fourth project in.
    expect(h.cache.snapshot('p2', URL_A)).toBeDefined();
    await h.cache.resolve('p4', URL_A);

    expect(h.cache.totalBytes).toBeLessThanOrEqual(3_000);
    expect(h.cache.snapshot('p4', URL_A)).toBeDefined(); // the newest survives its own insert
    expect(h.calls.length).toBeGreaterThan(0);
  });

  it('delete() forgets a project, so a reap leaves nothing behind', async () => {
    const h = harness();
    await h.cache.resolve('p1', URL_A);
    expect(h.cache.totalBytes).toBeGreaterThan(0);
    h.cache.delete('p1');
    expect(h.cache.totalBytes).toBe(0);
    expect(h.cache.snapshot('p1', URL_A)).toBeUndefined();
  });

  it('a source that parses to an empty object is a SUCCESS with tiny bytes, not a failure', async () => {
    // The two are different answers and the UI says so differently — an empty source renders nothing
    // while looking like it worked, which is the case worth naming.
    const h = harness();
    h.setImpl(async () => ({}));
    const snap = await h.cache.resolve('p1', URL_A);
    expect(snap?.error).toBeUndefined();
    expect(snap?.data).toEqual({});
    expect(snap?.bytes).toBe(2); // "{}"
  });
});
