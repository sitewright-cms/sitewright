import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, sessionToken, type Harness, type TestClient } from './harness.js';

const SESSION_COOKIE = 'sw_session';
const PASSWORD = 'pw-secret-1';

/** A valid current code for a base32 secret (window ±1 on the server absorbs any step boundary). */
const codeFor = (secret: string) => authenticator.generate(secret);

function hasSessionCookie(res: { cookies: { name: string }[] }): boolean {
  return res.cookies.some((c) => c.name === SESSION_COOKIE);
}

describe('TOTP two-factor (enrol, login gate, recovery codes)', () => {
  let harness: Harness;
  beforeEach(async () => {
    // An encryption key is required (the TOTP secret is encrypted at rest); raise the auth cap.
    harness = await makeHarness({ encryptionKey: randomBytes(32), authRateMax: 200 });
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Registers a user and fully enrols TOTP; returns the client, the secret, and recovery codes. */
  async function enrol(email: string): Promise<{ client: TestClient; secret: string; recoveryCodes: string[] }> {
    const client = await harness.signup({ email, password: PASSWORD });
    const setup = await client.post('/account/mfa/totp/setup');
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUri } = setup.json() as { secret: string; otpauthUri: string };
    expect(otpauthUri).toContain('otpauth://totp/');
    expect(otpauthUri).toContain('Sitewright');
    const confirm = await client.post('/account/mfa/totp/confirm', { code: codeFor(secret) });
    expect(confirm.statusCode).toBe(200);
    const { recoveryCodes } = confirm.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    return { client, secret, recoveryCodes };
  }

  it('enrols TOTP and reports it in /me', async () => {
    const { client } = await enrol(`enrol-${Date.now()}@test.local`);
    expect((await client.get('/me')).json().totpEnabled).toBe(true);
  });

  it('an unconfirmed setup does NOT gate login (no lockout from an abandoned enrolment)', async () => {
    const email = `pending-${Date.now()}@test.local`;
    const client = await harness.signup({ email, password: PASSWORD });
    await client.post('/account/mfa/totp/setup'); // begin but never confirm
    expect((await client.get('/me')).json().totpEnabled).toBe(false);
    const login = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    expect(login.json().mfaRequired).toBeUndefined();
    expect(hasSessionCookie(login)).toBe(true);
  });

  it('rejects confirmation with a wrong code (400) and leaves TOTP disabled', async () => {
    const client = await harness.signup({ password: PASSWORD });
    await client.post('/account/mfa/totp/setup');
    const res = await client.post('/account/mfa/totp/confirm', { code: '000000' });
    expect(res.statusCode).toBe(400);
    expect((await client.get('/me')).json().totpEnabled).toBe(false);
  });

  it('gates login behind TOTP: password alone yields a ticket (no session), code completes it', async () => {
    const email = `gate-${Date.now()}@test.local`;
    const { secret } = await enrol(email);

    const step1 = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    expect(step1.statusCode).toBe(200);
    const body1 = step1.json() as { mfaRequired?: boolean; ticket?: string; userId?: string };
    expect(body1.mfaRequired).toBe(true);
    expect(body1.ticket).toBeTruthy();
    expect(body1.userId).toBeUndefined();
    expect(hasSessionCookie(step1)).toBe(false); // crucially, no session from the password alone

    const step2 = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: body1.ticket, code: codeFor(secret) } });
    expect(step2.statusCode).toBe(200);
    expect(hasSessionCookie(step2)).toBe(true);
    const token = sessionToken(step2);
    expect((await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token } })).statusCode).toBe(200);
  });

  it('a wrong TOTP code is 401 but the ticket survives for a retry', async () => {
    const email = `retry-${Date.now()}@test.local`;
    const { secret } = await enrol(email);
    const { ticket } = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };

    const wrong = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket, code: '000000' } });
    expect(wrong.statusCode).toBe(401);
    expect(hasSessionCookie(wrong)).toBe(false);

    // Same ticket still works with the right code.
    const right = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket, code: codeFor(secret) } });
    expect(right.statusCode).toBe(200);
    expect(hasSessionCookie(right)).toBe(true);
  });

  it('a recovery code logs you in once, then is dead', async () => {
    const email = `rec-${Date.now()}@test.local`;
    const { recoveryCodes } = await enrol(email);
    const code = recoveryCodes[0]!;

    const t1 = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };
    const ok = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: t1.ticket, code } });
    expect(ok.statusCode).toBe(200);

    // A fresh ticket, the same recovery code — now rejected (single-use).
    const t2 = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };
    const reuse = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: t2.ticket, code } });
    expect(reuse.statusCode).toBe(401);
  });

  it('rejects an unknown/garbage ticket (401)', async () => {
    const res = await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: 'not-a-real-ticket', code: '123456' } });
    expect(res.statusCode).toBe(401);
  });

  it('disables TOTP (password-confirmed); login no longer needs a code; wrong password is 403', async () => {
    const email = `disable-${Date.now()}@test.local`;
    const { client } = await enrol(email);

    // DELETE carries a JSON body (the password) — use inject directly (the harness `del` sends none).
    const wrongPw = await client.inject({ method: 'DELETE', url: '/account/mfa/totp', payload: { currentPassword: 'nope' } });
    expect(wrongPw.statusCode).toBe(403);
    expect((await client.get('/me')).json().totpEnabled).toBe(true); // still on

    const ok = await client.inject({ method: 'DELETE', url: '/account/mfa/totp', payload: { currentPassword: PASSWORD } });
    expect(ok.statusCode).toBe(204);
    expect((await client.get('/me')).json().totpEnabled).toBe(false);

    const login = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    expect(login.json().mfaRequired).toBeUndefined();
    expect(hasSessionCookie(login)).toBe(true);
  });

  it('regenerates recovery codes (password-confirmed): old codes die, new ones work', async () => {
    const email = `regen-${Date.now()}@test.local`;
    const { client, recoveryCodes } = await enrol(email);
    const oldCode = recoveryCodes[0]!;

    const wrong = await client.post('/account/mfa/recovery-codes', { currentPassword: 'nope' });
    expect(wrong.statusCode).toBe(403);

    const res = await client.post('/account/mfa/recovery-codes', { currentPassword: PASSWORD });
    expect(res.statusCode).toBe(200);
    const fresh = (res.json() as { recoveryCodes: string[] }).recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(oldCode);

    // Old code is now invalid; a new one works.
    const t1 = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };
    expect((await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: t1.ticket, code: oldCode } })).statusCode).toBe(401);
    const t2 = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };
    expect((await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: t2.ticket, code: fresh[0] } })).statusCode).toBe(200);
  });

  it('rejects replay: the same TOTP code cannot be used to log in twice', async () => {
    const email = `replay-${Date.now()}@test.local`;
    const { secret } = await enrol(email);
    const code = codeFor(secret); // capture once and reuse the exact string

    const t1 = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };
    expect((await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: t1.ticket, code } })).statusCode).toBe(200);

    const t2 = (await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json() as { ticket: string };
    expect((await harness.app.inject({ method: 'POST', url: '/auth/login/totp', payload: { ticket: t2.ticket, code } })).statusCode).toBe(401);
  });

  it('re-enrolling while TOTP is active requires the password (no session-only factor swap)', async () => {
    const email = `reenrol-${Date.now()}@test.local`;
    const { client } = await enrol(email);

    // No password / wrong password → blocked; the live factor is untouched.
    expect((await client.post('/account/mfa/totp/setup')).statusCode).toBe(400); // zod: currentPassword required
    expect((await client.post('/account/mfa/totp/setup', { currentPassword: 'nope' })).statusCode).toBe(403);
    expect((await client.get('/me')).json().totpEnabled).toBe(true);

    // Correct password stages a new secret (the live factor still works until /confirm).
    const ok = await client.post('/account/mfa/totp/setup', { currentPassword: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(typeof (ok.json() as { secret: string }).secret).toBe('string');
    expect((await client.get('/me')).json().totpEnabled).toBe(true);
  });

  it('MFA management is session-only — a Bearer credential is forbidden', async () => {
    const auth = { authorization: 'Bearer swk_fake' };
    for (const [method, url, payload] of [
      ['POST', '/account/mfa/totp/setup', undefined],
      ['POST', '/account/mfa/totp/confirm', { code: '123456' }],
      ['DELETE', '/account/mfa/totp', { currentPassword: PASSWORD }],
      ['POST', '/account/mfa/recovery-codes', { currentPassword: PASSWORD }],
    ] as const) {
      const res = await harness.app.inject({ method, url, headers: auth, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('is unavailable (503) when the instance has no encryption key', async () => {
    const noKey = await makeHarness({ authRateMax: 200 }); // no encryptionKey
    try {
      const client = await noKey.signup({ password: PASSWORD });
      const res = await client.post('/account/mfa/totp/setup');
      expect(res.statusCode).toBe(503);
    } finally {
      await noKey.close();
    }
  });
});
