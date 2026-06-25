import { describe, expect, it } from 'vitest';
import { pinnedFetch } from '../src/import/pinned-fetch.js';

// The guard decisions (resolve → reject private / non-https / bad URL) are unit-testable via an injected
// resolver; the happy path is a real TLS connection (covered by the deploy-time end-to-end import check).
describe('pinnedFetch SSRF guard', () => {
  it('rejects a non-https URL', async () => {
    expect(await pinnedFetch('http://example.com/')).toBeNull();
  });

  it('rejects an unparseable URL', async () => {
    expect(await pinnedFetch('::::not a url')).toBeNull();
  });

  it('rejects a private IP literal without connecting', async () => {
    expect(await pinnedFetch('https://127.0.0.1/')).toBeNull();
    expect(await pinnedFetch('https://169.254.169.254/latest/meta-data/')).toBeNull(); // cloud metadata
    expect(await pinnedFetch('https://[::1]/')).toBeNull();
  });

  it('rejects a hostname that resolves to a private IP (injected resolver)', async () => {
    const resolve = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(await pinnedFetch('https://rebind.evil/', { resolve })).toBeNull();
  });

  it('rejects when ANY resolved IP is private (mixed public+private)', async () => {
    const resolve = async () => [
      { address: '93.184.216.34', family: 4 }, // public
      { address: '192.168.1.10', family: 4 }, // private — must veto the whole host
    ];
    expect(await pinnedFetch('https://mixed.evil/', { resolve })).toBeNull();
  });

  it('rejects an unresolvable host', async () => {
    const resolve = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await pinnedFetch('https://nope.invalid/', { resolve })).toBeNull();
  });
});

describe('pinnedFetch — redirect following (re-pinned per hop)', () => {
  const ok = { status: 200, contentType: 'text/html', bytes: new Uint8Array() };
  it('follows up to 5 hops to a 2xx', async () => {
    const map: Record<string, unknown> = { 'https://x/a': { redirect: 'https://x/b' }, 'https://x/b': { redirect: 'https://x/c' }, 'https://x/c': ok };
    const r = await pinnedFetch('https://x/a', { _fetchOnce: async (u) => map[u] as never });
    expect(r?.status).toBe(200);
  });
  it('returns null on a redirect loop', async () => {
    const r = await pinnedFetch('https://x/loop', { _fetchOnce: async () => ({ redirect: 'https://x/loop' }) });
    expect(r).toBeNull();
  });
  it('returns null after too many redirects', async () => {
    let n = 0;
    const r = await pinnedFetch('https://x/0', { _fetchOnce: async () => ({ redirect: `https://x/${++n}` }) });
    expect(r).toBeNull();
  });
})
