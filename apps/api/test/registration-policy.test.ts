import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { seedInstance } from '../src/seed.js';

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

describe('registration policy', () => {
  it('the factory default (createApp) leaves registration open', async () => {
    // The embeddable default is open; the production entry point (server.ts) passes openRegistration:false
    // so a DEPLOYED instance is closed (asserted via the explicit openRegistration:false cases below).
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'anyone@x.test', password: 'Pw-secret-1'},
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('a DEPLOYED instance (openRegistration:false) is invitation-only by default', async () => {
    const app = await createApp({ db: await makeTestDb(), openRegistration: false });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'anyone@x.test', password: 'Pw-secret-1'},
    });
    expect(res.statusCode).toBe(403); // an admin opens it at runtime via allowSelfRegistration
    await app.close();
  });

  describe('closed (invitation-only)', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      const db = await makeTestDb();
      // Seed the bootstrap admin out-of-band (bypasses the closed route), then run closed.
      await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1' });
      app = await createApp({ db, openRegistration: false });
      await app.ready();
    });

    it('rejects an uninvited email with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'stranger@x.test', password: 'Pw-secret-1'},
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('admits an email that holds a pending invite', async () => {
      // Admin logs in and invites a developer.
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@sitewright.example', password: 'Pw-secret-1' } });
      const adminCookie = token(login);
      const invited = 'invitee@x.test';
      const inv = await app.inject({ method: 'POST', url: `/admin/invites`, cookies: { sw_session: adminCookie }, payload: { email: invited } });
      expect(inv.statusCode).toBe(201);

      // The invited email may now register (then it would accept the invite).
      const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: invited, password: 'Pw-secret-1' } });
      expect(reg.statusCode).toBe(201);
      await app.close();
    });
  });

  // The admin instance setting is authoritative once set: it overrides the deploy-time factory default
  // (opts.openRegistration) in BOTH directions, and surfaces as the effective flag on /auth/config.
  describe('admin self-registration toggle', () => {
    async function bootClosedWithAdmin() {
      const db = await makeTestDb();
      await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1' });
      // Factory default CLOSED — so only the admin setting can re-open it.
      const app = await createApp({ db, openRegistration: false });
      await app.ready();
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@sitewright.example', password: 'Pw-secret-1' } });
      return { app, adminCookie: token(login) };
    }

    it('opens self-registration when enabled, despite a closed factory default', async () => {
      const { app, adminCookie } = await bootClosedWithAdmin();
      // Closed by factory default + setting unset → a stranger is rejected.
      const before = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'stranger@x.test', password: 'Pw-secret-1' } });
      expect(before.statusCode).toBe(403);
      // Admin flips the instance setting on.
      const put = await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: adminCookie }, payload: { allowSelfRegistration: true } });
      expect(put.statusCode).toBe(200);
      expect(put.json().settings.allowSelfRegistration).toBe(true);
      // Now an uninvited stranger may self-register.
      const after = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'stranger@x.test', password: 'Pw-secret-1' } });
      expect(after.statusCode).toBe(201);
      await app.close();
    });

    it('closes self-registration when disabled, despite an open factory default', async () => {
      const db = await makeTestDb();
      await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1' });
      const app = await createApp({ db, openRegistration: true });
      await app.ready();
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@sitewright.example', password: 'Pw-secret-1' } });
      const put = await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: token(login) }, payload: { allowSelfRegistration: false } });
      expect(put.statusCode).toBe(200);
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'stranger@x.test', password: 'Pw-secret-1' } });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('reflects the effective flag on the public /auth/config', async () => {
      const { app, adminCookie } = await bootClosedWithAdmin();
      expect((await app.inject({ method: 'GET', url: '/auth/config' })).json().allowSelfRegistration).toBe(false);
      await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: adminCookie }, payload: { allowSelfRegistration: true } });
      expect((await app.inject({ method: 'GET', url: '/auth/config' })).json().allowSelfRegistration).toBe(true);
      await app.close();
    });
  });

  // The shared password policy applies to the register body.
  describe('password policy on register', () => {
    it('rejects a password missing a character class (400 with the specific rule)', async () => {
      const app = await createApp({ db: await makeTestDb() });
      await app.ready();
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'weak@x.test', password: 'alllowercase1!' } });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('invalid request');
      expect(body.details.fieldErrors.password).toContain('One uppercase letter');
      await app.close();
    });

    it('accepts a fully-compliant password (201)', async () => {
      const app = await createApp({ db: await makeTestDb() });
      await app.ready();
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'strong@x.test', password: 'Str0ng-Pw!' } });
      expect(res.statusCode).toBe(201);
      await app.close();
    });
  });
});
