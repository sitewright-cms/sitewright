import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The WebAuthn crypto (attestation/assertion verification) is @simplewebauthn's job and is covered
// end-to-end by the Playwright virtual-authenticator spec. Here we mock just the two verify functions
// so the route + repo logic (challenge lifecycle, credential storage, TOTP gating, session issuance)
// can be tested deterministically. The option generators return a minimal object with a challenge;
// the real /helpers (base64url etc.) are NOT mocked.
const { verifyReg, verifyAuth } = vi.hoisted(() => ({ verifyReg: vi.fn(), verifyAuth: vi.fn() }));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: async () => ({ challenge: `reg-${randomBytes(8).toString('hex')}`, rp: {}, user: {}, pubKeyCredParams: [] }),
  generateAuthenticationOptions: async () => ({ challenge: `auth-${randomBytes(8).toString('hex')}` }),
  verifyRegistrationResponse: (args: unknown) => verifyReg(args),
  verifyAuthenticationResponse: (args: unknown) => verifyAuth(args),
}));

import { makeHarness, sessionToken, type Harness, type TestClient } from './harness.js';

const SESSION_COOKIE = 'sw_session';
const PASSWORD = 'Pw-secret-1';

function hasSessionCookie(res: { cookies: { name: string }[] }): boolean {
  return res.cookies.some((c) => c.name === SESSION_COOKIE);
}

describe('passkeys (WebAuthn registration + passwordless login)', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness({ encryptionKey: randomBytes(32) });
    verifyReg.mockReset();
    verifyAuth.mockReset();
    // Default: a successful registration of `cred-default` and a successful assertion.
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: 'cred-default', publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
    });
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Registers a passkey with the given credential id for a client; returns the verify response. */
  async function registerPasskey(client: TestClient, id: string, name = 'My Laptop') {
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
    });
    const opts = await client.post('/account/passkeys/register/options', { currentPassword: PASSWORD });
    const { handle } = opts.json() as { handle: string };
    return client.post('/account/passkeys/register/verify', { handle, response: { id }, name });
  }

  it('registers a passkey and lists it', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const res = await registerPasskey(client, 'cred-a', 'Work Laptop');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'cred-a', name: 'Work Laptop' });

    const list = await client.get('/account/passkeys');
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({ id: 'cred-a', name: 'Work Laptop' });
  });

  // ── adding a passkey is CONFIRMED ──────────────────────────────────────────────────────────────
  // A passkey is a way to sign in, so a session alone must not be able to add one: a stolen cookie
  // would become a permanent login. The password, or a passkey the account already has, vouches.

  it('★ refuses to begin a registration without the password — a session alone cannot add a way to sign in', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const bare = await client.post('/account/passkeys/register/options');
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toEqual({ error: 'confirm with your password or a passkey' });
    const wrong = await client.post('/account/passkeys/register/options', { currentPassword: 'not-it' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'current password is incorrect' });
    // No challenge was issued, so there is nothing to finish a registration with.
    expect((await client.get('/account/passkeys')).json().items).toHaveLength(0);
    expect((await client.post('/account/passkeys/register/options', { currentPassword: PASSWORD })).statusCode).toBe(200);
  });

  it('★ an existing passkey can vouch for adding another — its own, on a challenge issued to its owner', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const other = await harness.signup({ password: PASSWORD });
    await registerPasskey(client, 'cred-first');
    await registerPasskey(other, 'cred-theirs');

    const confirm = async (who: TestClient): Promise<string> => ((await who.post('/account/passkeys/confirm/options')).json() as { handle: string }).handle;
    const begin = (handle: string, id: string) => client.post('/account/passkeys/register/options', { passkey: { handle, response: { id } } });

    // Someone else's passkey, or a challenge issued to someone else, vouches for nothing.
    expect((await begin(await confirm(client), 'cred-theirs')).statusCode).toBe(403);
    expect((await begin(await confirm(other), 'cred-first')).statusCode).toBe(403);
    // A challenge from the public SIGN-IN endpoint is not a confirmation.
    const signIn = ((await harness.app.inject({ method: 'POST', url: '/auth/passkey/options' })).json() as { handle: string }).handle;
    expect((await begin(signIn, 'cred-first')).statusCode).toBe(403);
    // A failed assertion is refused.
    verifyAuth.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 1 } });
    expect((await begin(await confirm(client), 'cred-first')).statusCode).toBe(403);

    const handle = await confirm(client);
    expect((await begin(handle, 'cred-first')).statusCode).toBe(200);
    // Single use: the same confirmation cannot begin a second registration.
    expect((await begin(handle, 'cred-first')).statusCode).toBe(403);
  });

  it('an account with nothing to confirm with — no password, no passkey here — adds its FIRST passkey on the session', async () => {
    const client = await harness.signup({ password: PASSWORD });
    await harness.db.run(sql`UPDATE users SET password_hash = NULL WHERE id = ${client.userId}`);
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: 'cred-sso', publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
    });
    const first = await client.post('/account/passkeys/register/options');
    expect(first.statusCode).toBe(200);
    const { handle } = first.json() as { handle: string };
    expect((await client.post('/account/passkeys/register/verify', { handle, response: { id: 'cred-sso' }, name: 'First' })).statusCode).toBe(201);

    // From then on it HAS something to confirm with, and is asked for it — a password it does not have is no answer.
    expect((await client.post('/account/passkeys/register/options')).statusCode).toBe(403);
    const byPassword = await client.post('/account/passkeys/register/options', { currentPassword: PASSWORD });
    expect(byPassword.statusCode).toBe(403);
    expect((byPassword.json() as { error: string }).error).toMatch(/has no password — confirm with a passkey/);
    const confirm = ((await client.post('/account/passkeys/confirm/options')).json() as { handle: string }).handle;
    expect((await client.post('/account/passkeys/register/options', { passkey: { handle: confirm, response: { id: 'cred-sso' } } })).statusCode).toBe(200);

    // A passkey that belongs to ANOTHER hostname cannot be asked for here — but the account still
    // HAS a credential, so the session alone is not enough: otherwise presenting the cookie on a
    // hostname where the account has no passkey would walk straight around the confirmation.
    await harness.db.run(sql`UPDATE user_passkeys SET rp_id = 'elsewhere.example' WHERE id = 'cred-sso'`);
    const elsewhere = await client.post('/account/passkeys/register/options');
    expect(elsewhere.statusCode).toBe(409);
    expect((elsewhere.json() as { error: string }).error).toMatch(/none of your passkeys can be used on this hostname.*set a password/);
    expect((await client.get('/account/passkeys')).json().items).toHaveLength(1);
  });

  // ── rpID: which HOST a credential belongs to ───────────────────────────────────────────────────
  // A passkey is bound to its rpID, so the browser silently declines to offer it on any other
  // hostname. Recording the rpID is what lets the Security tab explain that instead of the user
  // seeing an unexplained "no passkey available".

  it('records the rpID the ceremony ran against, and lists it', async () => {
    const client = await harness.signup({ password: PASSWORD });
    await registerPasskey(client, 'cred-rp', 'Desk');

    const [item] = (await client.get('/account/passkeys')).json().items as Array<{ rpId: string | null }>;
    // light-my-request injects `localhost` as the authority; rpID is the host WITHOUT its port.
    expect(item?.rpId).toBe('localhost');
  });

  it('records the rpID per HOST, so two hostnames yield two differently-bound credentials', async () => {
    const client = await harness.signup({ password: PASSWORD });
    await registerPasskey(client, 'cred-primary', 'On primary');

    // Same user, same instance, reached on a second hostname (what multi-host access makes routine).
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: 'cred-second', publicKey: new Uint8Array([9]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
    });
    const opts = await client.inject({ method: 'POST', url: '/account/passkeys/register/options', payload: { currentPassword: PASSWORD }, headers: { host: 'admin.example.com' } });
    const { handle } = opts.json() as { handle: string };
    const res = await client.inject({
      method: 'POST',
      url: '/account/passkeys/register/verify',
      headers: { host: 'admin.example.com' },
      payload: { handle, response: { id: 'cred-second' }, name: 'On second host' },
    });
    expect(res.statusCode).toBe(201);

    const items = (await client.get('/account/passkeys')).json().items as Array<{ id: string; rpId: string | null }>;
    expect(new Map(items.map((i) => [i.id, i.rpId]))).toEqual(
      new Map([
        ['cred-primary', 'localhost'],
        ['cred-second', 'admin.example.com'],
      ]),
    );
  });

  it('honors X-Forwarded-Host for the recorded rpID (TLS-terminating proxy)', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const opts = await client.inject({ method: 'POST', url: '/account/passkeys/register/options', payload: { currentPassword: PASSWORD }, headers: { 'x-forwarded-host': 'cms.example.com', 'x-forwarded-proto': 'https' } });
    const { handle } = opts.json() as { handle: string };
    await client.inject({
      method: 'POST',
      url: '/account/passkeys/register/verify',
      headers: { 'x-forwarded-host': 'cms.example.com', 'x-forwarded-proto': 'https' },
      payload: { handle, response: { id: 'cred-default' }, name: 'Behind a proxy' },
    });

    const [item] = (await client.get('/account/passkeys')).json().items as Array<{ rpId: string | null }>;
    // Not the container-facing `localhost` the proxy connected to: the browser bound the credential to
    // the public host, so that is the only value that can explain a later mismatch.
    expect(item?.rpId).toBe('cms.example.com');
  });

  it('reports a pre-existing credential as rpId null rather than guessing the current host', async () => {
    const client = await harness.signup({ password: PASSWORD });
    await registerPasskey(client, 'cred-legacy', 'Older key');
    // Simulate a row registered before the column existed. Stamping it with the CURRENT host would be
    // a confident lie about the one fact the column records, so null must survive to the client.
    await harness.db.run(sql`update user_passkeys set rp_id = null where id = 'cred-legacy'`);

    const [item] = (await client.get('/account/passkeys')).json().items as Array<{ rpId: string | null }>;
    expect(item?.rpId).toBeNull();
  });

  it('rejects registration when verification fails (403)', async () => {
    const client = await harness.signup();
    verifyReg.mockResolvedValue({ verified: false });
    const { handle } = (await client.post('/account/passkeys/register/options', { currentPassword: PASSWORD })).json() as { handle: string };
    const res = await client.post('/account/passkeys/register/verify', { handle, response: { id: 'x' }, name: 'X' });
    expect(res.statusCode).toBe(403);
    expect((await client.get('/account/passkeys')).json().items).toHaveLength(0);
  });

  it('rejects a registration verify with an unknown/expired challenge handle (401)', async () => {
    const client = await harness.signup();
    const res = await client.post('/account/passkeys/register/verify', { handle: 'nope', response: { id: 'x' }, name: 'X' });
    expect(res.statusCode).toBe(401);
  });

  it('does not let one user redeem another user’s registration challenge', async () => {
    const a = await harness.signup();
    const b = await harness.signup();
    const { handle } = (await a.post('/account/passkeys/register/options', { currentPassword: PASSWORD })).json() as { handle: string };
    const res = await b.post('/account/passkeys/register/verify', { handle, response: { id: 'cred-x' }, name: 'X' });
    expect(res.statusCode).toBe(401);
  });

  it('renames and deletes a passkey (owner-scoped)', async () => {
    const client = await harness.signup();
    await registerPasskey(client, 'cred-r', 'Old name');
    expect((await client.inject({ method: 'PATCH', url: '/account/passkeys/cred-r', payload: { name: 'New name' } })).statusCode).toBe(204);
    expect((await client.get('/account/passkeys')).json().items[0].name).toBe('New name');

    expect((await client.del('/account/passkeys/cred-r')).statusCode).toBe(204);
    expect((await client.get('/account/passkeys')).json().items).toHaveLength(0);
    // Deleting again → 404.
    expect((await client.del('/account/passkeys/cred-r')).statusCode).toBe(404);
  });

  it('signs in passwordless with a registered passkey', async () => {
    const client = await harness.signup({ password: PASSWORD });
    await registerPasskey(client, 'cred-login');

    const { handle } = (await harness.app.inject({ method: 'POST', url: '/auth/passkey/options' })).json() as { handle: string };
    const verify = await harness.app.inject({ method: 'POST', url: '/auth/passkey/verify', payload: { handle, response: { id: 'cred-login' } } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ userId: client.userId });
    expect(hasSessionCookie(verify)).toBe(true);
    const token = sessionToken(verify);
    expect((await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token } })).statusCode).toBe(200);
  });

  it('rejects passkey login for an unrecognized credential (401)', async () => {
    const { handle } = (await harness.app.inject({ method: 'POST', url: '/auth/passkey/options' })).json() as { handle: string };
    const res = await harness.app.inject({ method: 'POST', url: '/auth/passkey/verify', payload: { handle, response: { id: 'no-such-credential' } } });
    expect(res.statusCode).toBe(401);
  });

  it('TOTP gates ON TOP of a passkey: verify returns a ticket, not a session, when TOTP is on', async () => {
    const email = `pk-totp-${Date.now()}@test.local`;
    const client = await harness.signup({ email, password: PASSWORD });
    await registerPasskey(client, 'cred-totp');

    // Enrol TOTP.
    const { secret } = (await client.post('/account/mfa/totp/setup')).json() as { secret: string };
    await client.post('/account/mfa/totp/confirm', { code: generateSync({ secret }) });

    // Passkey verify now yields an MFA ticket (no session cookie).
    const { handle } = (await harness.app.inject({ method: 'POST', url: '/auth/passkey/options' })).json() as { handle: string };
    const verify = await harness.app.inject({ method: 'POST', url: '/auth/passkey/verify', payload: { handle, response: { id: 'cred-totp' } } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ mfaRequired: true });
    expect(hasSessionCookie(verify)).toBe(false);

    // Redeem the ticket with a TOTP code → session.
    const ticket = (verify.json() as { ticket: string }).ticket;
    const totp = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket, code: generateSync({ secret }) } });
    expect(totp.statusCode).toBe(200);
    expect(hasSessionCookie(totp)).toBe(true);
  });

  it('passkey management is session-only — a Bearer credential is forbidden', async () => {
    const auth = { authorization: 'Bearer swk_fake' };
    for (const [method, url, payload] of [
      ['POST', '/account/passkeys/register/options', undefined],
      ['POST', '/account/passkeys/register/verify', { handle: 'h', response: { id: 'x' }, name: 'X' }],
      ['GET', '/account/passkeys', undefined],
      ['PATCH', '/account/passkeys/cred-x', { name: 'Y' }],
      ['DELETE', '/account/passkeys/cred-x', undefined],
    ] as const) {
      const res = await harness.app.inject({ method, url, headers: auth, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
