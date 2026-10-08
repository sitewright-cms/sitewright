import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  normalizePlatformOrigin,
  dedupeAdditionalOrigins,
  validateAdditionalOrigins,
} from '../src/http/platform-origins.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

const CANONICAL = 'https://cms.agency.com';
const SECOND = 'https://edit.clientbrand.com';

describe('platform origins — normalization', () => {
  it('lowercases the host, drops a default port, and strips path/trailing slash', () => {
    expect(normalizePlatformOrigin('HTTPS://CMS.Agency.com/')).toBe('https://cms.agency.com');
    expect(normalizePlatformOrigin('https://cms.agency.com:443')).toBe('https://cms.agency.com');
    expect(normalizePlatformOrigin('http://localhost:80')).toBe('http://localhost');
    expect(normalizePlatformOrigin('https://cms.agency.com/some/path')).toBe('https://cms.agency.com');
  });

  it('keeps a NON-default port, which is what distinguishes a dev host from the real one', () => {
    expect(normalizePlatformOrigin('http://dind.local:2003')).toBe('http://dind.local:2003');
  });

  it('refuses anything that is not an http(s) origin', () => {
    for (const bad of ['', '   ', 'cms.agency.com', 'ftp://cms.agency.com', 'javascript:alert(1)']) {
      expect(normalizePlatformOrigin(bad)).toBeNull();
    }
  });
});

describe('platform origins — validation refuses the two silent self-inflicted failures', () => {
  it('refuses an origin on the other scheme (cookies are Secure instance-wide or not at all)', () => {
    const reason = validateAdditionalOrigins(['http://edit.clientbrand.com'], { canonical: CANONICAL });
    expect(reason).toMatch(/must use https:\/\//);
  });

  it('accepts a matching scheme', () => {
    expect(validateAdditionalOrigins([SECOND], { canonical: CANONICAL })).toBeNull();
  });

  it('★ refuses an origin inside the hosted-sites domain, which would make the app unreachable there', () => {
    // A Host ending in `.sites.agency.com` is rewritten BEFORE routing into `/sites/<label>/…`, so this
    // origin would never reach the app at all — the admin panel included. One click, no way back.
    const reason = validateAdditionalOrigins(['https://edit.sites.agency.com'], {
      canonical: CANONICAL,
      sitesDomain: 'sites.agency.com',
    });
    expect(reason).toMatch(/hosted-sites domain/);
  });

  it('allows the sites-domain APEX itself (only `<label>.<domain>` is captured by the rewrite)', () => {
    expect(validateAdditionalOrigins(['https://sites.agency.com'], { canonical: CANONICAL, sitesDomain: 'sites.agency.com' })).toBeNull();
  });

  it('allows any scheme when no canonical origin is configured', () => {
    expect(validateAdditionalOrigins(['http://a.test', 'http://b.test'], {})).toBeNull();
  });

  it('dedupes, normalizes, and drops a repeat of the canonical origin', () => {
    expect(dedupeAdditionalOrigins([CANONICAL, SECOND, 'HTTPS://edit.clientbrand.com/', SECOND], CANONICAL)).toEqual([SECOND]);
  });
});

describe('multi-hostname platform access (end to end)', () => {
  let harness: Harness;
  let admin: TestClient;

  /** Boots an instance whose canonical origin is CANONICAL. */
  async function boot(): Promise<void> {
    harness = await makeHarness({ encryptionKey: randomBytes(32), publicUrl: CANONICAL });
    admin = await harness.signup({ admin: true });
  }

  /** Approves an additional origin through the real admin route. */
  async function approve(...origins: string[]) {
    return admin.put('/admin/settings', { additionalOrigins: origins });
  }

  beforeEach(boot);
  afterEach(async () => {
    await harness.close();
  });

  // ── the WebAuthn relying party ────────────────────────────────────────────────────────────────────

  it('single-origin behaviour is UNCHANGED: the canonical host is the relying party', async () => {
    // This is what the old config-level derivation guaranteed. It must still hold, or moving the
    // derivation into createApp silently changed every existing single-host instance.
    const opts = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'cms.agency.com', 'x-forwarded-proto': 'https' } });
    expect(opts.statusCode).toBe(200);
    expect(opts.json().options.rp.id).toBe('cms.agency.com');
  });

  it('an UNAPPROVED Host falls back to the canonical relying party rather than minting its own', async () => {
    // A spoofed Host must not be able to steer the rpID: the credential would bind to an rpID the
    // operator never approved. Falling back to the canonical origin makes the ceremony fail cleanly.
    const opts = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'evil.example.net', 'x-forwarded-proto': 'https' } });
    expect(opts.json().options.rp.id).toBe('cms.agency.com');
  });

  it('an APPROVED second hostname becomes its own relying party', async () => {
    expect((await approve(SECOND)).statusCode).toBe(200);
    const opts = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'edit.clientbrand.com', 'x-forwarded-proto': 'https' } });
    expect(opts.json().options.rp.id).toBe('edit.clientbrand.com');
    // …and the canonical host still resolves to itself.
    const canonical = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'cms.agency.com', 'x-forwarded-proto': 'https' } });
    expect(canonical.json().options.rp.id).toBe('cms.agency.com');
  });

  it('approval applies LIVE — no restart between the settings write and the next request', async () => {
    const before = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'edit.clientbrand.com', 'x-forwarded-proto': 'https' } });
    expect(before.json().options.rp.id).toBe('cms.agency.com');
    await approve(SECOND);
    const after = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'edit.clientbrand.com', 'x-forwarded-proto': 'https' } });
    expect(after.json().options.rp.id).toBe('edit.clientbrand.com');
  });

  it('an explicit SW_WEBAUTHN_RP_ID pin still derives its ORIGIN from the forwarded host', async () => {
    // Setting only the rpID must not leave the expected ORIGIN pointing at the proxy→app hop: the
    // browser sent https://cms.agency.com, so a `http://localhost` expectation fails every ceremony.
    const pinned = await makeHarness({ encryptionKey: randomBytes(32), publicUrl: CANONICAL, webauthnRpId: 'agency.com' });
    try {
      const client = await pinned.signup({ admin: true });
      const opts = await client.inject({
        method: 'POST',
        url: '/account/passkeys/register/options',
        headers: { host: 'internal-app:2002', 'x-forwarded-host': 'cms.agency.com', 'x-forwarded-proto': 'https' },
      });
      expect(opts.statusCode).toBe(200);
      expect(opts.json().options.rp.id).toBe('agency.com');
    } finally {
      await pinned.close();
    }
  });

  // ── the OAuth / MCP issuer ────────────────────────────────────────────────────────────────────────

  it('the OAuth issuer is the approved origin a request arrived on, else the canonical one', async () => {
    await approve(SECOND);
    const onSecond = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: { host: 'edit.clientbrand.com', 'x-forwarded-proto': 'https' } });
    expect(onSecond.json().issuer).toBe(SECOND);

    const onCanonical = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: { host: 'cms.agency.com', 'x-forwarded-proto': 'https' } });
    expect(onCanonical.json().issuer).toBe(CANONICAL);

    // ★ An unapproved Host must NOT become an issuer: a client that pinned the canonical issuer would
    // otherwise be handed a different one by anyone who can set a header.
    const onStranger = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: { host: 'evil.example.net', 'x-forwarded-proto': 'https' } });
    expect(onStranger.json().issuer).toBe(CANONICAL);
  });

  // ── security.txt ──────────────────────────────────────────────────────────────────────────────────

  it('security.txt names every configured origin, canonical first, and nothing from the request', async () => {
    await approve(SECOND);
    const res = await harness.app.inject({ method: 'GET', url: '/.well-known/security.txt', headers: { host: 'evil.example.net' } });
    const body = res.body;
    expect(body).toContain(`Canonical: ${CANONICAL}/.well-known/security.txt`);
    expect(body).toContain(`Canonical: ${SECOND}/.well-known/security.txt`);
    expect(body).not.toContain('evil.example.net');
  });

  // ── the settings route ────────────────────────────────────────────────────────────────────────────

  it('refuses a mixed-scheme origin with a 400 and leaves the stored list alone', async () => {
    await approve(SECOND);
    const bad = await approve(SECOND, 'http://insecure.clientbrand.com');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/must use https:\/\//);

    const settings = (await admin.get('/admin/settings')).json().settings;
    expect(settings.additionalOrigins).toEqual([SECOND]);
  });

  it('stores origins normalized + deduped, and `null` clears the list back to single-origin', async () => {
    await approve('HTTPS://Edit.ClientBrand.com/', SECOND, CANONICAL);
    expect((await admin.get('/admin/settings')).json().settings.additionalOrigins).toEqual([SECOND]);

    await admin.put('/admin/settings', { additionalOrigins: null });
    expect((await admin.get('/admin/settings')).json().settings.additionalOrigins).toBeUndefined();
    // …and the second host stops being its own relying party.
    const opts = await admin.inject({ method: 'POST', url: '/account/passkeys/register/options', headers: { host: 'edit.clientbrand.com', 'x-forwarded-proto': 'https' } });
    expect(opts.json().options.rp.id).toBe('cms.agency.com');
  });

  it('is admin-only — a plain member cannot approve an origin', async () => {
    const member = await harness.signup();
    const res = await member.put('/admin/settings', { additionalOrigins: [SECOND] });
    expect(res.statusCode).toBe(403);
  });
});
