import { describe, it, expect } from 'vitest';
import { ConsentIntegrationSchema, WebsiteSettingsSchema, type Consent } from '../src/website.js';
import {
  integrationRuntimeInfo,
  consentRuntimeIntegrations,
  consentCspOrigins,
  buildSiteCspHeader,
  buildConsentMetaCsp,
  siteCspHeaderFromHtml,
} from '../src/consent-csp.js';

const consent = (integrations: unknown[]): Consent => ({ enabled: true, integrations } as unknown as Consent);

describe('ConsentIntegrationSchema validation', () => {
  it('accepts a valid ga4 / gtm / custom integration', () => {
    expect(() => ConsentIntegrationSchema.parse({ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-ABC123' })).not.toThrow();
    expect(() => ConsentIntegrationSchema.parse({ id: 'gtm', name: 'GTM', category: 'analytics', preset: 'gtm', measurementId: 'GTM-AB12' })).not.toThrow();
    expect(() => ConsentIntegrationSchema.parse({ id: 'chat', name: 'Chat', category: 'functional', preset: 'custom', src: 'https://widget.example.com/c.js' })).not.toThrow();
    // omitted preset = custom
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'marketing', src: 'https://x.example/s.js' })).not.toThrow();
  });

  it('rejects a custom integration without https src', () => {
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'analytics' })).toThrow(); // no src
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'analytics', src: 'http://x.example/s.js' })).toThrow(); // not https
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'analytics', src: 'javascript:alert(1)' })).toThrow();
  });

  it('rejects a preset without / with a malformed measurementId', () => {
    expect(() => ConsentIntegrationSchema.parse({ id: 'g', name: 'G', category: 'analytics', preset: 'ga4' })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ id: 'g', name: 'G', category: 'analytics', preset: 'ga4', measurementId: 'nope' })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ id: 'g', name: 'G', category: 'analytics', preset: 'gtm', measurementId: 'G-WRONG' })).toThrow();
  });

  it('rejects a custom src pointing at a private/loopback host', () => {
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'analytics', src: 'https://127.0.0.1/s.js' })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'analytics', src: 'https://192.168.1.10/s.js' })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ id: 'x', name: 'X', category: 'analytics', src: 'not a url' })).toThrow();
  });

  it('rejects an origin that carries a scheme/path/port or a bare wildcard; accepts a bare host + *. wildcard', () => {
    const base = { id: 'x', name: 'X', category: 'functional' as const, src: 'https://x.example/s.js' };
    expect(() => ConsentIntegrationSchema.parse({ ...base, origins: ['https://evil.com'] })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ ...base, origins: ['evil.com/path'] })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ ...base, origins: ['cdn.example.com:8443'] })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ ...base, origins: ['*'] })).toThrow();
    expect(() => ConsentIntegrationSchema.parse({ ...base, origins: ['cdn.example.com', '*.intercom.io'] })).not.toThrow();
  });

  it('is bounded on the WebsiteSettingsSchema (max 20 integrations)', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, name: 'S', category: 'analytics' as const, src: 'https://x.example/s.js' }));
    expect(() => WebsiteSettingsSchema.parse({ consent: { enabled: true, integrations: many } })).toThrow();
  });
});

describe('integrationRuntimeInfo / consentRuntimeIntegrations', () => {
  it('maps ga4 → the gtag loader + bootstrap descriptor', () => {
    const info = integrationRuntimeInfo({ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-ABC123' });
    expect(info).toEqual({ id: 'ga', cat: 'analytics', kind: 'ga4', mid: 'G-ABC123', src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC123', async: true });
  });
  it('maps a custom integration → a plain script descriptor (async default true)', () => {
    expect(integrationRuntimeInfo({ id: 'c', name: 'C', category: 'functional', src: 'https://w.example/c.js' })).toMatchObject({ kind: 'script', src: 'https://w.example/c.js', async: true });
    expect(integrationRuntimeInfo({ id: 'c', name: 'C', category: 'functional', src: 'https://w.example/c.js', async: false })?.async).toBe(false);
  });
  it('drops an invalid integration (defence-in-depth over the schema) → filtered out', () => {
    expect(integrationRuntimeInfo({ id: 'bad', name: 'B', category: 'analytics', preset: 'custom' } as never)).toBeNull();
    const list = consentRuntimeIntegrations(consent([
      { id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' },
      { id: 'bad', name: 'B', category: 'analytics' }, // no src → invalid → dropped
    ]));
    expect(list.map((i) => i.id)).toEqual(['ga']);
  });
});

describe('CSP derivation (the security boundary)', () => {
  it('derives ga4 origins into script-src + connect-src, deduped', () => {
    const o = consentCspOrigins(consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]));
    expect(o.script).toContain('www.googletagmanager.com');
    expect(o.connect).toEqual(expect.arrayContaining(['www.google-analytics.com', '*.analytics.google.com']));
  });
  it('adds a custom integration’s src HOST + its extra origins (script + connect)', () => {
    const o = consentCspOrigins(consent([{ id: 'c', name: 'C', category: 'functional', src: 'https://widget.intercom.io/w.js', origins: ['*.intercom.io'] }]));
    expect(o.script).toEqual(expect.arrayContaining(['widget.intercom.io', '*.intercom.io']));
    expect(o.connect).toContain('*.intercom.io');
  });

  it('builds a header CSP that adds ONLY specific https origins — never unsafe-inline/eval/*', () => {
    const csp = buildSiteCspHeader(consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]))!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com");
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://www.google-analytics.com');
    expect(csp).toContain("frame-ancestors 'none'");
    // The SCRIPT-src must never relax inline/eval/wildcard (style-src keeps 'unsafe-inline', the platform default).
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toMatch(/\*(?!\.)/); // no bare wildcard (a `*.host` wildcard is allowed)
  });

  it('returns undefined when consent is off, or enabled with no integrations (strict default stays)', () => {
    expect(buildSiteCspHeader(undefined)).toBeUndefined();
    expect(buildSiteCspHeader({ enabled: false } as Consent)).toBeUndefined();
    expect(buildSiteCspHeader({ enabled: true } as Consent)).toBeUndefined();
    expect(buildSiteCspHeader({ enabled: true, integrations: [] } as unknown as Consent)).toBeUndefined();
  });

  it('the meta CSP matches the header minus frame-ancestors (meta ignores it)', () => {
    const c = consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]);
    const meta = buildConsentMetaCsp(c)!;
    expect(meta).toContain("script-src 'self' https://www.googletagmanager.com");
    expect(meta).not.toContain('frame-ancestors');
    expect(buildConsentMetaCsp({ enabled: true } as Consent)).toBeUndefined();
  });

  it('drops a parseable-but-malformed src host (trailing ;) — no CSP-directive break-out', () => {
    // Bypass the schema (build the object directly) to prove the CSP-origin layer ALSO guards the host.
    const o = consentCspOrigins({ enabled: true, integrations: [{ id: 'x', name: 'X', category: 'analytics', src: 'https://evil.com;/s.js' }] } as unknown as Consent);
    expect(o.script).not.toContain('evil.com;');
  });

  it('siteCspHeaderFromHtml reconstructs the response header from the baked <meta> (round-trip)', () => {
    const c = consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]);
    const meta = buildConsentMetaCsp(c)!;
    // The render layer attribute-escapes the content; emulate that to feed the extractor.
    const escaped = meta.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<head><meta http-equiv="Content-Security-Policy" content="${escaped}" /></head>`;
    expect(siteCspHeaderFromHtml(html)).toBe(buildSiteCspHeader(c)); // header === meta + frame-ancestors
    expect(siteCspHeaderFromHtml('<head><title>no consent</title></head>')).toBeUndefined();
  });
});
