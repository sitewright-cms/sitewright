import { describe, it, expect, vi } from 'vitest';
import { HttpHcaptchaVerifier } from '../src/mail/hcaptcha.js';

type FetchResult = { ok: boolean; json: () => Promise<unknown> };
type FetchInit = { method: string; headers: Record<string, string>; body: string };

function fakeFetch(impl: () => Promise<FetchResult>) {
  // Typed as a 2-arg fn so `mock.calls[0]` is `[url, init]`; the impl ignores them.
  return vi.fn<(url: string, init: FetchInit) => Promise<FetchResult>>(() => impl());
}

describe('HttpHcaptchaVerifier', () => {
  it('returns false without calling the network when no token is given', async () => {
    const fetchMock = fakeFetch(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const v = new HttpHcaptchaVerifier(fetchMock);
    expect(await v.verify('secret', undefined)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts secret + response (+ remoteip) and returns success', async () => {
    const fetchMock = fakeFetch(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const v = new HttpHcaptchaVerifier(fetchMock);
    expect(await v.verify('sek', 'tok', '1.2.3.4')).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body).toContain('secret=sek');
    expect(init.body).toContain('response=tok');
    expect(init.body).toContain('remoteip=1.2.3.4');
  });

  it('returns false on success:false, non-2xx, or a thrown fetch (fail-closed)', async () => {
    expect(await new HttpHcaptchaVerifier(fakeFetch(async () => ({ ok: true, json: async () => ({ success: false }) }))).verify('s', 't')).toBe(false);
    expect(await new HttpHcaptchaVerifier(fakeFetch(async () => ({ ok: false, json: async () => ({}) }))).verify('s', 't')).toBe(false);
    expect(await new HttpHcaptchaVerifier(fakeFetch(async () => { throw new Error('network'); })).verify('s', 't')).toBe(false);
  });
});
