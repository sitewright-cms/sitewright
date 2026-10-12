import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same arrangement as passkeys.test.ts: @simplewebauthn's cryptography is covered end to end by the
// Playwright virtual-authenticator spec, so only the two verify functions are mocked here and the
// route + repository logic (challenge type and owner, credential owner, single use) is real.
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

import { makeHarness, type Harness, type TestClient } from './harness.js';
import { registrationOf } from './passkey-fixtures.js';
import { memberTokens, userPasskeys, users } from '../src/db/schema.js';
import { setPlatformRole } from '../src/repo/accounts.js';

const SESSION_COOKIE = 'sw_session';
const PASSWORD = 'Pw-secret-1';
const BODY = { name: 'fleet', expiresInDays: 30, capabilities: ['content:read'] };

let h: Harness;
let dev: TestClient;
let otherDev: TestClient;

type Res = Awaited<ReturnType<TestClient['get']>>;

beforeEach(async () => {
  h = await makeHarness({ encryptionKey: randomBytes(32) });
  verifyReg.mockReset();
  verifyAuth.mockReset();
  verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 7 } });
  dev = await h.signup({ email: 'dev@agency.test', password: PASSWORD });
  otherDev = await h.signup({ email: 'other@agency.test', password: PASSWORD });
  await setPlatformRole(h.db, dev.userId, 'developer');
  await setPlatformRole(h.db, otherDev.userId, 'developer');
});
afterEach(async () => {
  await h.close();
});

/** Registers a passkey for `who` the way its owner would: confirmed with the account password. */
async function registerPasskey(who: TestClient, id: string): Promise<void> {
  verifyReg.mockResolvedValue({
    verified: true,
    registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
  });
  const begun = await who.post('/account/passkeys/register/options', { currentPassword: PASSWORD });
  if (begun.statusCode !== 200) throw new Error(`passkey registration could not begin (${begun.statusCode}): ${begun.body}`);
  const { handle } = begun.json() as { handle: string };
  const res = await who.post('/account/passkeys/register/verify', { handle, response: registrationOf(id), name: id });
  if (res.statusCode !== 201) throw new Error(`passkey registration failed (${res.statusCode}): ${res.body}`);
}

/** Begins a confirmation for `who` and returns the handle to answer it with. */
async function confirmHandle(who: TestClient): Promise<string> {
  const res = await who.post('/account/passkeys/confirm/options');
  if (res.statusCode !== 200) throw new Error(`confirm options failed (${res.statusCode}): ${res.body}`);
  return (res.json() as { handle: string }).handle;
}

const mintWithPasskey = async (who: TestClient, credentialId: string, handle?: string): Promise<Res> =>
  who.post('/account/member-tokens', { ...BODY, passkey: { handle: handle ?? (await confirmHandle(who)), response: { id: credentialId } } });

describe('member tokens — minting is confirmed with the password OR a passkey', () => {
  it('★ mints with one of the member’s own passkeys instead of the password', async () => {
    await registerPasskey(dev, 'cred-dev');
    const res = await mintWithPasskey(dev, 'cred-dev');
    expect(res.statusCode).toBe(201);
    const made = res.json() as { token: string };
    expect(made.token.startsWith('swm_')).toBe(true);
    // The assertion was really checked against THIS credential and the challenge that was issued…
    expect(verifyAuth).toHaveBeenCalledTimes(1);
    const args = verifyAuth.mock.calls[0]?.[0] as { expectedChallenge: string; credential: { id: string } };
    expect(args.credential.id).toBe('cred-dev');
    expect(args.expectedChallenge).toMatch(/^auth-/);
    // …and the use is recorded on the passkey like any other.
    const [pk] = await h.db.select().from(userPasskeys).where(eq(userPasskeys.id, 'cred-dev'));
    expect(pk?.counter).toBe(7);
    expect(pk?.lastUsedAt).not.toBeNull();
    // The token works.
    expect((await h.app.inject({ method: 'GET', url: '/projects', headers: { authorization: `Bearer ${made.token}` } })).statusCode).toBe(200);
  });

  it('an account with no password at all — single sign-on only — can mint with its passkey', async () => {
    await registerPasskey(dev, 'cred-sso');
    await h.db.update(users).set({ passwordHash: null }).where(eq(users.id, dev.userId));
    expect((await mintWithPasskey(dev, 'cred-sso')).statusCode).toBe(201);
  });

  it('the options offer only the caller’s own passkeys, and need one to exist', async () => {
    const none = await dev.post('/account/passkeys/confirm/options');
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: 'you have no passkey registered for this hostname' });

    await registerPasskey(dev, 'cred-dev');
    await registerPasskey(otherDev, 'cred-other');
    const res = await dev.post('/account/passkeys/confirm/options');
    expect(res.statusCode).toBe(200);
    const { options } = res.json() as { options: { allowCredentials: Array<{ id: string }> } };
    expect(options.allowCredentials.map((c) => c.id)).toEqual(['cred-dev']);

    // A passkey registered on ANOTHER hostname cannot be offered here, so it does not count.
    await h.db.update(userPasskeys).set({ rpId: 'elsewhere.example' }).where(eq(userPasskeys.id, 'cred-dev'));
    expect((await dev.post('/account/passkeys/confirm/options')).statusCode).toBe(409);
  });

  it('★ a stolen session cannot make itself a passkey to mint with — adding one needs the password it does not have', async () => {
    // Everything a thief holding ONLY the session cookie could try, in order.
    // 1. Mint outright: needs a confirmation.
    expect((await dev.post('/account/member-tokens', BODY)).statusCode).toBe(400);
    // 2. Add a passkey of their own to confirm with: refused without the password…
    const plant = await dev.post('/account/passkeys/register/options');
    expect(plant.statusCode).toBe(403);
    expect(plant.json()).toEqual({ error: 'confirm with your password or a passkey' });
    // …so there is no passkey to begin a confirmation with,
    expect((await dev.post('/account/passkeys/confirm/options')).statusCode).toBe(409);
    // …and no registration challenge to finish, even with a forged handle.
    const forged = await dev.post('/account/passkeys/register/verify', { handle: 'made-up', response: { id: 'cred-thief' }, name: 'thief' });
    expect(forged.statusCode).toBe(401);
    expect(await h.db.select().from(userPasskeys)).toHaveLength(0);
    expect(await h.db.select().from(memberTokens)).toHaveLength(0);

    // The owner, who knows the password, adds a passkey and mints with it in the same sitting.
    await registerPasskey(dev, 'cred-owner');
    expect((await mintWithPasskey(dev, 'cred-owner')).statusCode).toBe(201);
  });

  it('★ refuses someone else’s passkey, someone else’s challenge, and a failed assertion', async () => {
    await registerPasskey(dev, 'cred-dev');
    await registerPasskey(otherDev, 'cred-other');

    // Their credential, my challenge.
    const theirs = await mintWithPasskey(dev, 'cred-other');
    expect(theirs.statusCode).toBe(403);
    expect(theirs.json()).toEqual({ error: 'could not verify this passkey' });
    // My credential, a challenge that was issued to THEM.
    const borrowed = await mintWithPasskey(dev, 'cred-dev', await confirmHandle(otherDev));
    expect(borrowed.statusCode).toBe(403);
    expect((borrowed.json() as { error: string }).error).toMatch(/confirmation expired/);
    // An unknown credential, and a made-up handle.
    expect((await mintWithPasskey(dev, 'cred-nope')).statusCode).toBe(403);
    expect((await mintWithPasskey(dev, 'cred-dev', 'not-a-handle')).statusCode).toBe(403);
    expect(verifyAuth).not.toHaveBeenCalled();

    // The authenticator's answer does not verify.
    verifyAuth.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 1 } });
    expect((await mintWithPasskey(dev, 'cred-dev')).statusCode).toBe(403);
    verifyAuth.mockRejectedValueOnce(new Error('bad signature'));
    expect((await mintWithPasskey(dev, 'cred-dev')).statusCode).toBe(403);
    expect(await h.db.select().from(memberTokens)).toHaveLength(0);
  });

  it('★ a challenge is single-use, and a sign-in challenge is not a confirmation (nor the reverse)', async () => {
    await registerPasskey(dev, 'cred-dev');

    const handle = await confirmHandle(dev);
    expect((await mintWithPasskey(dev, 'cred-dev', handle)).statusCode).toBe(201);
    // Replayed: the handle was consumed by the first mint.
    expect((await mintWithPasskey(dev, 'cred-dev', handle)).statusCode).toBe(403);

    // A challenge from the public SIGN-IN endpoint cannot confirm anything…
    const signIn = ((await h.app.inject({ method: 'POST', url: '/auth/passkey/options' })).json() as { handle: string }).handle;
    expect((await mintWithPasskey(dev, 'cred-dev', signIn)).statusCode).toBe(403);
    // …and a confirmation challenge cannot be turned into a session.
    const stepUp = await confirmHandle(dev);
    const asLogin = await h.app.inject({ method: 'POST', url: '/auth/passkey/verify', payload: { handle: stepUp, response: { id: 'cred-dev' } } });
    expect(asLogin.statusCode).toBe(401);
    expect(asLogin.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(false);
    expect(await h.db.select().from(memberTokens)).toHaveLength(1);
  });

  it('asks for exactly one confirmation, and a too-high limit is refused before the passkey is spent', async () => {
    await registerPasskey(dev, 'cred-dev');
    const handle = await confirmHandle(dev);
    const both = await dev.post('/account/member-tokens', { ...BODY, currentPassword: PASSWORD, passkey: { handle, response: { id: 'cred-dev' } } });
    expect(both.statusCode).toBe(400);
    expect((await dev.post('/account/member-tokens', BODY)).statusCode).toBe(400);

    const tooHigh = await dev.post('/account/member-tokens', {
      ...BODY, capabilities: ['projects:create'], dailyProjectLimit: 51, passkey: { handle, response: { id: 'cred-dev' } },
    });
    expect(tooHigh.statusCode).toBe(400);
    // The handle survived both refusals, so the member does not touch their authenticator twice.
    expect((await mintWithPasskey(dev, 'cred-dev', handle)).statusCode).toBe(201);
  });

  it('the confirmation endpoint is session-only, and minting stays staff-only whichever way it is confirmed', async () => {
    await registerPasskey(dev, 'cred-dev');
    const { token } = (await mintWithPasskey(dev, 'cred-dev')).json() as { token: string };
    const viaBearer = await h.app.inject({ method: 'POST', url: '/account/passkeys/confirm/options', headers: { authorization: `Bearer ${token}` } });
    expect(viaBearer.statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: '/account/passkeys/confirm/options' })).statusCode).toBe(401);

    const client = await h.signup({ email: 'client@customer.test', password: PASSWORD });
    await registerPasskey(client, 'cred-client');
    const res = await mintWithPasskey(client, 'cred-client');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'only agency staff can create member tokens' });
  });
});
