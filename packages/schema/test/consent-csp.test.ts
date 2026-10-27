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
  platformInjectedCspOrigins,
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
  it('reads a LAZY iframe (data-src, the lazyload runtime) into frame-src — else it renders then CSP-blocks at reveal', () => {
    expect(authorContentCspOrigins('<iframe data-src="https://www.youtube-nocookie.com/embed/x" class="skeleton loading"></iframe>').frame).toContain('www.youtube-nocookie.com');
  });
  it('reads data-src even when an inert placeholder src coexists (src="", about:blank) — attrs are independent, not ?? fallback', () => {
    expect(authorContentCspOrigins('<iframe src="" data-src="https://www.youtube-nocookie.com/embed/x"></iframe>').frame).toContain('www.youtube-nocookie.com');
    expect(authorContentCspOrigins('<iframe src="about:blank" data-src="https://www.youtube-nocookie.com/embed/x"></iframe>').frame).toContain('www.youtube-nocookie.com');
    expect(authorContentCspOrigins('<video src="/poster-placeholder.mp4" data-src="https://cdn.example.com/promo.mp4"></video>').media).toContain('cdn.example.com');
  });
  it('reads a LAZY video/source (data-src) into media-src', () => {
    expect(authorContentCspOrigins('<video data-src="https://cdn.example.com/promo.mp4"></video>').media).toContain('cdn.example.com');
    expect(authorContentCspOrigins('<video><source data-src="https://cdn.example.com/promo.mp4" type="video/mp4"></video>').media).toContain('cdn.example.com');
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

  // CSP checks EVERY hop of a frame navigation against frame-src. `maps.google.com/maps?…&output=embed`
  // answers with a redirect to `www.google.com/maps?…`, so allowing only the host the author wrote let
  // the first request through and blocked the frame at the redirect: an empty map box, nothing logged
  // anywhere the author looks.
  it('also allows the host a Google Maps embed REDIRECTS to (maps.google.com → www.google.com)', () => {
    const frame = authorContentCspOrigins('<iframe src="https://maps.google.com/maps?q=Berlin&amp;output=embed"></iframe>').frame;
    expect(frame).toEqual(expect.arrayContaining(['maps.google.com', 'www.google.com']));
    // A country domain redirects to its own www host, and the bare apex to www as well.
    expect(authorContentCspOrigins('<iframe data-src="https://maps.google.de/maps?q=x&output=embed"></iframe>').frame)
      .toEqual(expect.arrayContaining(['maps.google.de', 'www.google.de']));
    expect(authorContentCspOrigins('<iframe src="https://google.co.uk/maps/embed?pb=1"></iframe>').frame)
      .toEqual(expect.arrayContaining(['google.co.uk', 'www.google.co.uk']));
    // …and through the consent gate, which is how the embed reaches the policy on a consent site.
    expect(authorContentCspOrigins(gateAuthorIframes('<iframe src="https://maps.google.com/maps?q=a&output=embed"></iframe>')).frame)
      .toContain('www.google.com');
  });

  it('adds a redirect host ONLY for the embed hosts known to redirect — nothing else widens', () => {
    expect(authorContentCspOrigins('<iframe src="https://www.google.com/maps/embed?pb=1"></iframe>').frame).toEqual(['www.google.com']);
    expect(authorContentCspOrigins('<iframe src="https://player.vimeo.com/video/1"></iframe>').frame).toEqual(['player.vimeo.com']);
    // A look-alike is not Google: no www.google.* appears for it.
    expect(authorContentCspOrigins('<iframe src="https://maps.google.com.evil.test/maps"></iframe>').frame).toEqual(['maps.google.com.evil.test']);
    expect(authorContentCspOrigins('<iframe src="https://maps.notgoogle.com/maps"></iframe>').frame).toEqual(['maps.notgoogle.com']);
  });

  it('lands the redirect host in the frame-src of the built policy', () => {
    const header = buildSiteCspHeader(undefined, authorContentCspOrigins('<iframe src="https://maps.google.com/maps?q=a&output=embed"></iframe>'));
    expect(header).toMatch(/frame-src 'self' [^;]*https:\/\/maps\.google\.com/);
    expect(header).toMatch(/frame-src 'self' [^;]*https:\/\/www\.google\.com/);
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
  it('gates a LAZY iframe (data-src) the same as src — the lazy runtime must not bypass consent', () => {
    const out = gateAuthorIframes('<iframe data-src="https://www.youtube-nocookie.com/embed/x" class="skeleton loading" title="v"></iframe>');
    expect(out).toContain('data-sw-consent-src="https://www.youtube-nocookie.com/embed/x"');
    expect(out).not.toContain('data-src=');
    expect(out).toContain('class="skeleton loading"');
  });
  it('gates the placeholder-src + external-data-src combo (src="about:blank"/"") — the external lazy target wins, both attrs stripped', () => {
    for (const placeholder of ['about:blank', '']) {
      const out = gateAuthorIframes(`<iframe src="${placeholder}" data-src="https://www.youtube-nocookie.com/embed/x"></iframe>`);
      expect(out).toContain('data-sw-consent-src="https://www.youtube-nocookie.com/embed/x"');
      expect(out).not.toContain('data-src=');
      expect(out).not.toContain(`src="${placeholder}"`);
    }
    // both external → the lazy target (the URL the runtime would actually load) is the one held
    const both = gateAuthorIframes('<iframe src="https://player.vimeo.com/video/1" data-src="https://www.youtube-nocookie.com/embed/x"></iframe>');
    expect(both).toContain('data-sw-consent-src="https://www.youtube-nocookie.com/embed/x"');
    expect(both).not.toContain('data-src=');
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
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://w.example.com");
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://*.intercom.io');
  });

  it('combines registry script-src AND author frame-src in one CSP', () => {
    const csp = buildSiteCspHeader(consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]), { frame: ['www.google.com'] })!;
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
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
    const html = `<meta name="sw-csp" content="${meta}">`;
    expect(siteCspHeaderFromHtml(html)).toContain("media-src 'self' https://cdn.example.com");
  });

  it('appends extraScriptSrc (preview runtime hash) ONLY to script-src, keeping publish parity otherwise', () => {
    const hash = "'sha256-DD5Sdxwuoqmw0fFyY5jbAInFyoIfiX0GX6GxtgKP0qU='";
    const meta = buildConsentMetaCsp(undefined, { frame: ['www.google.com'] }, [hash])!;
    const scriptSrc = meta.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toBe(`script-src 'self' 'unsafe-inline' ${hash}`); // hash lands on script-src
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
    expect(info).toEqual({ id: 'ga', cat: 'analytics', kind: 'ga4', mid: 'G-ABC123', src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC123', async: true, ana: true });
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

  it('allows author inline JS (unsafe-inline) + only specific https origins — never unsafe-eval/*', () => {
    const csp = buildSiteCspHeader(consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]))!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://www.google-analytics.com');
    expect(csp).toContain("frame-ancestors 'none'");
    // script-src now allows the OWNER's inline JS ('unsafe-inline') — safe on the isolated published origins
    // (subdomain/export/sandboxed preview; the app origin no longer serves published pages). It must STILL
    // never relax eval or a bare wildcard, and only consent-allow-listed 3rd-party origins are added.
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toContain("'unsafe-inline'");
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
    expect(meta).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
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
    const html = `<head><meta name="sw-csp" content="${escaped}" /></head>`;
    expect(siteCspHeaderFromHtml(html)).toBe(buildSiteCspHeader(c)); // header === meta + frame-ancestors
    expect(siteCspHeaderFromHtml('<head><title>no consent</title></head>')).toBeUndefined();
  });
});

// website.cspOrigins — the author's OWN allow-list. Before it existed, widening the policy meant either
// enabling the whole consent manager (a site-wide cookie banner, just to name an origin) or planting tags
// whose only purpose was to be scanned: a `<script type="text/plain" data-sw-consent src>` for
// script/connect and an `<iframe>` inside an HTML COMMENT for frame-src.
describe('website.cspOrigins (author allow-list, independent of the consent manager)', () => {
  it('widens the policy with consent OFF and no integrations at all', () => {
    const csp = buildSiteCspHeader(undefined, {}, { frame: ['www.google.com'], connect: ['api.example.com'] })!;
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://www.google.com');
    expect(csp).toContain('https://api.example.com');
  });

  it('mirrors a script host into connect-src (a script you cannot talk to is half-configured)', () => {
    const csp = buildSiteCspHeader(undefined, {}, { script: ['www.gstatic.com' ] })!;
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    const connectSrc = csp.split('; ').find((d) => d.startsWith('connect-src'))!;
    expect(scriptSrc).toContain('https://www.gstatic.com');
    expect(connectSrc).toContain('https://www.gstatic.com');
  });

  it('covers every directive and merges alongside consent integrations', () => {
    const o = consentCspOrigins(
      consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]),
      {},
      { font: ['fonts.gstatic.com'], style: ['fonts.googleapis.com'], media: ['cdn.example.com'], frame: ['maps.google.com'] },
    );
    expect(o.font).toContain('fonts.gstatic.com');
    expect(o.style).toContain('fonts.googleapis.com');
    expect(o.media).toContain('cdn.example.com');
    expect(o.frame).toContain('maps.google.com');
    expect(o.script.some((h) => h.includes('googletagmanager'))).toBe(true); // the integration still applies
  });

  it('re-validates each host, so a malformed value can never break out of the directive', () => {
    const csp = buildSiteCspHeader(undefined, {}, { frame: ['ok.example.com', 'evil.com; script-src *', 'no spaces.com'] })!;
    expect(csp).toContain('https://ok.example.com');
    expect(csp).not.toContain('evil.com');
    expect(csp).not.toContain('no spaces.com');
  });

  it('contributes nothing when empty (a site with no third parties keeps the strict floor)', () => {
    expect(buildSiteCspHeader(undefined, {}, {})).toBeUndefined();
    expect(buildSiteCspHeader(undefined, {}, { frame: [] })).toBeUndefined();
  });
});

describe('platformInjectedCspOrigins — what the PUBLISHER puts on the page', () => {
  const routed = '<form data-sw-block="Form" data-sw-component="form" data-sw-routed data-sw-form="contact"></form>';

  it('allows the cross-origin form endpoint the publisher itself bakes in', () => {
    // THE DEFECT: the publisher bakes an ABSOLUTE `/f/` endpoint into every platform-routed form, while a
    // published site is served from `<slug>.<sitesDomain>` — a different origin — under `connect-src
    // 'self'`. The browser blocked the submit before it left, so there was no request to log and no
    // submission to store: measured on a real instance, 66 correctly-configured forms that could never send.
    const o = platformInjectedCspOrigins(routed, 'https://sitewright.example');
    expect(o.connect).toEqual(['sitewright.example']);
    expect(o.script).toEqual([]); // no captcha on this page → nothing else widened
  });

  it('widens NOTHING for a page with no platform-routed form', () => {
    expect(platformInjectedCspOrigins('<p>no forms here</p>', 'https://sitewright.example').connect).toEqual([]);
    // A contactPhp form posts same-origin to contact.php and carries no marker, so it stays strict.
    expect(platformInjectedCspOrigins('<form data-sw-component="form" data-sw-endpoint="contact.php"></form>', 'https://sitewright.example').connect).toEqual([]);
  });

  it('needs no endpoint base to be configured (a same-origin deployment widens nothing)', () => {
    expect(platformInjectedCspOrigins(routed, '').connect).toEqual([]);
    expect(platformInjectedCspOrigins(routed, undefined).connect).toEqual([]);
  });

  it('only trusts an https base, and never a malformed one', () => {
    expect(platformInjectedCspOrigins(routed, 'http://insecure.example').connect).toEqual([]);
    expect(platformInjectedCspOrigins(routed, 'not a url').connect).toEqual([]);
  });

  it('allows hCaptcha across every directive its widget needs, only when the page carries one', () => {
    // The form runtime injects the provider's script the moment a captcha-bearing form exists; it then
    // frames, calls and styles its own hosts. Miss one directive and it half-loads.
    const withCaptcha = `${routed}<form data-sw-captcha="hcaptcha"><div class="h-captcha" data-sitekey="k"></div></form>`;
    const o = platformInjectedCspOrigins(withCaptcha, 'https://sitewright.example');
    for (const d of [o.script, o.frame, o.style]) expect(d).toEqual(['hcaptcha.com', '*.hcaptcha.com']);
    expect(o.connect).toEqual(['sitewright.example', 'hcaptcha.com', '*.hcaptcha.com']);
    // …and a page without the widget keeps the strict policy.
    expect(platformInjectedCspOrigins(routed, 'https://sitewright.example').frame).toEqual([]);
  });

  it('allows the API for the cart and the thank-you panel too, which call it without a form', () => {
    // The cart posts its order form and starts a checkout; the thank-you panel reads the payment status.
    // Both were missing, so a hosted shop with no form on the page could not check out.
    const cart = '<div data-sw-cart data-currency-symbol="€"></div>';
    const status = '<div data-sw-order-status data-currency-symbol="€"><p>Thanks</p></div>';
    expect(platformInjectedCspOrigins(cart, 'https://sitewright.example').connect).toEqual(['sitewright.example']);
    expect(platformInjectedCspOrigins(status, 'https://sitewright.example').connect).toEqual(['sitewright.example']);
    // The marker must be the attribute itself, not a longer one that starts the same way.
    expect(platformInjectedCspOrigins('<div data-sw-cart-note="x"></div>', 'https://sitewright.example').connect).toEqual([]);
    expect(platformInjectedCspOrigins('<p>data-sw-cart</p>', 'https://sitewright.example').connect).toEqual([]);
    // The add-to-cart button sits on every product page; it writes to the browser and calls nothing.
    expect(platformInjectedCspOrigins('<button data-sw-cart-add data-sku="w1">Add</button>', 'https://sitewright.example').connect).toEqual([]);
    // Any whitespace before the attribute, and the attribute anywhere in the tag.
    expect(platformInjectedCspOrigins('<div\n\tdata-sw-cart\n></div>', 'https://sitewright.example').connect).toEqual(['sitewright.example']);
    expect(platformInjectedCspOrigins('<div class="x" data-sw-order-status></div>', 'https://sitewright.example').connect).toEqual(['sitewright.example']);
  });

  it('allows the captcha a cart checkout asks for, which the cart names on its mount', () => {
    const cart = '<div data-sw-cart data-captcha-provider="hcaptcha" data-captcha-sitekey="k"></div>';
    const o = platformInjectedCspOrigins(cart, 'https://sitewright.example');
    for (const d of [o.script, o.frame, o.style]) expect(d).toEqual(['hcaptcha.com', '*.hcaptcha.com']);
    expect(o.connect).toEqual(['sitewright.example', 'hcaptcha.com', '*.hcaptcha.com']);
    // Only the provider named.
    expect(platformInjectedCspOrigins(cart, 'https://sitewright.example').script).not.toContain('www.google.com');
    // Single quotes name it as well; a provider the platform does not know names nothing.
    expect(platformInjectedCspOrigins("<div data-sw-cart data-captcha-provider='recaptcha-v2'></div>", 'https://sitewright.example').script).toContain('www.google.com');
    const unknown = platformInjectedCspOrigins('<div data-sw-cart data-captcha-provider="evil.example"></div>', 'https://sitewright.example');
    expect(unknown.script).toEqual([]);
    expect(unknown.connect).toEqual(['sitewright.example']);
  });
});

describe('★ analytics presets beyond Google (Plausible, Umami, Matomo, Fathom, Simple Analytics)', () => {
  const int = (x: Record<string, unknown>): Record<string, unknown> => ({ id: 'a', name: 'A', category: 'analytics', ...x });
  const UUID = '94db1cb1-74f4-4a40-ad6c-962362670409';
  const ok = (x: Record<string, unknown>): void => expect(() => ConsentIntegrationSchema.parse(int(x)), JSON.stringify(x)).not.toThrow();
  const bad = (x: Record<string, unknown>): void => expect(() => ConsentIntegrationSchema.parse(int(x)), JSON.stringify(x)).toThrow();

  it('validates each preset’s site identifier and host', () => {
    ok({ preset: 'plausible', siteId: 'pa-AbC123_x-9' }); // the current per-site script id
    ok({ preset: 'plausible', siteId: 'example.com' }); // the legacy data-domain snippet
    ok({ preset: 'plausible', siteId: 'pa-AbC123', host: 'https://stats.example.com' }); // self-hosted
    ok({ preset: 'umami', siteId: UUID });
    ok({ preset: 'umami', siteId: UUID, host: 'https://u.example.com' });
    ok({ preset: 'matomo', siteId: '7', host: 'https://stats.example.com/matomo/' });
    ok({ preset: 'matomo', siteId: '1', host: 'https://acme.matomo.cloud' });
    ok({ preset: 'fathom', siteId: 'ABCDEFGH' });
    ok({ preset: 'simpleanalytics' }); // the page hostname identifies the site
    ok({ preset: 'simpleanalytics', siteId: 'example.com' });

    bad({ preset: 'plausible' });
    bad({ preset: 'plausible', siteId: 'not a domain!' });
    bad({ preset: 'umami', siteId: 'abc' });
    bad({ preset: 'matomo', siteId: '7' }); // a Matomo has no default host
    bad({ preset: 'matomo', siteId: 'x', host: 'https://stats.example.com' });
    bad({ preset: 'fathom', siteId: 'a b' });
    bad({ preset: 'umami', siteId: UUID, host: 'http://u.example.com' }); // https only
    bad({ preset: 'umami', siteId: UUID, host: 'https://192.168.1.2' }); // no private hosts
    bad({ preset: 'umami', siteId: UUID, host: 'https://u.example.com/?x=1' }); // a base URL, nothing else
    bad({ preset: 'fathom', siteId: 'ABCDEFGH', host: 'https://f.example.com' }); // Fathom is cloud-only
  });

  it('lets ONLY cookieless presets load without waiting for consent', () => {
    for (const x of [
      { preset: 'plausible', siteId: 'pa-AbC123' },
      { preset: 'umami', siteId: UUID },
      { preset: 'fathom', siteId: 'ABCDEFGH' },
      { preset: 'simpleanalytics' },
      { preset: 'matomo', siteId: '7', host: 'https://stats.example.com/' }, // with cookies switched off
    ])
      ok({ ...x, requireConsent: false });
    bad({ preset: 'ga4', measurementId: 'G-ABC', requireConsent: false });
    bad({ preset: 'gtm', measurementId: 'GTM-AB12', requireConsent: false });
    bad({ src: 'https://x.example/s.js', requireConsent: false }); // a custom script could set anything
  });

  it('maps each preset to the script it loads and the attributes its vendor reads', () => {
    const info = (x: Record<string, unknown>): unknown => integrationRuntimeInfo(ConsentIntegrationSchema.parse(int(x)));
    expect(info({ preset: 'plausible', siteId: 'pa-AbC123' })).toMatchObject({ kind: 'plausible', src: 'https://plausible.io/js/pa-AbC123.js' });
    expect(info({ preset: 'plausible', siteId: 'pa-AbC123', host: 'https://stats.example.com/' })).toMatchObject({ src: 'https://stats.example.com/js/pa-AbC123.js' });
    expect(info({ preset: 'plausible', siteId: 'example.com' })).toMatchObject({ kind: 'script', src: 'https://plausible.io/js/script.js', attrs: { 'data-domain': 'example.com' } });
    expect(info({ preset: 'umami', siteId: UUID })).toMatchObject({ kind: 'script', src: 'https://cloud.umami.is/script.js', attrs: { 'data-website-id': UUID } });
    expect(info({ preset: 'umami', siteId: UUID, host: 'https://u.example.com' })).toMatchObject({ src: 'https://u.example.com/script.js' });
    expect(info({ preset: 'matomo', siteId: '7', host: 'https://stats.example.com/matomo' })).toMatchObject({
      kind: 'matomo',
      mid: '7',
      src: 'https://stats.example.com/matomo/matomo.js',
      track: 'https://stats.example.com/matomo/matomo.php',
    });
    expect(info({ preset: 'matomo', siteId: '1', host: 'https://acme.matomo.cloud' })).toMatchObject({
      src: 'https://cdn.matomo.cloud/acme.matomo.cloud/matomo.js',
      track: 'https://acme.matomo.cloud/matomo.php',
    });
    expect(info({ preset: 'fathom', siteId: 'ABCDEFGH' })).toMatchObject({ kind: 'script', src: 'https://cdn.usefathom.com/script.js', attrs: { 'data-site': 'ABCDEFGH' } });
    expect(info({ preset: 'simpleanalytics' })).toMatchObject({ kind: 'script', src: 'https://scripts.simpleanalyticscdn.com/latest.js' });
    expect(info({ preset: 'simpleanalytics', siteId: 'example.com' })).toMatchObject({ attrs: { 'data-hostname': 'example.com' } });
    // Loading without consent is carried to the runtime; a cookieless Matomo also switches its cookies off.
    expect(info({ preset: 'umami', siteId: UUID, requireConsent: false })).toMatchObject({ free: true });
    expect(info({ preset: 'matomo', siteId: '7', host: 'https://s.example.com/', requireConsent: false })).toMatchObject({ free: true, nocookie: true });
    expect(info({ preset: 'umami', siteId: UUID })).not.toHaveProperty('free');
  });

  it('derives each preset’s CSP hosts (and the host Google’s current GA4 guidance adds)', () => {
    const o = (x: Record<string, unknown>) => consentCspOrigins(consent([int(x)]));
    expect(o({ preset: 'plausible', siteId: 'pa-AbC123' })).toMatchObject({ script: ['plausible.io'], connect: ['plausible.io'] });
    expect(o({ preset: 'plausible', siteId: 'pa-AbC123', host: 'https://stats.example.com' })).toMatchObject({ script: ['stats.example.com'], connect: ['stats.example.com'] });
    const umami = o({ preset: 'umami', siteId: UUID });
    expect(umami.script).toEqual(['cloud.umami.is']);
    expect(umami.connect).toEqual(expect.arrayContaining(['gateway.umami.is']));
    const matomo = o({ preset: 'matomo', siteId: '7', host: 'https://stats.example.com/matomo/' });
    expect(matomo).toMatchObject({ script: ['stats.example.com'], connect: ['stats.example.com'], img: ['stats.example.com'] });
    const cloud = o({ preset: 'matomo', siteId: '1', host: 'https://acme.matomo.cloud' });
    expect(cloud.script).toEqual(['cdn.matomo.cloud']);
    expect(cloud.connect).toEqual(['acme.matomo.cloud']);
    expect(o({ preset: 'fathom', siteId: 'ABCDEFGH' })).toMatchObject({ script: ['cdn.usefathom.com'], connect: ['cdn.usefathom.com'], img: ['cdn.usefathom.com'] });
    expect(o({ preset: 'simpleanalytics' })).toMatchObject({ script: ['scripts.simpleanalyticscdn.com'], connect: ['queue.simpleanalyticscdn.com'], img: ['queue.simpleanalyticscdn.com'] });
    expect(o({ preset: 'ga4', measurementId: 'G-X' }).connect).toEqual(expect.arrayContaining(['www.google.com', '*.google-analytics.com', 'www.googletagmanager.com']));
  });

  it('★ a cookieless integration that skips consent loads and widens the CSP with the consent manager OFF; a gated one does not', () => {
    const off = (integrations: unknown[]): Consent => ({ enabled: false, integrations } as unknown as Consent);
    const free = int({ id: 'pl', preset: 'plausible', siteId: 'pa-AbC123', requireConsent: false });
    const gated = int({ id: 'ga', preset: 'ga4', measurementId: 'G-X' });
    expect(consentCspOrigins(off([free, gated])).script).toEqual(['plausible.io']);
    expect(consentRuntimeIntegrations(off([free, gated])).map((i) => i.id)).toEqual(['pl']);
    // With the manager ON, both are present: the gated one still waits for consent at runtime.
    expect(consentRuntimeIntegrations(consent([free, gated])).map((i) => i.id)).toEqual(['pl', 'ga']);
    expect(buildSiteCspHeader(off([gated]))).toBeUndefined();
  });
});

describe('★ analytics presets — hostile input (review hardening)', () => {
  const UUID = '94db1cb1-74f4-4a40-ad6c-962362670409';
  const parse = (x: Record<string, unknown>) => ConsentIntegrationSchema.safeParse({ id: 'a', name: 'A', category: 'analytics', ...x }).success;
  /** The schema bypassed: what an import or a direct DB write could hand the builders. */
  const raw = (x: Record<string, unknown>) => ({ id: 'a', name: 'A', category: 'analytics', ...x }) as never;

  it('rejects a host with an empty query or fragment, a trailing dot, one label, an empty label or a backslash', () => {
    for (const host of ['https://a.example.com/m?', 'https://a.example.com/m#', 'https://localhost.', 'https://acme.matomo.cloud.', 'https://stats', 'https://a..example.com', 'https://a.example.com\\m', ' https://a.example.com'])
      expect(parse({ preset: 'matomo', siteId: '7', host }), host).toBe(false);
    expect(parse({ preset: 'matomo', siteId: '7', host: 'https://stats.example.com:8443/matomo' })).toBe(true); // a port is fine
  });

  it('builds URLs from the PARSED base: a raw `?` never reaches a script or tracker URL', () => {
    expect(integrationRuntimeInfo(raw({ preset: 'matomo', siteId: '7', host: 'https://a.example.com/m?' }))).toBeNull();
    expect(integrationRuntimeInfo(raw({ preset: 'matomo', siteId: '7', host: 'https://stats.example.com/m//' }))).toMatchObject({ src: 'https://stats.example.com/m/matomo.js' });
    // Matomo Cloud lives at the root of its host, whatever path was typed.
    expect(integrationRuntimeInfo(raw({ preset: 'matomo', siteId: '1', host: 'https://acme.matomo.cloud/x' }))).toMatchObject({ track: 'https://acme.matomo.cloud/matomo.php' });
  });

  it('never lets ga4/gtm/custom skip consent, even when the schema is bypassed', () => {
    const off = (i: unknown): Consent => ({ enabled: false, integrations: [i] } as unknown as Consent);
    for (const x of [
      { preset: 'ga4', measurementId: 'G-X', requireConsent: false },
      { preset: 'gtm', measurementId: 'GTM-X', requireConsent: false },
      { src: 'https://x.example/s.js', requireConsent: false },
    ]) {
      expect(integrationRuntimeInfo(raw(x)), JSON.stringify(x)).not.toHaveProperty('free');
      expect(consentRuntimeIntegrations(off(raw(x)))).toEqual([]);
      expect(buildSiteCspHeader(off(raw(x)))).toBeUndefined();
    }
  });

  it('GA4 adds www.google.com — not a wildcard over every Google host', () => {
    const o = consentCspOrigins(consent([{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }]));
    expect(o.connect).toContain('www.google.com');
    expect(o.connect).not.toContain('*.google.com');
    // …and a site without Google gets no Google host at all.
    expect(consentCspOrigins(consent([{ id: 'u', name: 'U', category: 'analytics', preset: 'umami', siteId: UUID }])).connect.join(' ')).not.toMatch(/google/);
  });

  it('an owner who types Umami Cloud’s own address still gets its collection gateway', () => {
    const o = consentCspOrigins(consent([{ id: 'u', name: 'U', category: 'analytics', preset: 'umami', siteId: UUID, host: 'https://cloud.umami.is' }]));
    expect(o.connect).toContain('gateway.umami.is');
  });
});

describe('analyticsLoaderIn — a tracker pasted into raw HTML', () => {
  it('names the analytics tool a raw snippet loads, and nothing for ordinary markup', async () => {
    const { analyticsLoaderIn } = await import('../src/consent-csp.js');
    expect(analyticsLoaderIn('<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>')).toBe('Google Analytics');
    expect(analyticsLoaderIn("<script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-X');</script><script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-X\"></script>")).toBe('Google Tag Manager');
    expect(analyticsLoaderIn('<script defer data-domain="x.com" src="https://plausible.io/js/script.js"></script>')).toBe('Plausible');
    expect(analyticsLoaderIn('<script defer src="https://cloud.umami.is/script.js" data-website-id="abc"></script>')).toBe('Umami');
    expect(analyticsLoaderIn("<script>var _paq = window._paq = window._paq || []; _paq.push(['trackPageView']);</script>")).toBe('Matomo');
    expect(analyticsLoaderIn('<script src="https://cdn.usefathom.com/script.js" data-site="ABC" defer></script>')).toBe('Fathom');
    expect(analyticsLoaderIn('<script async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>')).toBe('Simple Analytics');
    expect(analyticsLoaderIn('<meta name="google-site-verification" content="x">')).toBeNull();
    expect(analyticsLoaderIn(undefined)).toBeNull();
    // A gated script is fine: the runtime only releases it after consent.
    expect(analyticsLoaderIn('<script type="text/plain" data-sw-consent="analytics" src="https://plausible.io/js/script.js"></script>')).toBeNull();
    expect(analyticsLoaderIn('<SCRIPT TYPE=text/plain data-sw-consent="analytics" src="https://plausible.io/js/script.js"></SCRIPT>')).toBeNull();
  });

  it('★ does not cry wolf over ordinary markup that merely mentions a tracker-like word', async () => {
    const { analyticsLoaderIn } = await import('../src/consent-csp.js');
    for (const html of [
      '<a class="gtm-button" data-gtm-event="x">Buy</a>',
      '<p>Ref GTM-2024 order, a plausible plan</p>',
      '<div data-website-id="abc"></div>', // another widget's attribute, not on a script
      '<p>The _paq queue is documented elsewhere.</p>',
      '<!-- old: <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script> -->',
    ])
      expect(analyticsLoaderIn(html), html).toBeNull();
  });

  it('★ is not fooled by a data-type attribute or a malformed gated tag swallowing a real tracker', async () => {
    const { analyticsLoaderIn } = await import('../src/consent-csp.js');
    // data-type is not type: this script RUNS.
    expect(analyticsLoaderIn('<script data-type="text/plain" src="https://plausible.io/js/script.js"></script>')).toBe('Plausible');
    // An unclosed gated tag must not eat the live tracker that follows it.
    expect(analyticsLoaderIn('<script type="text/plain" src="x"><script src="https://plausible.io/js/script.js"></script>')).toBe('Plausible');
    // The common snippets the first version missed.
    expect(analyticsLoaderIn("<script>ga('create', 'UA-1-1', 'auto');</script>")).toBe('Google Analytics');
    expect(analyticsLoaderIn('<script defer data-domain="x.com" src="/js/script.js"></script>')).toBe('Plausible'); // a proxied Plausible
    // Linear on pathological input (the old lazy scan was quadratic: ~0.4 s at this size).
    const t = Date.now();
    analyticsLoaderIn('<script type="text/plain">'.repeat(10_000));
    expect(Date.now() - t).toBeLessThan(150);
  });
});
