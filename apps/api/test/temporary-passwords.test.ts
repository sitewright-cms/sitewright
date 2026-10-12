import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same arrangement as passkeys.test.ts: only @simplewebauthn's two verify functions are mocked, so a
// passkey sign-in can be driven without a browser while the route and repository logic stay real.
const { verifyReg, verifyAuth } = vi.hoisted(() => ({ verifyReg: vi.fn(), verifyAuth: vi.fn() }));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: async () => ({ challenge: `reg-${randomBytes(8).toString('hex')}`, rp: {}, user: {}, pubKeyCredParams: [] }),
  generateAuthenticationOptions: async (opts: { allowCredentials?: unknown[] }) => ({
    challenge: `auth-${randomBytes(8).toString('hex')}`,
    allowCredentials: opts.allowCredentials ?? [],
  }),
  verifyRegistrationResponse: (args: unknown) => verifyReg(args),
  verifyAuthenticationResponse: (args: unknown) => verifyAuth(args),
}));

// A pass-through with one seam: a test can run something at the moment a password is being hashed —
// the slow step that sits between "the current password was verified" and "the new one is written".
const hashing = vi.hoisted(() => ({ before: null as null | (() => Promise<void>) }));
vi.mock('../src/auth/password.js', async (original) => {
  const actual = await original<typeof import('../src/auth/password.js')>();
  return {
    ...actual,
    hashPassword: async (password: string) => {
      const hook = hashing.before;
      hashing.before = null;
      if (hook) await hook();
      return actual.hashPassword(password);
    },
  };
});

import { makeHarness, sessionToken, type Harness, type TestClient } from './harness.js';
import { registrationOf } from './passkey-fixtures.js';
import { users } from '../src/db/schema.js';
import { discardTemporaryPassword, registerAccount, setPlatformRole } from '../src/repo/accounts.js';
import { TEMPORARY_PASSWORD_TTL_MS } from '../src/auth/password.js';

/**
 * A password somebody else generated — an invite approved without its link, or one an admin issued —
 * is TEMPORARY: whoever generated it has seen it. So it opens nothing but the screen that replaces it,
 * it stops working after a week, and signing in through single sign-on throws it away (oidc.test.ts).
 */

const SESSION_COOKIE = 'sw_session';
const PASSWORD = 'Pw-secret-1';
const SENTINEL = 'password-change-required';
const EXPIRED = 'this temporary password has expired — ask for a new one';

let h: Harness;
let admin: TestClient;
let dev: TestClient;

type Res = Awaited<ReturnType<TestClient['get']>>;
const errorOf = (res: Res): string => (res.json() as { error: string }).error;

beforeEach(async () => {
  h = await makeHarness({ encryptionKey: randomBytes(32) });
  verifyReg.mockReset();
  verifyAuth.mockReset();
  verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 7 } });
  hashing.before = null;
  admin = await h.signup({ email: 'boss@agency.test', password: PASSWORD, admin: true });
  dev = await h.signup({ email: 'dev@agency.test', password: PASSWORD });
  await setPlatformRole(h.db, dev.userId, 'developer');
});
afterEach(async () => {
  await h.close();
});

/** A bare client for a session cookie that `signup()` did not create. */
function as(token: string) {
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<Res> =>
    h.app.inject({ method, url, cookies: { [SESSION_COOKIE]: token }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return {
    get: (url: string) => inject('GET', url),
    post: (url: string, payload?: unknown) => inject('POST', url, payload),
    put: (url: string, payload?: unknown) => inject('PUT', url, payload),
  };
}

const signIn = (email: string, password: string): Promise<Res> =>
  h.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

/** `dev` invites a client to a project of theirs and approves it without the link. */
async function approvedClient(): Promise<{ projectId: string; email: string; userId: string; password: string; passwordExpiresAt: string }> {
  const projectId = await dev.createProject('Site', 'site');
  const email = 'client@customer.test';
  const invite = await dev.post(`/projects/${projectId}/invites`, { email });
  const inviteId = (invite.json() as { invite: { id: string } }).invite.id;
  const res = await dev.post(`/projects/${projectId}/invites/${inviteId}/approve`);
  expect(res.statusCode).toBe(200);
  const body = res.json() as { userId: string; password: string; passwordExpiresAt: string };
  return { projectId, email, ...body };
}

/** The admin issues `dev` a new password. */
async function resetDev(body?: { revokeMemberTokens: boolean }): Promise<{ password: string; passwordExpiresAt: string }> {
  const res = await admin.post(`/admin/users/${dev.userId}/password`, body);
  expect(res.statusCode).toBe(200);
  return res.json() as { password: string; passwordExpiresAt: string };
}

async function expire(userId: string): Promise<void> {
  await h.db.update(users).set({ passwordExpiresAt: new Date(Date.now() - 1000) }).where(eq(users.id, userId));
}

describe('a temporary password', () => {
  it('★ comes with the time it stops working — a week out — from every route that generates one', async () => {
    const week = Date.now() + TEMPORARY_PASSWORD_TTL_MS;
    const near = (iso: string): boolean => Math.abs(new Date(iso).getTime() - week) < 60_000;

    const approved = await approvedClient();
    expect(near(approved.passwordExpiresAt), 'approve by a project owner').toBe(true);

    const staffInvite = await admin.post('/admin/invites', { email: 'new-dev@agency.test', role: 'developer' });
    const staffApproved = await admin.post(`/admin/invites/${(staffInvite.json() as { invite: { id: string } }).invite.id}/approve`);
    expect(near((staffApproved.json() as { passwordExpiresAt: string }).passwordExpiresAt), 'approve by an admin').toBe(true);

    const memberReset = await dev.post(`/projects/${approved.projectId}/members/${approved.userId}/password`);
    expect(near((memberReset.json() as { passwordExpiresAt: string }).passwordExpiresAt), 'a project member reset').toBe(true);

    // Last, because it holds `dev`'s own session from here on.
    expect(near((await resetDev()).passwordExpiresAt), 'a staff reset').toBe(true);
  });

  it('★ opens a session that can do nothing but replace it — reads included', async () => {
    const { projectId, email, password } = await approvedClient();
    const res = await signIn(email, password);
    expect(res.statusCode, 'the password does work — it is how its owner gets in').toBe(200);
    const client = as(sessionToken(res));

    // The one read it gets, and that read lists nothing the account can reach.
    const me = await client.get('/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email, mustChangePassword: true, temporaryPassword: true, projects: [] });

    // Everything else that asks who is calling answers with the sentinel: reads…
    for (const url of ['/projects', `/projects/${projectId}/content/page`, `/projects/${projectId}/members`, '/account/passkeys']) {
      const read = await client.get(url);
      expect(read.statusCode, `GET ${url}`).toBe(403);
      expect(errorOf(read), `GET ${url}`).toBe(SENTINEL);
    }
    // …and writes.
    const write = await client.put(`/projects/${projectId}/content/page/home`, { id: 'home', title: 'x', path: '' });
    expect(write.statusCode).toBe(403);
    expect(errorOf(write)).toBe(SENTINEL);
  });

  it('★ is replaced once, after which the account works and the temporary one is dead', async () => {
    const { projectId, email, password } = await approvedClient();
    const client = as(sessionToken(await signIn(email, password)));

    const change = await client.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' });
    expect(change.statusCode).toBe(204);

    const me = (await client.get('/me')).json() as { mustChangePassword: boolean; temporaryPassword: boolean; projects: Array<{ id: string }> };
    expect(me).toMatchObject({ mustChangePassword: false, temporaryPassword: false });
    expect(me.projects.map((p) => p.id), 'the membership was there all along').toEqual([projectId]);
    expect((await client.get(`/projects/${projectId}/content/page`)).statusCode).toBe(200);

    expect((await signIn(email, password)).statusCode, 'the copy somebody else holds').toBe(401);
    expect((await signIn(email, 'Their-own-pw-9')).statusCode).toBe(200);
    // …and the password its owner chose never expires.
    const [row] = await h.db.select().from(users).where(eq(users.email, email));
    expect(row?.passwordExpiresAt).toBeNull();
  });

  it('cannot be "replaced" with itself — whoever else knows it would still know it', async () => {
    const { email, password } = await approvedClient();
    const client = as(sessionToken(await signIn(email, password)));
    const same = await client.put('/account/password', { currentPassword: password, newPassword: password });
    expect(same.statusCode).toBe(403);
    expect(errorOf(same)).toMatch(/choose a new password/);
    expect((await client.get('/me')).json()).toMatchObject({ mustChangePassword: true });
  });

  it('★ stops working after its week, and says so only to someone who typed it right', async () => {
    const { email, userId, password } = await approvedClient();
    await expire(userId);

    const right = await signIn(email, password);
    expect(right.statusCode).toBe(401);
    expect(errorOf(right)).toBe(EXPIRED);
    expect(right.cookies.some((c) => c.name === SESSION_COOKIE), 'no session').toBe(false);

    const wrong = await signIn(email, 'Not-the-password-1');
    expect(wrong.statusCode).toBe(401);
    expect(errorOf(wrong), 'a guesser learns nothing about the account').toBe('invalid credentials');
  });

  it('★ cannot be kept alive by a session opened in time: after its week it can no longer be replaced', async () => {
    const { email, userId, password } = await approvedClient();
    const client = as(sessionToken(await signIn(email, password))); // signed in on day one…
    await expire(userId); // …and still sitting at the forced screen a week later

    const change = await client.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' });
    expect(change.statusCode).toBe(403);
    expect(errorOf(change)).toBe(EXPIRED);
    expect((await client.get('/projects')).statusCode, 'and the session is still held').toBe(403);
    expect((await signIn(email, 'Their-own-pw-9')).statusCode).toBe(401);
  });

  it('★ a replacement overtaken by the owner’s single sign-on does not land on the account', async () => {
    // Somebody who saw the temporary password is replacing it at the very moment the real owner
    // completes a single sign-on, which discards it and ends every session. The replacement was
    // verified against a password that no longer exists; writing it anyway would hand the account
    // straight back to whoever it had just been taken from.
    const { userId, email, password } = await approvedClient();
    const client = as(sessionToken(await signIn(email, password)));
    hashing.before = async () => {
      expect(await discardTemporaryPassword(h.db, userId)).toBe(true);
    };

    const change = await client.put('/account/password', { currentPassword: password, newPassword: 'Someone-elses-pw-9' });
    expect(change.statusCode).toBe(409);
    const [row] = await h.db.select().from(users).where(eq(users.id, userId));
    expect(row).toMatchObject({ passwordHash: null, mustChangePassword: false, passwordExpiresAt: null });
    expect((await signIn(email, 'Someone-elses-pw-9')).statusCode).toBe(401);
    expect((await client.get('/me')).statusCode, 'and that session is gone').toBe(401);
  });

  it('leaves exactly three doors open: /me (GET and HEAD), the password change, and signing out', async () => {
    const { email, password } = await approvedClient();
    const token = sessionToken(await signIn(email, password));
    const call = (method: 'GET' | 'HEAD' | 'POST' | 'PUT', url: string, payload?: object) =>
      h.app.inject({ method, url, cookies: { [SESSION_COOKIE]: token }, ...(payload ? { payload } : {}) });

    expect((await call('HEAD', '/me')).statusCode).toBe(200);
    expect((await call('GET', '/me?x=1')).statusCode, 'a query string does not close it').toBe(200);
    // Nothing else spelled like an escape is one.
    expect((await call('PUT', '/me', {})).statusCode).not.toBe(200);
    expect((await call('GET', '/account/password')).statusCode).not.toBe(200);
    expect((await call('POST', '/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' })).statusCode).not.toBe(204);
    expect((await signIn(email, password)).statusCode, 'and the password is unchanged').toBe(200);

    // Signing out works — a person must never be trapped at the forced screen.
    expect((await call('POST', '/auth/logout')).statusCode).toBe(204);
    expect((await call('GET', '/me')).statusCode).toBe(401);
  });

  it('a correct password that has expired is not a FAILED sign-in: it does not use up the throttle', async () => {
    // Lowering the threshold to 2 makes the difference visible in a handful of requests.
    expect((await admin.put('/admin/settings', { authMaxFailures: 2 })).statusCode).toBe(200);
    const { email, userId, password } = await approvedClient();
    await expire(userId);
    for (let i = 0; i < 6; i++) {
      const res = await signIn(email, password);
      expect(res.statusCode, `attempt ${i + 1}`).toBe(401);
      expect(errorOf(res)).toBe(EXPIRED);
    }
    // Whereas wrong guesses are still counted, and still stop.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await signIn(email, 'Not-the-password-1')).statusCode);
    expect(statuses).toContain(429);
  });

  it('is enforced in development too — unlike the default admin, it is a property of the credential', async () => {
    const devMode = await makeHarness({ encryptionKey: randomBytes(32), forcePasswordChange: false });
    try {
      // The default-admin flag alone is not enforced here…
      await registerAccount(devMode.db, 'default@agency.test', PASSWORD, { platformRole: 'admin', mustChangePassword: true });
      const boss = sessionToken(await devMode.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'default@agency.test', password: PASSWORD } }));
      const call = (token: string, method: 'GET' | 'POST', url: string, payload?: object) =>
        devMode.app.inject({ method, url, cookies: { [SESSION_COOKIE]: token }, ...(payload ? { payload } : {}) });
      expect((await call(boss, 'GET', '/projects')).statusCode).toBe(200);

      // …but a password that admin issues for someone else is.
      const target = await registerAccount(devMode.db, 'someone@agency.test', PASSWORD, { platformRole: 'developer' });
      const issued = (await call(boss, 'POST', `/admin/users/${target.userId}/password`)).json() as { password: string };
      const theirs = sessionToken(await devMode.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'someone@agency.test', password: issued.password } }));
      expect((await call(theirs, 'GET', '/me')).json()).toMatchObject({ mustChangePassword: true, temporaryPassword: true });
      const blocked = await call(theirs, 'GET', '/projects');
      expect(blocked.statusCode).toBe(403);
      expect((blocked.json() as { error: string }).error).toBe(SENTINEL);
    } finally {
      await devMode.close();
    }
  });
});

describe('a password an admin issues for someone else', () => {
  it('★ holds the sessions that account already has open, until the new password has been replaced', async () => {
    expect((await dev.get('/projects')).statusCode).toBe(200);
    const { password } = await resetDev();

    // The session `dev` already had is no longer an identity — whoever is sitting in it.
    const held = await dev.get('/projects');
    expect(held.statusCode).toBe(403);
    expect(errorOf(held)).toBe(SENTINEL);
    expect((await dev.get('/me')).json()).toMatchObject({ mustChangePassword: true, temporaryPassword: true, projects: [] });

    // Only the password the admin handed over gets it going again — the old one is gone.
    const withOld = await dev.put('/account/password', { currentPassword: PASSWORD, newPassword: 'Their-own-pw-9' });
    expect(withOld.statusCode).toBe(403);
    const withIssued = await dev.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' });
    expect(withIssued.statusCode).toBe(204);
    expect((await dev.get('/projects')).statusCode).toBe(200);
  });

  it('a second one replaces the first: the earlier password is dead and the week starts again', async () => {
    const first = await resetDev();
    await expire(dev.userId); // nobody used it
    const second = await resetDev();
    expect(new Date(second.passwordExpiresAt).getTime()).toBeGreaterThan(Date.now());

    expect((await signIn('dev@agency.test', first.password)).statusCode).toBe(401);
    const res = await signIn('dev@agency.test', second.password);
    expect(res.statusCode).toBe(200);
    const session = as(sessionToken(res));
    expect((await session.put('/account/password', { currentPassword: second.password, newPassword: 'Their-own-pw-9' })).statusCode).toBe(204);
    expect((await session.get('/projects')).statusCode).toBe(200);
  });

  it('with an authenticator app the code is still asked for — and the session it opens is still held', async () => {
    const { generateSync } = await import('otplib');
    const { secret } = (await dev.post('/account/mfa/totp/setup')).json() as { secret: string };
    expect((await dev.post('/account/mfa/totp/confirm', { code: generateSync({ secret }) })).statusCode).toBeLessThan(300);
    const { password } = await resetDev();

    const step1 = await signIn('dev@agency.test', password);
    expect(step1.json()).toMatchObject({ mfaRequired: true });
    const step2 = await h.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: (step1.json() as { ticket: string }).ticket, code: generateSync({ secret }) } });
    expect(step2.statusCode).toBe(200);
    const session = as(sessionToken(step2));
    expect((await session.get('/me')).json()).toMatchObject({ mustChangePassword: true, temporaryPassword: true });
    expect((await session.get('/projects')).statusCode).toBe(403);
    // A password sign-in does not discard it — only single sign-on does.
    expect((await session.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' })).statusCode).toBe(204);
  });

  it('cannot be issued for YOURSELF through a project — that would hold the session that asked', async () => {
    const projectId = await dev.createProject('Site', 'site');
    const own = await dev.post(`/projects/${projectId}/members/${dev.userId}/password`);
    expect(own.statusCode).toBe(403);
    expect(errorOf(own)).toBe('change your own password in Account settings');
    // The admin reaches every project, and is refused the same way.
    expect((await admin.post(`/projects/${projectId}/members/${admin.userId}/password`)).statusCode).toBe(403);
    expect((await dev.get('/projects')).statusCode, 'nobody was held').toBe(200);
    expect((await signIn('dev@agency.test', PASSWORD)).statusCode, 'and the password is untouched').toBe(200);
  });

  it('★ replacing it does not overrule the admin’s answer about member tokens', async () => {
    const minted = await dev.post('/account/member-tokens', { name: 'fleet', expiresInDays: 30, currentPassword: PASSWORD, capabilities: ['content:read'] });
    const bearer = { authorization: `Bearer ${(minted.json() as { token: string }).token}` };
    const works = async (): Promise<number> => (await h.app.inject({ method: 'GET', url: '/projects', headers: bearer })).statusCode;

    // A forgotten password: the admin keeps the tokens. They work throughout — automation is not a
    // person at a forced screen — and the forced change, which has no question to ask, leaves them.
    const { password } = await resetDev({ revokeMemberTokens: false });
    expect(await works()).toBe(200);
    expect((await dev.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' })).statusCode).toBe(204);
    expect(await works(), 'kept by the admin, so kept').toBe(200);

    // An ORDINARY change that says nothing still revokes: that rule is unchanged.
    expect((await dev.put('/account/password', { currentPassword: 'Their-own-pw-9', newPassword: 'Another-own-pw-9' })).statusCode).toBe(204);
    expect(await works()).toBe(401);
  });

  it('…and an explicit answer on the forced change is still obeyed', async () => {
    const minted = await dev.post('/account/member-tokens', { name: 'fleet', expiresInDays: 30, currentPassword: PASSWORD, capabilities: ['content:read'] });
    const bearer = { authorization: `Bearer ${(minted.json() as { token: string }).token}` };
    const { password } = await resetDev({ revokeMemberTokens: false });
    const change = await dev.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9', revokeMemberTokens: true });
    expect(change.statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/projects', headers: bearer })).statusCode).toBe(401);
  });

  it('★ is NOT thrown away by a passkey sign-in — a passkey planted before the reset must not undo it', async () => {
    // `dev` has a passkey from before (or an intruder gave the account one).
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: 'cred-dev', publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
    });
    const begun = await dev.post('/account/passkeys/register/options', { currentPassword: PASSWORD });
    const added = await dev.post('/account/passkeys/register/verify', { handle: (begun.json() as { handle: string }).handle, response: registrationOf('cred-dev'), name: 'laptop' });
    expect(added.statusCode).toBe(201);

    const { password } = await resetDev();

    const options = await h.app.inject({ method: 'POST', url: '/auth/passkey/options' });
    const viaPasskey = await h.app.inject({
      method: 'POST',
      url: '/auth/passkey/verify',
      payload: { handle: (options.json() as { handle: string }).handle, response: { id: 'cred-dev' } },
    });
    expect(viaPasskey.statusCode).toBe(200);
    const session = as(sessionToken(viaPasskey));

    // The passkey still signs in, but into the same held session…
    expect((await session.get('/me')).json()).toMatchObject({ mustChangePassword: true, temporaryPassword: true, hasPassword: true });
    expect((await session.get('/projects')).statusCode).toBe(403);
    // …and the password the admin issued is still the way through.
    expect((await session.put('/account/password', { currentPassword: password, newPassword: 'Their-own-pw-9' })).statusCode).toBe(204);
    expect((await session.get('/projects')).statusCode).toBe(200);
  });
});

describe('a session that still has to replace its password', () => {
  // The built-in CLI client and a PKCE pair, as oauth-consent-screen.test.ts uses them.
  const authorize = {
    client_id: 'sitewright-cli',
    redirect_uri: 'http://127.0.0.1:8976/callback',
    response_type: 'code',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'st',
  };

  it('★ cannot approve an OAuth client — the consent page treats it as not signed in', async () => {
    const projectId = await dev.createProject('Site', 'site');
    await resetDev();
    const cookies = { [SESSION_COOKIE]: dev.token };

    // Asking for the consent page sends it to the editor — which shows the forced screen.
    const page = await h.app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorize)}`, cookies });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toMatch(/^\/\?next=/);

    // Posting the approval directly gets no code either.
    const approve = await h.app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...authorize, 'scope_content:read': '1', project: projectId, decision: 'approve' }).toString(),
    });
    expect(approve.statusCode).toBe(403);
    expect(String(approve.headers.location ?? ''), 'no authorization code').not.toContain('code=');
  });
});

describe('the seeded admin still on the default password', () => {
  it('is held the same way now: reads no longer pass', async () => {
    await registerAccount(h.db, 'default@agency.test', PASSWORD, { platformRole: 'admin', mustChangePassword: true });
    const boss = as(sessionToken(await signIn('default@agency.test', PASSWORD)));

    expect((await boss.get('/me')).json()).toMatchObject({ mustChangePassword: true, temporaryPassword: false, projects: [] });
    for (const url of ['/projects', '/admin/settings', '/admin/member-tokens']) {
      const read = await boss.get(url);
      expect(read.statusCode, `GET ${url}`).toBe(403);
      expect(errorOf(read), `GET ${url}`).toBe(SENTINEL);
    }
    // No expiry for this one: it is not a temporary password, and it can be replaced whenever.
    const same = await boss.put('/account/password', { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.statusCode, 'but not with itself').toBe(403);
    expect((await boss.put('/account/password', { currentPassword: PASSWORD, newPassword: 'Their-own-pw-9' })).statusCode).toBe(204);
    expect((await boss.get('/admin/settings')).statusCode).toBe(200);
  });
});

describe('discardTemporaryPassword', () => {
  it('drops a temporary password and never one its owner chose', async () => {
    const { userId, email, password } = await approvedClient();
    expect(await discardTemporaryPassword(h.db, userId)).toBe(true);
    const [row] = await h.db.select().from(users).where(eq(users.id, userId));
    expect(row).toMatchObject({ passwordHash: null, mustChangePassword: false, passwordExpiresAt: null });
    expect((await signIn(email, password)).statusCode).toBe(401);
    expect(await discardTemporaryPassword(h.db, userId), 'nothing left to drop').toBe(false);

    expect(await discardTemporaryPassword(h.db, dev.userId)).toBe(false);
    expect((await signIn('dev@agency.test', PASSWORD)).statusCode, 'a chosen password is untouched').toBe(200);
  });
});
