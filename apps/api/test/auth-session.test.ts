import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { makeHarness, sessionToken, type Harness } from './harness.js';

const SESSION_COOKIE = 'sw_session';

/** Returns the Set-Cookie entry for the session cookie (parsed by light-my-request). */
function sessionCookie(res: LightMyRequestResponse) {
  const c = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!c) throw new Error(`no ${SESSION_COOKIE} Set-Cookie (status ${res.statusCode})`);
  return c;
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
 */
describe('auth + session lifecycle (HTTP)', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  const register = (payload: Record<string, unknown>) =>
    harness.app.inject({ method: 'POST', url: '/auth/register', payload });
  const loginReq = (payload: Record<string, unknown>) =>
    harness.app.inject({ method: 'POST', url: '/auth/login', payload });

  // 1. Duplicate email + normalization -------------------------------------
  it('rejects registering a duplicate email with 409 (case-insensitive)', async () => {
    const email = `dup-${randomUUID()}@test.local`;
    const first = await register({ email, password: 'pw-secret-1', orgName: 'Acme' });
    expect(first.statusCode).toBe(201);

    // Same address in a different case must collide, because registerAccount
    // normalizes via email.toLowerCase() before the uniqueness check. (Surrounding
    // whitespace can't be tested here: z.string().email() rejects it at the HTTP
    // boundary with a 400 before the repo's .trim() runs.)
    const variant = email.toUpperCase();
    const dup = await register({ email: variant, password: 'pw-secret-1', orgName: 'Acme2' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: expect.any(String) });
    // A conflict must not mint a session cookie.
    expect(dup.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  // 2. Login failures (no user enumeration) --------------------------------
  it('returns 401 for a wrong password and an unknown email, indistinguishably', async () => {
    const email = `enum-${randomUUID()}@test.local`;
    expect((await register({ email, password: 'pw-secret-1', orgName: 'Acme' })).statusCode).toBe(
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
    const reg = await register({ email, password: 'pw-secret-1', orgName: 'Acme' });
    const { userId } = reg.json() as { userId: string };

    // Mixed-case email still authenticates against the stored normalized one
    // (login lowercases before lookup). No surrounding whitespace: the email
    // schema would 400 on that before login() runs.
    const res = await loginReq({ email: email.toUpperCase(), password: 'pw-secret-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId });
    expect(sessionToken(res)).toBeTruthy();
  });

  // 3. Cookie security attributes ------------------------------------------
  it('sets an HttpOnly, SameSite session cookie that is not Secure over plain HTTP', async () => {
    const res = await register({
      email: `cookie-${randomUUID()}@test.local`,
      password: 'pw-secret-1',
      orgName: 'Acme',
    });
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
    const client = await harness.signup();

    // The cookie works before logout.
    const before = await client.get('/me');
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ userId: client.userId });

    const logout = await harness.app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE]: client.token },
    });
    expect(logout.statusCode).toBe(204);
    // Logout must emit a clearing Set-Cookie (empty value, past expiry).
    const cleared = logout.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared, 'logout must emit a clearing Set-Cookie').toBeDefined();
    expect(cleared?.value).toBe('');

    // Reusing the (now server-side revoked) token must fail — proves the session
    // record was deleted, not merely the browser cookie cleared.
    const after = await client.get('/me');
    expect(after.statusCode).toBe(401);
  });

  it('treats logout without a session as a no-op (idempotent 204)', async () => {
    const res = await harness.app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
  });

  // 5. Tampered / garbage cookie -> 401, never 500 --------------------------
  it('rejects a tampered/garbage session cookie with 401 (not 500)', async () => {
    for (const bogus of ['not-a-real-token', `${randomUUID()}-tampered`, 'a'.repeat(256)]) {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/me',
        cookies: { [SESSION_COOKIE]: bogus },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('requires authentication for /me when no cookie is present (401)', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  // 6. Registration input validation ---------------------------------------
  it('rejects a too-short password (<8) with 400', async () => {
    const res = await register({
      email: `weak-${randomUUID()}@test.local`,
      password: 'short7!', // 7 chars
      orgName: 'Acme',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid request' });
  });

  it('rejects an invalid email with 400', async () => {
    const res = await register({
      email: 'not-an-email',
      password: 'pw-secret-1',
      orgName: 'Acme',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid request' });
  });

  it('rejects a missing/empty orgName with 400', async () => {
    const missing = await register({
      email: `noorg-${randomUUID()}@test.local`,
      password: 'pw-secret-1',
    });
    expect(missing.statusCode).toBe(400);

    const empty = await register({
      email: `emptyorg-${randomUUID()}@test.local`,
      password: 'pw-secret-1',
      orgName: '',
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: 'invalid request' });
  });
});
