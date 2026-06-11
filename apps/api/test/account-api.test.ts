import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, sessionToken, type Harness } from './harness.js';

const SESSION_COOKIE = 'sw_session';
const PASSWORD = 'pw-secret-1';

describe('account management (/account/email, /account/password)', () => {
  let harness: Harness;
  beforeEach(async () => {
    // Raise the auth rate cap so the multi-call flows below never trip the limiter.
    harness = await makeHarness({ authRateMax: 100 });
  });
  afterEach(async () => {
    await harness.close();
  });

  it('changes email after re-auth and reflects it in /me + login', async () => {
    const email = `before-${Date.now()}@test.local`;
    const client = await harness.signup({ email, password: PASSWORD });

    const res = await client.put('/account/email', { email: 'AFTER@Test.Local', currentPassword: PASSWORD });
    expect(res.statusCode).toBe(200);
    // Stored normalized (trim + lowercase).
    expect(res.json()).toEqual({ email: 'after@test.local' });

    const me = await client.get('/me');
    expect(me.json().email).toBe('after@test.local');

    // The new email logs in; the old one no longer does.
    const ok = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'after@test.local', password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    const gone = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    expect(gone.statusCode).toBe(401);
  });

  it('rejects an email change with the wrong current password (403, no logout)', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const res = await client.put('/account/email', { email: 'x@test.local', currentPassword: 'wrong-pw' });
    expect(res.statusCode).toBe(403);
    // Session is untouched.
    expect((await client.get('/me')).statusCode).toBe(200);
  });

  it('rejects an email change to an address already in use (409)', async () => {
    const taken = `taken-${Date.now()}@test.local`;
    await harness.signup({ email: taken, password: PASSWORD });
    const client = await harness.signup({ password: PASSWORD });
    const res = await client.put('/account/email', { email: taken, currentPassword: PASSWORD });
    expect(res.statusCode).toBe(409);
  });

  it('changing to your own email is an idempotent success', async () => {
    const email = `same-${Date.now()}@test.local`;
    const client = await harness.signup({ email, password: PASSWORD });
    const res = await client.put('/account/email', { email, currentPassword: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email });
  });

  it('validates the new email (zod) and rejects garbage', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const res = await client.put('/account/email', { email: 'not-an-email', currentPassword: PASSWORD });
    expect(res.statusCode).toBe(400);
  });

  it('changes password after re-auth: new works, old fails', async () => {
    const email = `pw-${Date.now()}@test.local`;
    const client = await harness.signup({ email, password: PASSWORD });

    const res = await client.put('/account/password', { currentPassword: PASSWORD, newPassword: 'new-pw-9876' });
    expect(res.statusCode).toBe(204);

    const ok = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'new-pw-9876' } });
    expect(ok.statusCode).toBe(200);
    const old = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    expect(old.statusCode).toBe(401);
  });

  it('rejects a password change with the wrong current password (403)', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const res = await client.put('/account/password', { currentPassword: 'nope', newPassword: 'new-pw-9876' });
    expect(res.statusCode).toBe(403);
  });

  it('enforces new-password strength (min length)', async () => {
    const client = await harness.signup({ password: PASSWORD });
    const res = await client.put('/account/password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.statusCode).toBe(400);
  });

  it('revokes the user OTHER sessions on password change but keeps the acting one', async () => {
    const email = `multi-${Date.now()}@test.local`;
    const acting = await harness.signup({ email, password: PASSWORD });

    // A second, independent session for the same user (a different browser/device).
    const login2 = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    const token2 = sessionToken(login2);
    const me2Before = await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token2 } });
    expect(me2Before.statusCode).toBe(200);

    // Change the password using the acting session.
    const res = await acting.put('/account/password', { currentPassword: PASSWORD, newPassword: 'new-pw-9876' });
    expect(res.statusCode).toBe(204);

    // The other session is gone; the acting one survives.
    const me2After = await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token2 } });
    expect(me2After.statusCode).toBe(401);
    expect((await acting.get('/me')).statusCode).toBe(200);
  });

  it('revokes other sessions on email change too (email is the login identity)', async () => {
    const email = `email-multi-${Date.now()}@test.local`;
    const acting = await harness.signup({ email, password: PASSWORD });
    const login2 = await harness.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    const token2 = sessionToken(login2);
    expect((await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token2 } })).statusCode).toBe(200);

    const res = await acting.put('/account/email', { email: `moved-${Date.now()}@test.local`, currentPassword: PASSWORD });
    expect(res.statusCode).toBe(200);

    // The other session is cut off; the acting one survives.
    expect((await harness.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: token2 } })).statusCode).toBe(401);
    expect((await acting.get('/me')).statusCode).toBe(200);
  });

  it('is session-only: a Bearer credential is forbidden on both routes', async () => {
    // The Bearer gate fires on presence (before any session check), so a fake token suffices.
    const auth = { authorization: 'Bearer swk_fake_token' };
    const e = await harness.app.inject({ method: 'PUT', url: '/account/email', headers: auth, payload: { email: 'x@test.local', currentPassword: PASSWORD } });
    expect(e.statusCode).toBe(403);
    const p = await harness.app.inject({ method: 'PUT', url: '/account/password', headers: auth, payload: { currentPassword: PASSWORD, newPassword: 'new-pw-9876' } });
    expect(p.statusCode).toBe(403);
  });
});
