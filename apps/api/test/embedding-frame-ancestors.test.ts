import { describe, it, expect, afterEach } from 'vitest';
import { FrameAncestorOriginSchema, frameAncestorsFor, EmbeddingSchema } from '@sitewright/schema';
import { makeHarness, type Harness } from './harness.js';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** PUTs an embedding policy as a fresh instance admin. */
async function setEmbedding(h: Harness, embedding: unknown): Promise<void> {
  const admin = await h.signup({ admin: true });
  const res = await admin.put('/admin/settings', { embedding });
  if (res.statusCode !== 200) throw new Error(`set embedding failed (${res.statusCode}): ${res.body}`);
}

/** The framing-relevant headers of a plain app response. */
async function framingHeaders(h: Harness, url = '/health'): Promise<{ csp: string; xfo: string | undefined }> {
  const res = await h.app.inject({ method: 'GET', url });
  return {
    csp: String(res.headers['content-security-policy'] ?? ''),
    xfo: res.headers['x-frame-options'] as string | undefined,
  };
}

describe('FrameAncestorOriginSchema — the value goes straight into a CSP header', () => {
  it('accepts an ordinary origin, a port, and a single wildcard label', () => {
    for (const ok of ['https://portal.example.com', 'http://localhost:3000', 'https://*.example.com', 'https://10.0.0.4:8080']) {
      expect(FrameAncestorOriginSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  // ★ The whole point of the schema. A CSP header is `;`-separated directives whose sources are
  // SPACE-separated — so a value carrying either is not "invalid input" to a browser, it is EXTRA
  // POLICY. Each of these would rewrite the served policy if the field were a loose z.string().url().
  it('rejects anything that could inject additional CSP', () => {
    const attacks = [
      "https://evil.test; default-src *",
      'https://evil.test https://also-evil.test',
      "https://evil.test'",
      'https://evil.test,https://x.test',
      'https://evil.test\nx-injected: 1',
      'https://evil.test\r\nSet-Cookie: a=b',
      'https://evil.test\tmore',
    ];
    for (const bad of attacks) {
      expect(FrameAncestorOriginSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejects a bare wildcard, other schemes, paths, credentials and a schemeless host', () => {
    const bad = [
      '*',
      'https://*',
      'data:',
      'javascript:alert(1)',
      'blob:https://x.test',
      'https://example.com/embed', // path
      'https://example.com/', // trailing slash is still a path
      'https://example.com?a=1',
      'https://example.com#f',
      'https://user:pw@example.com',
      'example.com', // no scheme
      'ftp://example.com',
      'https://*.*.example.com', // only ONE leading wildcard label
      'https://example.com:70000', // port out of range
    ];
    for (const v of bad) {
      expect(FrameAncestorOriginSchema.safeParse(v).success, v).toBe(false);
    }
  });
});

describe('frameAncestorsFor', () => {
  const parse = (v: unknown) => EmbeddingSchema.parse(v);

  it('is null unless enabled with at least one source', () => {
    expect(frameAncestorsFor(undefined)).toBeNull();
    expect(frameAncestorsFor(parse({ enabled: false, origins: ['https://a.test'] }))).toBeNull();
    // ★ Enabled but EMPTY collapses back to denied. An empty join would emit `frame-ancestors ` with
    // no source — a malformed directive — and the safe reading of "allow nobody" is to deny.
    expect(frameAncestorsFor(parse({ enabled: true, origins: [] }))).toBeNull();
  });

  it('joins origins with spaces and prepends \'self\' only when asked', () => {
    expect(frameAncestorsFor(parse({ enabled: true, origins: ['https://a.test', 'https://b.test'] }))).toBe(
      'https://a.test https://b.test',
    );
    expect(frameAncestorsFor(parse({ enabled: true, origins: ['https://a.test'], allowSelf: true }))).toBe(
      "'self' https://a.test",
    );
    expect(frameAncestorsFor(parse({ enabled: true, origins: [], allowSelf: true }))).toBe("'self'");
  });
});

describe('the SPA shell CSP', () => {
  it('★ allows blob: images — the Image Editor cannot open a dropped file without it', async () => {
    // REGRESSION. A dropped file has no URL, so the editor shows it via URL.createObjectURL. With
    // `img-src 'self' data: https:` the browser blocked that load and drag-and-drop import was dead,
    // reported to the author only as "That image could not be read". Nothing caught it: jsdom
    // enforces no CSP, so every unit test passed against a broken feature, and there are TWO
    // editor-surface policies — fixing the other one changed nothing, because THIS is the document
    // the SPA actually runs under.
    harness = await makeHarness();
    const { csp } = await framingHeaders(harness);
    expect(csp).toMatch(/img-src [^;]*\bblob:/);
  });
});

describe('framing headers on the app origin', () => {
  it('denies framing by default (frame-ancestors none + XFO DENY)', async () => {
    harness = await makeHarness();
    const { csp, xfo } = await framingHeaders(harness);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(xfo).toBe('DENY');
  });

  it('serves the allowlist and DROPS X-Frame-Options once embedding is enabled', async () => {
    harness = await makeHarness();
    await setEmbedding(harness, { enabled: true, origins: ['https://portal.example.com'] });
    const { csp, xfo } = await framingHeaders(harness);
    expect(csp).toContain('frame-ancestors https://portal.example.com');
    expect(csp).not.toContain("frame-ancestors 'none'");
    // XFO cannot express a list; leaving DENY would contradict the CSP and block the embed anyway.
    expect(xfo).toBeUndefined();
  });

  it('takes effect WITHOUT a restart, and reverts when cleared', async () => {
    harness = await makeHarness();
    const admin = await harness.signup({ admin: true });
    expect((await framingHeaders(harness)).xfo).toBe('DENY');

    expect((await admin.put('/admin/settings', { embedding: { enabled: true, origins: ['https://a.test'] } })).statusCode).toBe(200);
    expect((await framingHeaders(harness)).csp).toContain('frame-ancestors https://a.test');

    // `null` clears the section → back to denied.
    expect((await admin.put('/admin/settings', { embedding: null })).statusCode).toBe(200);
    const after = await framingHeaders(harness);
    expect(after.csp).toContain("frame-ancestors 'none'");
    expect(after.xfo).toBe('DENY');
  });

  it('enabled with an EMPTY allowlist still denies (no half-open policy)', async () => {
    harness = await makeHarness();
    await setEmbedding(harness, { enabled: true, origins: [] });
    const { csp, xfo } = await framingHeaders(harness);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(xfo).toBe('DENY');
  });

  it('rejects an injection attempt at the API boundary (400), leaving the policy untouched', async () => {
    harness = await makeHarness();
    const admin = await harness.signup({ admin: true });
    const res = await admin.put('/admin/settings', {
      embedding: { enabled: true, origins: ['https://evil.test; default-src *'] },
    });
    expect(res.statusCode).toBe(400);
    const { csp, xfo } = await framingHeaders(harness);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(xfo).toBe('DENY');
  });

  // Allowing the ADMIN PANEL to be framed must never make every tenant's published site framable as
  // a side effect. Both spellings of "a served client site" are covered: the `/sites/<slug>/` path
  // form and the `<slug>.<sitesDomain>` subdomain form. The subdomain half needs `sitesDomain`
  // CONFIGURED — without it `siteSubdomainSlug` returns null for every host and the assertion passes
  // vacuously (measured: it did, before this harness option was added).
  it('does NOT loosen framing for a locally-hosted client site — /sites/ path form', async () => {
    harness = await makeHarness();
    await setEmbedding(harness, { enabled: true, origins: ['https://portal.example.com'] });
    const res = await harness.app.inject({ method: 'GET', url: '/sites/nonexistent-slug/' });
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(res.headers['content-security-policy'])).not.toContain('portal.example.com');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('does NOT loosen framing for a locally-hosted client site — <slug>.<sitesDomain> form', async () => {
    harness = await makeHarness({ sitesDomain: 'sites.example' });
    await setEmbedding(harness, { enabled: true, origins: ['https://portal.example.com'] });
    const site = await harness.app.inject({ method: 'GET', url: '/', headers: { host: 'someslug.sites.example' } });
    expect(String(site.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(site.headers['content-security-policy'])).not.toContain('portal.example.com');
    expect(site.headers['x-frame-options']).toBe('DENY');

    // …while the APP origin on the same instance still gets the allowlist.
    const app = await harness.app.inject({ method: 'GET', url: '/health', headers: { host: 'admin.example' } });
    expect(String(app.headers['content-security-policy'])).toContain('frame-ancestors https://portal.example.com');
    expect(app.headers['x-frame-options']).toBeUndefined();
  });
});
