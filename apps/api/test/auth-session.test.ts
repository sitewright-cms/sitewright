import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { createInvite } from '../src/repo/invites.js';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';

const SESSION_COOKIE = 'sw_session';

/** Returns the Set-Cookie entry for the session cookie (parsed by light-my-request). */
function sessionCookie(res: LightMyRequestResponse, name = SESSION_COOKIE) {
  const c = res.cookies.find((c) => c.name === name);
  if (!c) throw new Error(`no ${name} Set-Cookie (status ${res.statusCode})`);
  return c;
}
function tokenOf(res: LightMyRequestResponse, name = SESSION_COOKIE): string {
  return sessionCookie(res, name).value;
}

/**
 * HTTP-layer auth + session lifecycle and cookie-security coverage.
 *
 * Complements:
 *  - sessions.test.ts  — unit-level createSession/validateSession/revokeSession.
 *  - accounts.test.ts  — repo-level register/login/conflict semantics.
 *  - rate-limit.test.ts — the 429 cap on /auth/login.
 *
 * This suite exercises the actual /auth/* + /me HTTP contracts end-to-end:
 * status codes, the Set-Cookie security attributes, cookie-driven session
 * invalidation on logout, tamper-resistance, and request-body validation.
 *
 * Registration is INVITATION-ONLY now: a fresh email may only register if it holds a pending invite.
 * Each test seeds a platform admin (the inviter) directly via the repo, mints a pending invite for
 * the email under test (`invite()`), and then drives `POST /auth/register` against the real route.
 */
describe('auth + session lifecycle (HTTP)', () => {
  let app: FastifyInstance;
  let db: Database;
  let inviterId: string;

  beforeEach(async () => {
    db = await makeTestDb();
    app = await createApp({ db });
    await app.ready();
    // The seeded admin is the inviter for every minted invite (invites.invited_by is a NOT NULL FK).
    inviterId = (await registerAccount(db, `admin-${randomUUID()}@test.local`, 'Pw-secret-1', { platformRole: 'admin' })).userId;
  });

  afterEach(async () => {
    await app.close();
  });

  /** Mints a pending platform (developer) invite so `email` may register. */
  const invite = (email: string) => createInvite(db, inviterId, { email, role: 'developer' });
  const register = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/auth/register', payload });
  const loginReq = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/auth/login', payload });

  // 1. Duplicate email + normalization -------------------------------------
  it('rejects registering a duplicate email with 409 (case-insensitive)', async () => {
    const email = `dup-${randomUUID()}@test.local`;
    await invite(email);
    const first = await register({ email, password: 'Pw-secret-1'});
    expect(first.statusCode).toBe(201);

    // Same address in a different case must collide, because registerAccount
    // normalizes via email.toLowerCase() before the uniqueness check. (Surrounding
    // whitespace can't be tested here: z.string().email() rejects it at the HTTP
    // boundary with a 400 before the repo's .trim() runs.) Re-mint the invite for the
    // variant — re-inviting the same recipient refreshes a single live token.
    const variant = email.toUpperCase();
    await invite(variant);
    const dup = await register({ email: variant, password: 'Pw-secret-1'});
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: expect.any(String) });
    // A conflict must not mint a session cookie.
    expect(dup.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  // 2. Login failures (no user enumeration) --------------------------------
  it('returns 401 for a wrong password and an unknown email, indistinguishably', async () => {
    const email = `enum-${randomUUID()}@test.local`;
    await invite(email);
    expect((await register({ email, password: 'Pw-secret-1'})).statusCode).toBe(
      201,
    );

    const wrongPw = await loginReq({ email, password: 'totally-wrong' });
    const unknown = await loginReq({ email: `nobody-${randomUUID()}@test.local`, password: 'x-pw' });

    expect(wrongPw.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    // Same generic body for both → no account-enumeration oracle.
    expect(wrongPw.json()).toEqual(unknown.json());
    // Neither failure sets a session cookie.
    expect(wrongPw.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect(unknown.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('logs in successfully with correct credentials and a differently-cased email', async () => {
    const email = `ok-${randomUUID()}@test.local`;
    await invite(email);
    const reg = await register({ email, password: 'Pw-secret-1'});
    const { userId } = reg.json() as { userId: string };

    // Mixed-case email still authenticates against the stored normalized one
    // (login lowercases before lookup). No surrounding whitespace: the email
    // schema would 400 on that before login() runs.
    const res = await loginReq({ email: email.toUpperCase(), password: 'Pw-secret-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId });
    expect(tokenOf(res)).toBeTruthy();
  });

  // 3. Cookie security attributes ------------------------------------------
  it('sets an HttpOnly, SameSite session cookie that is not Secure over plain HTTP', async () => {
    const email = `cookie-${randomUUID()}@test.local`;
    await invite(email);
    const res = await register({ email, password: 'Pw-secret-1' });
    expect(res.statusCode).toBe(201);

    const cookie = sessionCookie(res);
    expect(cookie.value).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    // Route sets sameSite: 'strict'; the header serializes to SameSite=Strict.
    expect(String(cookie.sameSite).toLowerCase()).toBe('strict');
    expect(cookie.path).toBe('/');
    // Dev / DinD runs over plain HTTP (secureCookies defaults to false) so the
    // Secure flag must be absent — otherwise the browser would drop the cookie.
    expect(cookie.secure ?? false).toBe(false);
    // A session cookie should have a future expiry (7-day session window).
    expect(cookie.expires instanceof Date).toBe(true);
    expect((cookie.expires as Date).getTime()).toBeGreaterThan(Date.now());

    // Raw header cross-check that the security flags actually landed on the wire.
    const setCookie = res.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
    expect(header.toLowerCase()).toContain('httponly');
    expect(header.toLowerCase()).toContain('samesite=strict');
    expect(header.toLowerCase()).not.toContain('secure');
  });

  // 4. Logout invalidates the session --------------------------------------
  it('invalidates the session on logout: the same cookie is rejected by /me afterwards', async () => {
    // Seed an account directly (the register route is invite-only) and log in for a session.
    const email = `logout-${randomUUID()}@test.local`;
    const { userId } = await registerAccount(db, email, 'Pw-secret-1');
    const token = tokenOf(await loginReq({ email, password: 'Pw-secret-1' }));

    // The cookie works before logout.
    const before = await app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token } });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ userId });

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(logout.statusCode).toBe(204);
    // Logout must emit a clearing Set-Cookie (empty value, past expiry).
    const cleared = logout.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared, 'logout must emit a clearing Set-Cookie').toBeDefined();
    expect(cleared?.value).toBe('');

    // Reusing the (now server-side revoked) token must fail — proves the session
    // record was deleted, not merely the browser cookie cleared.
    const after = await app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token } });
    expect(after.statusCode).toBe(401);
  });

  it('treats logout without a session as a no-op (idempotent 204)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
  });

  // 5. Tampered / garbage cookie -> 401, never 500 --------------------------
  it('rejects a tampered/garbage session cookie with 401 (not 500)', async () => {
    for (const bogus of ['not-a-real-token', `${randomUUID()}-tampered`, 'a'.repeat(256)]) {
      const res = await app.inject({
        method: 'GET',
        url: '/me',
        cookies: { [SESSION_COOKIE]: bogus },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('requires authentication for /me when no cookie is present (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  // 6. Registration input validation ---------------------------------------
  it('rejects a too-short password (<8) with 400', async () => {
    const email = `weak-${randomUUID()}@test.local`;
    await invite(email);
    const res = await register({
      email,
      password: 'short7!', // 7 chars
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid request' });
  });

  it('rejects an invalid email with 400', async () => {
    const res = await register({
      email: 'not-an-email',
      password: 'Pw-secret-1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid request' });
  });
});

// Session-cookie hardening: on an HTTPS instance the session cookie is renamed with the `__Host-`
// prefix, which makes browsers refuse to set that name WITH a `Domain` attribute — so a locally-hosted
// site at `<slug>.<sitesDomain>` (same registrable domain as the app, now able to run foreign JS) can't
// shadow or fixate the session via cookie-tossing. Over plain HTTP the prefix can't be used (it
// requires `Secure`), so the bare name is kept.
describe('session cookie hardening (__Host- prefix on HTTPS)', () => {
  /** Boots an app and mints a pending invite for `email` so it may register. */
  async function bootWithInvite(opts: { secureCookies?: boolean }, email: string) {
    const db = await makeTestDb();
    const app = await createApp({ db, ...opts });
    await app.ready();
    const inviterId = (await registerAccount(db, `admin-${randomUUID()}@test.local`, 'Pw-secret-1', { platformRole: 'admin' })).userId;
    await createInvite(db, inviterId, { email, role: 'developer' });
    return app;
  }

  it('uses __Host-sw_session (Secure, Path=/, no Domain) when secureCookies is on, and it authenticates', async () => {
    const email = `host-${randomUUID()}@test.local`;
    const app = await bootWithInvite({ secureCookies: true }, email);
    try {
      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'Pw-secret-1' },
      });
      expect(reg.statusCode).toBe(201);
      const c = reg.cookies.find((c) => c.name === '__Host-sw_session');
      expect(c, 'expected a __Host-sw_session Set-Cookie').toBeTruthy();
      expect(reg.cookies.find((c) => c.name === 'sw_session')).toBeUndefined();
      // The prefix's invariants (also what the browser enforces before accepting the cookie).
      expect(c!.secure).toBe(true);
      expect(c!.path).toBe('/');
      expect(c!.domain).toBeUndefined();
      expect(c!.httpOnly).toBe(true);
      expect(String(c!.sameSite).toLowerCase()).toBe('strict');

      // Round-trip: the server reads the prefixed name → an authed endpoint succeeds with it.
      const me = await app.inject({ method: 'GET', url: '/me', cookies: { '__Host-sw_session': c!.value } });
      expect(me.statusCode).toBe(200);

      // Logout's clearing Set-Cookie must ALSO carry Secure + Path=/ or the browser rejects the
      // deletion of a `__Host-`-prefixed cookie.
      const out = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { '__Host-sw_session': c!.value } });
      expect(out.statusCode).toBe(204);
      const cleared = out.cookies.find((c) => c.name === '__Host-sw_session');
      expect(cleared, 'expected a __Host-sw_session clearing Set-Cookie on logout').toBeDefined();
      expect(cleared!.secure).toBe(true);
      expect(cleared!.path).toBe('/');
    } finally {
      await app.close();
    }
  });

  it('keeps the bare sw_session name over plain HTTP (the prefix needs Secure, which dev cannot set)', async () => {
    const email = `bare-${randomUUID()}@test.local`;
    const app = await bootWithInvite({}, email); // secureCookies defaults off
    try {
      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'Pw-secret-1' },
      });
      expect(reg.cookies.find((c) => c.name === 'sw_session')).toBeTruthy();
      expect(reg.cookies.find((c) => c.name === '__Host-sw_session')).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
