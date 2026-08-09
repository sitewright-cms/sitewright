import { describe, it, expect } from 'vitest';
import { HttpCaptchaVerifier } from '../src/mail/captcha.js';

const ENDPOINTS = { hcaptcha: 'https://hc.test/verify', 'recaptcha-v2': 'https://g.test/verify', 'recaptcha-v3': 'https://g.test/verify' } as const;

/** A fetch seam that records what was asked and answers with a canned body. */
function stubFetch(body: unknown, ok = true) {
  const calls: Array<{ url: string; params: URLSearchParams }> = [];
  const impl = async (url: string, init: { body: string }) => {
    calls.push({ url, params: new URLSearchParams(init.body) });
    return { ok, json: async () => body };
  };
  return { impl: impl as never, calls };
}

describe('captcha verification', () => {
  it('sends the token to the provider’s own siteverify and passes on success', async () => {
    const { impl, calls } = stubFetch({ success: true });
    const v = new HttpCaptchaVerifier(impl, ENDPOINTS);
    expect(await v.verify({ provider: 'hcaptcha', secret: 's', token: 't', remoteip: '1.2.3.4' })).toBe(true);
    expect(calls[0]!.url).toBe('https://hc.test/verify');
    expect(calls[0]!.params.get('secret')).toBe('s');
    expect(calls[0]!.params.get('response')).toBe('t');
    expect(calls[0]!.params.get('remoteip')).toBe('1.2.3.4');
  });

  it('routes reCAPTCHA to Google, not to hCaptcha', async () => {
    const { impl, calls } = stubFetch({ success: true });
    const v = new HttpCaptchaVerifier(impl, ENDPOINTS);
    await v.verify({ provider: 'recaptcha-v2', secret: 's', token: 't' });
    expect(calls[0]!.url).toBe('https://g.test/verify');
  });

  describe('★ reCAPTCHA v3 is judged on its SCORE, not on success', () => {
    it('rejects a low score even though the provider said success', async () => {
      // v3 answers `success: true` for any well-formed token — the score IS the verdict. Treating
      // success alone as a pass is the single most common way v3 is deployed wrong, and it would
      // accept every bot on the internet while looking like it was working.
      const { impl } = stubFetch({ success: true, score: 0.1 });
      const v = new HttpCaptchaVerifier(impl, ENDPOINTS);
      expect(await v.verify({ provider: 'recaptcha-v3', secret: 's', token: 't', minScore: 0.5 })).toBe(false);
    });

    it('passes at or above the threshold, and honours a per-project threshold', async () => {
      const at = new HttpCaptchaVerifier(stubFetch({ success: true, score: 0.5 }).impl, ENDPOINTS);
      expect(await at.verify({ provider: 'recaptcha-v3', secret: 's', token: 't', minScore: 0.5 })).toBe(true);
      const strict = new HttpCaptchaVerifier(stubFetch({ success: true, score: 0.5 }).impl, ENDPOINTS);
      expect(await strict.verify({ provider: 'recaptcha-v3', secret: 's', token: 't', minScore: 0.9 })).toBe(false);
    });

    it('rejects when the response carries NO score at all', async () => {
      // A v3 key used against the v2 endpoint (or a malformed answer) returns success with no score.
      // Defaulting to "pass" there would silently disable the gate.
      const { impl } = stubFetch({ success: true });
      const v = new HttpCaptchaVerifier(impl, ENDPOINTS);
      expect(await v.verify({ provider: 'recaptcha-v3', secret: 's', token: 't' })).toBe(false);
    });

    it('applies a sane default threshold when the project set none', async () => {
      const v = new HttpCaptchaVerifier(stubFetch({ success: true, score: 0.9 }).impl, ENDPOINTS);
      expect(await v.verify({ provider: 'recaptcha-v3', secret: 's', token: 't' })).toBe(true);
    });
  });

  describe('fail-closed', () => {
    it('rejects a missing token without calling the provider at all', async () => {
      const { impl, calls } = stubFetch({ success: true });
      const v = new HttpCaptchaVerifier(impl, ENDPOINTS);
      expect(await v.verify({ provider: 'hcaptcha', secret: 's', token: undefined })).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('rejects on success:false, a non-2xx, and a network error', async () => {
      const no = new HttpCaptchaVerifier(stubFetch({ success: false }).impl, ENDPOINTS);
      expect(await no.verify({ provider: 'hcaptcha', secret: 's', token: 't' })).toBe(false);
      const bad = new HttpCaptchaVerifier(stubFetch({ success: true }, false).impl, ENDPOINTS);
      expect(await bad.verify({ provider: 'hcaptcha', secret: 's', token: 't' })).toBe(false);
      const boom = new HttpCaptchaVerifier((async () => {
        throw new Error('network');
      }) as never, ENDPOINTS);
      // An outage must not quietly turn the gate off — the author asked for a captcha.
      expect(await boom.verify({ provider: 'hcaptcha', secret: 's', token: 't' })).toBe(false);
    });
  });

  describe('credential test', () => {
    it('reports a bad SECRET, distinguishing it from a bad token', async () => {
      // Both vendors say WHICH input they disliked, so an author can be told their credentials are
      // wrong before a visitor discovers it for them.
      const v = new HttpCaptchaVerifier(stubFetch({ success: false, 'error-codes': ['invalid-input-secret'] }).impl, ENDPOINTS);
      const res = await v.testCredentials('hcaptcha', 'wrong');
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/secret/i);
    });

    it('treats "that token is invalid" as PROOF the secret was accepted', async () => {
      const v = new HttpCaptchaVerifier(stubFetch({ success: false, 'error-codes': ['invalid-input-response'] }).impl, ENDPOINTS);
      expect(await v.testCredentials('recaptcha-v2', 'right')).toEqual({ ok: true });
    });

    it('does not claim success when the provider could not be reached', async () => {
      const v = new HttpCaptchaVerifier((async () => {
        throw new Error('network');
      }) as never, ENDPOINTS);
      expect((await v.testCredentials('hcaptcha', 's')).ok).toBe(false);
    });
  });
});
