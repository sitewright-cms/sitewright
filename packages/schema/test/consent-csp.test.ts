import { describe, it, expect } from 'vitest';
import { ConsentIntegrationSchema, WebsiteSettingsSchema, type Consent } from '../src/website.js';
import {
  integrationRuntimeInfo,
  consentRuntimeIntegrations,
  consentCspOrigins,
  buildSiteCspHeader,
  buildConsentMetaCsp,
  siteCspHeaderFromHtml,
  authorContentCspOrigins,
  gateAuthorIframes,
  DEFAULT_EMBED_CATEGORY,
} from '../src/consent-csp.js';

const consent = (integrations: unknown[]): Consent => ({ enabled: true, integrations } as unknown as Consent);

describe('authorContentCspOrigins — author iframe + gated-script origins', () => {
  it('collects a cross-origin iframe src into frame-src', () => {
    expect(authorContentCspOrigins('<iframe src="https://player.vimeo.com/video/1"></iframe>').frame).toContain('player.vimeo.com');
  });
  it('reads an already-gated iframe (data-sw-consent-src) too — order independent', () => {
    expect(authorContentCspOrigins('<iframe data-sw-consent-src="https://www.youtube.com/embed/x" data-sw-consent-cat="marketing"></iframe>').frame).toContain('www.youtube.com');
  });
  it('ignores same-origin/relative iframes and non-https schemes', () => {
    expect(authorContentCspOrigins('<iframe src="/local"></iframe><iframe src="http://insecure.example/x"></iframe>').frame).toEqual([]);
  });
  it('collects a GATED script host into script-src + connect-src', () => {
    const o = authorContentCspOrigins('<script type="text/plain" data-sw-consent="analytics" src="https://cdn.example.com/a.js"></script>');
    expect(o.script).toContain('cdn.example.com');
    expect(o.connect).toContain('cdn.example.com');
  });
  it('does NOT collect an ungated script', () => {
    expect(authorContentCspOrigins('<script src="https://cdn.example.com/a.js"></script>').script).toEqual([]);
  });
  it('collects a cross-origin <video src> into media-src', () => {
    expect(authorContentCspOrigins('<video src="https://cdn.example.com/promo.mp4"></video>').media).toContain('cdn.example.com');
  });
  it('collects a cross-origin nested <source src> (video/audio) into media-src', () => {
    expect(authorContentCspOrigins('<video><source src="https://cdn.example.com/promo.mp4" type="video/mp4"></video>').media).toContain('cdn.example.com');
    expect(authorContentCspOrigins('<audio><source src="https://media.example.org/pod.mp3"></audio>').media).toContain('media.example.org');
  });
  it('ignores same-origin/relative and non-https media', () => {
    expect(authorContentCspOrigins('<video src="/local.mp4"></video><video src="http://insecure.example/x.mp4"></video>').media).toEqual([]);
  });
  it('does not truncate on a `>` inside a quoted media src (quote-aware tag match)', () => {
    expect(authorContentCspOrigins('<source src="https://cdn.example.com/v.mp4?a=1>2">').media).toContain('cdn.example.com');
  });
});

describe('gateAuthorIframes — hold cross-origin author iframes', () => {
  it('moves a cross-origin src to data-sw-consent-src + stamps the default category, preserving other attrs', () => {
    const out = gateAuthorIframes('<iframe src="https://player.vimeo.com/video/1" width="640" title="v"></iframe>');
    expect(out).toContain('data-sw-consent-src="https://player.vimeo.com/video/1"');
    expect(out).toContain(`data-sw-consent-cat="${DEFAULT_EMBED_CATEGORY}"`);
    expect(out).not.toMatch(/<iframe[^>]*\ssrc=/); // no live src remains
    expect(out).toContain('width="640"');
    expect(out).toContain('title="v"');
  });
  it('honors a per-iframe data-sw-consent="marketing" override and a custom default', () => {
    expect(gateAuthorIframes('<iframe src="https://x.example/v" data-sw-consent="marketing"></iframe>')).toContain('data-sw-consent-cat="marketing"');
    expect(gateAuthorIframes('<iframe src="https://x.example/v"></iframe>', { defaultCategory: 'analytics' })).toContain('data-sw-consent-cat="analytics"');
  });

  it('STRIPS the author data-sw-consent marker (category moves to -cat) so the held iframe is not matched by the mount selectors', () => {
    // Catch any surviving `data-sw-consent` that is NOT one of the -src/-cat/-skip/-note variants (= the mount marker).
    const hasBareMarker = (s: string): boolean => /\sdata-sw-consent(?![\w-])/.test(s);
    const quoted = gateAuthorIframes('<iframe src="https://x.example/v" data-sw-consent="marketing" data-sw-consent-note="Video"></iframe>');
    expect(quoted).toContain('data-sw-consent-cat="marketing"');
    expect(hasBareMarker(quoted)).toBe(false); // the marker is gone (else it'd match the banner's [data-sw-consent] CSS/JS)
    expect(quoted).toContain('data-sw-consent-note="Video"'); // the -note variant is preserved (the `-` guards it)
    // single-quoted + the rare value-less boolean form are ALSO stripped.
    expect(hasBareMarker(gateAuthorIframes(`<iframe src="https://x.example/v" data-sw-consent='analytics'></iframe>`))).toBe(false);
    const boolForm = gateAuthorIframes('<iframe src="https://x.example/v" data-sw-consent></iframe>');
    expect(hasBareMarker(boolForm)).toBe(false);
    expect(boolForm).toContain(`data-sw-consent-cat="${DEFAULT_EMBED_CATEGORY}"`); // no value → default category
  });
  it('leaves data-sw-consent-skip, same-origin, and already-gated iframes untouched', () => {
    const skip = '<iframe src="https://x.example/v" data-sw-consent-skip></iframe>';
    expect(gateAuthorIframes(skip)).toBe(skip);
    const local = '<iframe src="/embed/local"></iframe>';
    expect(gateAuthorIframes(local)).toBe(local);
    const once = gateAuthorIframes('<iframe src="https://x.example/v"></iframe>');
    expect(gateAuthorIframes(once)).toBe(once); // idempotent
  });

  it('gates an UNQUOTED cross-origin src (paste-from-blog HTML)', () => {
    const out = gateAuthorIframes('<iframe src=https://player.vimeo.com/video/1 width="640"></iframe>');
    expect(out).toContain('data-sw-consent-src="https://player.vimeo.com/video/1"');
    expect(out).not.toMatch(/<iframe[^>]*\ssrc=/);
    expect(authorContentCspOrigins('<iframe src=https://player.vimeo.com/video/1></iframe>').frame).toContain('player.vimeo.com');
  });

  it('escapes a `"` from a single-quoted src so it cannot break out into a new attribute (no onload/style injection)', () => {
    const out = gateAuthorIframes(`<iframe src='https://evil.example/x" onload="alert(1)'></iframe>`);
    expect(out).not.toContain('" onload='); // the raw-quote breakout that would open an onload attribute is gone
    expect(out).toContain('data-sw-consent-src="https://evil.example/x&quot; onload=&quot;alert(1)"'); // neutralized inside the value
  });

  it('does not truncate on a `>` inside a quoted src (quote-aware tag match)', () => {
    const out = gateAuthorIframes('<iframe src="https://www.google.com/maps?q=a>b&output=embed"></iframe>');
    expect(out).toContain('data-sw-consent-src="https://www.google.com/maps?q=a>b&output=embed"');
    expect(out).toContain('data-sw-consent-cat=');
  });
});

describe('consent CSP — author origins + integration frameOrigins', () => {
  it('adds author iframe origins to frame-src independently of consent.enabled', () => {
    const csp = buildSiteCspHeader(undefined, { frame: ['player.vimeo.com'] })!;
    expect(csp).toContain("frame-src 'self' https://player.vimeo.com");
    expect(csp).toContain("frame-ancestors 'none'");
    const meta = buildConsentMetaCsp(undefined, { frame: ['player.vimeo.com'] })!;
    expect(meta).toContain('frame-src');
    expect(meta).not.toContain('frame-ancestors'); // meta ignores it
  });

  it('routes a custom integration frameOrigins into frame-src (SDK widget iframe)', () => {
    const csp = buildSiteCspHeader(consent([{ id: 'chat', name: 'Chat', category: 'functional', preset: 'custom', src: 'https://w.example.com/c.js', frameOrigins: ['*.intercom.io'] }]))!;
    expect(csp).toContain("script-src 'self' https://w.example.com");
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://*.intercom.io');
  });

  it('combines registry script-src AND author frame-src in one CSP', () => {
    const csp = buildSiteCspHeader(consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]), { frame: ['www.google.com'] })!;
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com");
    expect(csp).toContain("frame-src 'self' https://www.google.com");
  });

  it('returns undefined when neither integrations nor author origins are present', () => {
    expect(buildSiteCspHeader({ enabled: true } as Consent, {})).toBeUndefined();
    expect(buildSiteCspHeader(undefined, {})).toBeUndefined();
  });

  it('routes author <video>/<audio> origins into media-src (independently of consent.enabled)', () => {
    const csp = buildSiteCspHeader(undefined, { media: ['cdn.example.com'] })!;
    expect(csp).toContain("media-src 'self' https://cdn.example.com");
    // media-src alone is enough to widen (hasAny) — a promo video on a site with no integrations still gets a CSP.
    const meta = buildConsentMetaCsp(undefined, { media: ['cdn.example.com'] })!;
    expect(meta).toContain("media-src 'self' https://cdn.example.com");
    // …and the serve-path reconstruction from the baked meta preserves media-src.
    const html = `<meta http-equiv="Content-Security-Policy" content="${meta}">`;
    expect(siteCspHeaderFromHtml(html)).toContain("media-src 'self' https://cdn.example.com");
  });

  it('appends extraScriptSrc (preview runtime hash) ONLY to script-src, keeping publish parity otherwise', () => {
    const hash = "'sha256-DD5Sdxwuoqmw0fFyY5jbAInFyoIfiX0GX6GxtgKP0qU='";
    const meta = buildConsentMetaCsp(undefined, { frame: ['www.google.com'] }, [hash])!;
    const scriptSrc = meta.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toBe(`script-src 'self' ${hash}`); // hash lands on script-src
    expect(meta.split('; ').find((d) => d.startsWith('frame-src'))).toContain('https://www.google.com'); // frame-src untouched
    // Without the extra arg (the publish path), the meta is byte-identical — no hash leaks into published HTML.
    expect(buildConsentMetaCsp(undefined, { frame: ['www.google.com'] })).toBe(meta.replace(` ${hash}`, ''));
  });

  it('rejects an extraScriptSrc item that is not a single CSP token (directive-injection guard)', () => {
    expect(() => buildConsentMetaCsp(undefined, { frame: ['www.google.com'] }, ["'sha256-x'; default-src *"])).toThrow(/single CSP token/);
    // A clean hash literal passes.
    expect(() => buildConsentMetaCsp(undefined, { frame: ['www.google.com'] }, ["'sha256-abc123+/='"])).not.toThrow();
  });

  it('extraScriptSrc is inert when there is nothing to widen (no meta CSP at all)', () => {
    // A site with no embeds bakes NO meta CSP, so the preview runtime already runs unrestricted — the hash
    // must not conjure a CSP into existence.
    expect(buildConsentMetaCsp(undefined, {}, ["'sha256-x'"])).toBeUndefined();
  });

  it('ConsentIntegrationSchema accepts frameOrigins as bare hostnames', () => {
    expect(ConsentIntegrationSchema.safeParse({ id: 'chat', name: 'Chat', category: 'functional', preset: 'custom', src: 'https://w.example.com/c.js', frameOrigins: ['*.intercom.io', 'widget.example.com'] }).success).toBe(true);
  });

  it('WebsiteSettingsSchema accepts consent.defaultEmbedCategory', () => {
    expect(WebsiteSettingsSchema.safeParse({ consent: { enabled: true, defaultEmbedCategory: 'marketing' } }).success).toBe(true);
  });
});

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
