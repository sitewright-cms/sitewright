import { describe, it, expect, vi } from 'vitest';
import { compareSemver, isNewer, createReleaseChecker } from '../src/version/checker.js';

describe('compareSemver / isNewer', () => {
  it('orders versions numerically (ignoring v prefix and pre-release)', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('v1.3.0', '1.2.9')).toBe(1);
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
    expect(compareSemver('2.0.0-rc.1', '2.0.0')).toBe(0); // pre-release tag ignored
  });

  it('isNewer is strict', () => {
    expect(isNewer('1.1.0', '1.0.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.0', '1.0.0')).toBe(false);
  });
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('createReleaseChecker', () => {
  it('constructs with the default fetch when none is injected (no network call until invoked)', () => {
    // Covers the `options.fetchImpl ?? fetch` default — constructing must not require an injected fetch
    // and must not touch the network (latest() is never called here).
    const latest = createReleaseChecker({ repo: 'sitewright-cms/sitewright' });
    expect(typeof latest).toBe('function');
  });

  it('returns the tag and caches within the TTL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: 'v1.5.0' }));
    let t = 1000;
    const latest = createReleaseChecker({
      repo: 'sitewright-cms/sitewright',
      ttlMs: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
    });
    expect(await latest()).toBe('v1.5.0');
    t = 5000; // still within TTL
    expect(await latest()).toBe('v1.5.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached

    t = 20_000; // TTL expired
    fetchImpl.mockResolvedValueOnce(jsonResponse({ tag_name: 'v1.6.0' }));
    expect(await latest()).toBe('v1.6.0');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('degrades to null on a failed fetch (never throws)', async () => {
    const latest = createReleaseChecker({
      repo: 'x/y',
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    expect(await latest()).toBeNull();
  });

  it('returns null on a non-ok response or missing tag', async () => {
    const a = createReleaseChecker({ repo: 'x/y', fetchImpl: (async () => jsonResponse({}, false)) as unknown as typeof fetch });
    expect(await a()).toBeNull();
    const b = createReleaseChecker({ repo: 'x/y', fetchImpl: (async () => jsonResponse({ tag_name: '' })) as unknown as typeof fetch });
    expect(await b()).toBeNull();
  });

  it('backs off briefly after a failure, then recovers (no 6h lockout)', async () => {
    let t = 0;
    let ok = false;
    const fetchImpl = vi.fn(async () => {
      if (!ok) throw new Error('offline at startup');
      return jsonResponse({ tag_name: 'v2.0.0' });
    });
    const latest = createReleaseChecker({
      repo: 'x/y',
      ttlMs: 6 * 60 * 60 * 1000,
      retryMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
    });
    expect(await latest()).toBeNull(); // first attempt fails
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    t = 30_000; // within retry back-off → no refetch
    expect(await latest()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    t = 70_000; // past retry back-off; connectivity restored
    ok = true;
    expect(await latest()).toBe('v2.0.0');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent callers onto a single request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: 'v3.0.0' }));
    const latest = createReleaseChecker({ repo: 'x/y', fetchImpl: fetchImpl as unknown as typeof fetch });
    const [a, b] = await Promise.all([latest(), latest()]);
    expect(a).toBe('v3.0.0');
    expect(b).toBe('v3.0.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
