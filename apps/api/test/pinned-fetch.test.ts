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
