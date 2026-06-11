import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
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
const PASSWORD = 'pw-secret-1';

function hasSessionCookie(res: { cookies: { name: string }[] }): boolean {
  return res.cookies.some((c) => c.name === SESSION_COOKIE);
}

describe('passkeys (WebAuthn registration + passwordless login)', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness({ encryptionKey: randomBytes(32), authRateMax: 200 });
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
    const opts = await client.post('/account/passkeys/register/options');
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

  it('rejects registration when verification fails (403)', async () => {
    const client = await harness.signup();
    verifyReg.mockResolvedValue({ verified: false });
    const { handle } = (await client.post('/account/passkeys/register/options')).json() as { handle: string };
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
    const { handle } = (await a.post('/account/passkeys/register/options')).json() as { handle: string };
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
    await client.post('/account/mfa/totp/confirm', { code: authenticator.generate(secret) });

    // Passkey verify now yields an MFA ticket (no session cookie).
    const { handle } = (await harness.app.inject({ method: 'POST', url: '/auth/passkey/options' })).json() as { handle: string };
    const verify = await harness.app.inject({ method: 'POST', url: '/auth/passkey/verify', payload: { handle, response: { id: 'cred-totp' } } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ mfaRequired: true });
    expect(hasSessionCookie(verify)).toBe(false);

    // Redeem the ticket with a TOTP code → session.
    const ticket = (verify.json() as { ticket: string }).ticket;
    const totp = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket, code: authenticator.generate(secret) } });
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
