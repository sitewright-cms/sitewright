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
  it('open registration (default) lets anyone register', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'anyone@x.test', password: 'pw-secret-1', orgName: 'X' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  describe('closed (invitation-only)', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      const db = await makeTestDb();
      // Seed the bootstrap admin out-of-band (bypasses the closed route), then run closed.
      await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'pw-secret-1' });
      app = await createApp({ db, openRegistration: false, adminEmails: ['admin@sitewright.example'] });
      await app.ready();
    });

    it('rejects an uninvited email with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'stranger@x.test', password: 'pw-secret-1', orgName: 'S' },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('admits an email that holds a pending invite', async () => {
      // Admin logs in and invites a developer.
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@sitewright.example', password: 'pw-secret-1' } });
      const adminCookie = token(login);
      const orgId = ((await (await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: adminCookie } })).json()) as { orgs: Array<{ id: string }> }).orgs[0]!.id;
      const invited = 'invitee@x.test';
      const inv = await app.inject({ method: 'POST', url: `/orgs/${orgId}/invites`, cookies: { sw_session: adminCookie }, payload: { email: invited } });
      expect(inv.statusCode).toBe(201);

      // The invited email may now register (then it would accept the invite).
      const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: invited, password: 'pw-secret-1', orgName: 'Invitee' } });
      expect(reg.statusCode).toBe(201);
      await app.close();
    });
  });
});
