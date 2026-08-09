import { describe, it, expect } from 'vitest';
import {
  CAPTCHA_HOSTS,
  CAPTCHA_PROVIDERS,
  CaptchaInputSchema,
  CaptchaStoredSchema,
  isValidSiteKey,
  maskCaptcha,
  needsConsent,
  platformInjectedCspOrigins,
} from '../src/index.js';

const HCAPTCHA_KEY = '10000000-ffff-ffff-ffff-000000000001';
const RECAPTCHA_KEY = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';

describe('captcha site keys', () => {
  it('accepts each provider’s real key shape and rejects the others’', () => {
    // The shapes genuinely differ — a UUID vs a `6L…` string — so a key pasted into the wrong
    // provider is catchable, and that is the most likely way to misconfigure this.
    expect(isValidSiteKey('hcaptcha', HCAPTCHA_KEY)).toBe(true);
    expect(isValidSiteKey('recaptcha-v2', RECAPTCHA_KEY)).toBe(true);
    expect(isValidSiteKey('recaptcha-v3', RECAPTCHA_KEY)).toBe(true);
    expect(isValidSiteKey('hcaptcha', RECAPTCHA_KEY)).toBe(false);
    expect(isValidSiteKey('recaptcha-v2', HCAPTCHA_KEY)).toBe(false);
  });

  it('★ rejects a placeholder, which a bare min(1) let through to every visitor', () => {
    // A real instance was configured with the literal string `123`. It passed validation, was baked
    // into every published form as data-sitekey="123", and produced the vendor's own "the sitekey is
    // incorrect" for every visitor. The platform knew it was unusable the moment it was typed.
    for (const bad of ['123', 'abc', 'not-a-uuid', '10000000-ffff-ffff-ffff']) {
      expect(() => CaptchaInputSchema.parse({ provider: 'hcaptcha', siteKey: bad }), bad).toThrow();
    }
    for (const bad of ['123', 'abc', '7LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI']) {
      expect(() => CaptchaInputSchema.parse({ provider: 'recaptcha-v2', siteKey: bad }), bad).toThrow();
    }
  });

  it('★ …but the STORED schema stays permissive, and that is not an oversight', () => {
    // A stored config is parsed on every publish and every submission. Tightening it would not fix a
    // bad key already in a database — it would take the project's forms down because of one.
    expect(CaptchaStoredSchema.parse({ provider: 'hcaptcha', siteKey: '123' })).toEqual({ provider: 'hcaptcha', siteKey: '123' });
  });

  it('trims surrounding whitespace and keeps the author’s case', () => {
    expect(CaptchaInputSchema.parse({ provider: 'hcaptcha', siteKey: `  ${HCAPTCHA_KEY.toUpperCase()} ` }).siteKey).toBe(HCAPTCHA_KEY.toUpperCase());
  });

  it('refuses a score threshold on a provider that returns no score', () => {
    // Storing a number the verifier will ignore is a setting that silently does nothing — the worst
    // kind, because the author believes it is protecting them.
    expect(() => CaptchaInputSchema.parse({ provider: 'hcaptcha', siteKey: HCAPTCHA_KEY, minScore: 0.7 })).toThrow(/v3/);
    expect(CaptchaInputSchema.parse({ provider: 'recaptcha-v3', siteKey: RECAPTCHA_KEY, minScore: 0.7 }).minScore).toBe(0.7);
  });

  it('masks the secret to a flag but keeps the site key, which is public by nature', () => {
    const masked = maskCaptcha({ provider: 'recaptcha-v3', siteKey: RECAPTCHA_KEY, secret: { iv: 'i', ct: 'ciphertext', tag: 't' }, minScore: 0.7 });
    expect(masked).toEqual({ provider: 'recaptcha-v3', siteKey: RECAPTCHA_KEY, hasSecret: true, minScore: 0.7 });
    expect(JSON.stringify(masked)).not.toContain('ciphertext');
  });

  it('names Google’s providers as the ones needing consent', () => {
    expect(needsConsent('hcaptcha')).toBe(false);
    expect(needsConsent('recaptcha-v2')).toBe(true);
    expect(needsConsent('recaptcha-v3')).toBe(true);
  });
});

describe('captcha CSP origins', () => {
  const routed = '<form data-sw-routed="contact"></form>';

  it('widens the policy for whichever provider the page actually carries', () => {
    for (const provider of CAPTCHA_PROVIDERS) {
      const html = `${routed}<form data-sw-captcha="${provider}"></form>`;
      const o = platformInjectedCspOrigins(html, 'https://sitewright.example');
      for (const host of CAPTCHA_HOSTS[provider]) {
        expect(o.script, provider).toContain(host);
        expect(o.frame, provider).toContain(host);
        expect(o.style, provider).toContain(host);
        expect(o.connect, provider).toContain(host);
      }
    }
  });

  it('★ covers reCAPTCHA v3, which has NO widget class to detect', () => {
    // This is why the marker is an attribute on the form rather than a widget class: v3 is a script
    // that runs on submit, so a class-based check would have silently omitted the origins for exactly
    // the provider whose failure is hardest to see.
    const html = `${routed}<form data-sw-captcha="recaptcha-v3"><input type="hidden" name="g-recaptcha-response" /></form>`;
    expect(platformInjectedCspOrigins(html, '').script).toContain('www.google.com');
  });

  it('widens nothing for a page with no captcha on it', () => {
    const o = platformInjectedCspOrigins(routed, '');
    expect(o.script).toEqual([]);
    expect(o.frame).toEqual([]);
    expect(o.style).toEqual([]);
  });

  it('does not confuse one provider’s marker for another’s', () => {
    const o = platformInjectedCspOrigins(`${routed}<form data-sw-captcha="hcaptcha"></form>`, '');
    expect(o.script).toEqual(['hcaptcha.com', '*.hcaptcha.com']);
    expect(o.script).not.toContain('www.google.com');
  });
});
