import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { seedInstance } from '../src/seed.js';

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

// Registration is INVITATION-ONLY: there is no self-registration toggle. The bootstrap admin is
// seeded out-of-band (seedInstance), never registered — so the closed route never locks the operator
// out. An email may register only if it holds a pending invite (minted here by the seeded admin via
// `POST /admin/invites`, the same path the invite suites use).
describe('registration policy (invitation-only)', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeEach(async () => {
    db = await makeTestDb();
    // Seed the bootstrap admin out-of-band (bypasses the closed route).
    await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1' });
    app = await createApp({ db });
    await app.ready();
  });

  /** Logs the seeded admin in and returns the session cookie. */
  async function adminCookie(): Promise<string> {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@sitewright.example', password: 'Pw-secret-1' } });
    expect(login.statusCode).toBe(200);
    return token(login);
  }

  /** Mints a pending platform invite for `email` via the admin route (the real invite path). */
  async function invite(email: string): Promise<void> {
    const inv = await app.inject({ method: 'POST', url: '/admin/invites', cookies: { sw_session: await adminCookie() }, payload: { email } });
    expect(inv.statusCode).toBe(201);
  }

  it('rejects an uninvited email with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'stranger@x.test', password: 'Pw-secret-1' },
    });
    expect(res.statusCode).toBe(403);
    // A rejected registration must not mint a session cookie.
    expect(res.cookies.find((c) => c.name === 'sw_session')).toBeUndefined();
  });

  it('admits an email that holds a pending invite (201 + a session)', async () => {
    const invited = 'invitee@x.test';
    await invite(invited);
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: invited, password: 'Pw-secret-1' } });
    expect(reg.statusCode).toBe(201);
    // The successful registration logs the new user in.
    expect(token(reg)).toBeTruthy();
  });

  // The shared password policy applies to the register body — but it runs only for an INVITED email
  // (an uninvited one is rejected at the invite gate before validation).
  describe('password policy on register (invited email)', () => {
    it('rejects a password missing a character class (400 with the specific rule)', async () => {
      const email = 'weak@x.test';
      await invite(email);
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'alllowercase1!' } });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('invalid request');
      expect(body.details.fieldErrors.password).toContain('One uppercase letter');
    });

    it('accepts a fully-compliant password (201)', async () => {
      const email = 'strong@x.test';
      await invite(email);
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'Str0ng-Pw!' } });
      expect(res.statusCode).toBe(201);
    });
  });
});
