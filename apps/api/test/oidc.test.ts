import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The OIDC protocol mechanics (discovery, PKCE, ID-token signature/nonce/state validation) are
// openid-client's job; here we mock our thin wrapper to return controlled state/claims so the
// route + provisioning logic (existing-or-invited policy, TOTP gate, CSRF state) is deterministic.
const { startOidcAuth, completeOidcAuth } = vi.hoisted(() => ({ startOidcAuth: vi.fn(), completeOidcAuth: vi.fn() }));
vi.mock('../src/auth/oidc.js', async () => {
  const actual = await vi.importActual<typeof import('../src/auth/oidc.js')>('../src/auth/oidc.js');
  return {
    ...actual,
    startOidcAuth: (...a: unknown[]) => startOidcAuth(...a),
    completeOidcAuth: (...a: unknown[]) => completeOidcAuth(...a),
  };
});

import { OidcError } from '../src/auth/oidc.js';
import { makeHarness, sessionToken, type Harness, type TestClient } from './harness.js';

const SESSION_COOKIE = 'sw_session';
const ISSUER = 'https://accounts.example.com';
const hasSessionCookie = (res: { cookies: { name: string }[] }) => res.cookies.some((c) => c.name === SESSION_COOKIE);

describe('OIDC single sign-on', () => {
  let harness: Harness;
  let admin: TestClient;

  beforeEach(async () => {
    harness = await makeHarness({ encryptionKey: randomBytes(32), authRateMax: 500, adminEmails: ['admin@test.local'] });
    admin = await harness.signup({ email: 'admin@test.local', password: 'pw-secret-1' });
    // Configure one enabled provider (the secret is encrypted at rest).
    const res = await admin.put('/admin/settings', {
      oidcProviders: [{ id: 'acme', label: 'Acme SSO', issuer: ISSUER, clientId: 'client-1', clientSecret: 'shh', enabled: true }],
    });
    expect(res.statusCode).toBe(200);
    startOidcAuth.mockReset();
    completeOidcAuth.mockReset();
    startOidcAuth.mockResolvedValue({ url: 'https://idp.example/authorize?x=1', state: 'STATE1', nonce: 'N1', codeVerifier: 'V1' });
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Runs /start (persisting the state) then /callback with the given claims; returns the callback res. */
  async function login(claims: { iss?: string; sub: string; email: string | null; emailVerified: boolean }) {
    const start = await harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/start' });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toBe('https://idp.example/authorize?x=1');
    completeOidcAuth.mockResolvedValue({ iss: claims.iss ?? ISSUER, sub: claims.sub, email: claims.email, emailVerified: claims.emailVerified });
    return harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/callback?state=STATE1&code=abc' });
  }

  it('admin settings: stores the provider, masks the secret, and lists it at /auth/config', async () => {
    const settings = (await admin.get('/admin/settings')).json().settings;
    expect(settings.oidcProviders).toHaveLength(1);
    expect(settings.oidcProviders[0]).toMatchObject({ id: 'acme', label: 'Acme SSO', issuer: ISSUER, clientId: 'client-1', enabled: true, hasClientSecret: true });
    expect(settings.oidcProviders[0].clientSecret).toBeUndefined(); // never echoed

    // /auth/config is unauthenticated and exposes only id + label.
    const cfg = await harness.app.inject({ method: 'GET', url: '/auth/config' });
    expect(cfg.json().oidcProviders).toEqual([{ id: 'acme', label: 'Acme SSO' }]);
  });

  it('signs in an EXISTING account by verified email and links the identity', async () => {
    const user = await harness.signup({ email: 'member@test.local', password: 'pw-secret-1' });
    const res = await login({ sub: 'sub-1', email: 'member@test.local', emailVerified: true });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(hasSessionCookie(res)).toBe(true);
    const token = sessionToken(res);
    expect((await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token } })).json().userId).toBe(user.userId);
  });

  it('re-logs in by the durable (issuer, subject) identity even if the IdP email changed', async () => {
    await harness.signup({ email: 'member@test.local', password: 'pw-secret-1' });
    await login({ sub: 'sub-1', email: 'member@test.local', emailVerified: true }); // first link
    // Second login: same sub, a DIFFERENT (unverified, unknown) email — still resolves via identity.
    const res = await login({ sub: 'sub-1', email: 'changed@elsewhere.test', emailVerified: false });
    expect(res.statusCode).toBe(302);
    expect(hasSessionCookie(res)).toBe(true);
  });

  it('provisions a passwordless account when a pending invite exists, materializing the invite', async () => {
    await admin.post('/admin/invites', { email: 'invitee@test.local' });
    const res = await login({ sub: 'sub-2', email: 'invitee@test.local', emailVerified: true });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(hasSessionCookie(res)).toBe(true);
    // The provisioned user is signed in and (from the developer invite) is now platform staff.
    const me = (await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: sessionToken(res) } })).json();
    expect(me.platformRole).toBe('developer');
  });

  it('denies an unknown email with no invite (existing-or-invited only)', async () => {
    const res = await login({ sub: 'sub-3', email: 'stranger@test.local', emailVerified: true });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/?oidc_error=not_provisioned');
    expect(hasSessionCookie(res)).toBe(false);
  });

  it('rejects an unverified email (no linking/provisioning on email_verified=false)', async () => {
    await harness.signup({ email: 'member@test.local', password: 'pw-secret-1' });
    const res = await login({ sub: 'sub-4', email: 'member@test.local', emailVerified: false });
    expect(res.headers.location).toBe('/?oidc_error=email_unverified');
    expect(hasSessionCookie(res)).toBe(false);
  });

  it('gates TOTP on top: an OIDC sign-in for a TOTP-enabled user returns a ticket, not a session', async () => {
    const user = await harness.signup({ email: 'mfa@test.local', password: 'pw-secret-1' });
    const { authenticator } = await import('otplib');
    const { secret } = (await user.post('/account/mfa/totp/setup')).json() as { secret: string };
    await user.post('/account/mfa/totp/confirm', { code: authenticator.generate(secret) });

    const res = await login({ sub: 'sub-5', email: 'mfa@test.local', emailVerified: true });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/\?mfa_ticket=/);
    expect(hasSessionCookie(res)).toBe(false);
  });

  it('rejects a missing or unknown state (CSRF), and is single-use', async () => {
    // Missing state.
    const noState = await harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/callback?code=abc' });
    expect(noState.headers.location).toBe('/?oidc_error=invalid_state');
    // Unknown state (never issued).
    const bad = await harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/callback?state=NOPE&code=abc' });
    expect(bad.headers.location).toBe('/?oidc_error=invalid_state');

    // Single-use: a valid state works once, then is rejected on replay.
    await harness.signup({ email: 'member@test.local', password: 'pw-secret-1' });
    const ok = await login({ sub: 'sub-6', email: 'member@test.local', emailVerified: true });
    expect(ok.statusCode).toBe(302);
    completeOidcAuth.mockResolvedValue({ iss: ISSUER, sub: 'sub-6', email: 'member@test.local', emailVerified: true });
    const replay = await harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/callback?state=STATE1&code=abc' });
    expect(replay.headers.location).toBe('/?oidc_error=invalid_state');
  });

  it('surfaces a token/ID-token validation failure as a generic error', async () => {
    await harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/start' });
    completeOidcAuth.mockRejectedValue(new OidcError('exchange', 'bad signature'));
    const res = await harness.app.inject({ method: 'GET', url: '/auth/oidc/acme/callback?state=STATE1&code=abc' });
    expect(res.headers.location).toBe('/?oidc_error=verification_failed');
  });

  it('redirects unknown providers (start + callback) without leaking detail', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/auth/oidc/nope/start' })).headers.location).toBe('/?oidc_error=unknown_provider');
    expect((await harness.app.inject({ method: 'GET', url: '/auth/oidc/nope/callback?state=x' })).headers.location).toBe('/?oidc_error=unknown_provider');
  });
});
