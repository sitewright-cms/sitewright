import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { seedInstance } from '../src/seed.js';
import { users, projects } from '../src/db/schema.js';

describe('seedInstance — first-boot bootstrap', () => {
  it('seeds the admin + Example Project, is idempotent, and the admin can log in', async () => {
    const db = await makeTestDb();
    await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'pw-secret-1' });

    // The super-admin and the showcase project exist.
    expect((await db.select().from(users)).map((u) => u.email)).toEqual(['admin@sitewright.example']);
    expect((await db.select().from(projects)).map((p) => p.name)).toEqual(['Example Project']);

    // Idempotent: once any user exists, a re-seed (even with different env) does nothing.
    await seedInstance({ db, adminEmail: 'someone-else@x.test', adminPassword: 'other' });
    expect((await db.select().from(users)).length).toBe(1);
    expect((await db.select().from(projects)).length).toBe(1);

    // The admin logs in with the configured password.
    const app = await createApp({ db });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@sitewright.example', password: 'pw-secret-1' },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });

  it('the seeded admin is an instance admin when its email is in the allowlist', async () => {
    // Mirrors server.ts, which adds SW_ADMIN_EMAIL to the instance-admin allowlist.
    const db = await makeTestDb();
    await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'pw-secret-1' });

    const app = await createApp({ db, adminEmails: ['admin@sitewright.example'] });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@sitewright.example', password: 'pw-secret-1' },
    });
    const cookie = login.cookies.find((c) => c.name === 'sw_session')?.value;
    expect(cookie).toBeTruthy();

    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: cookie! } });
    expect((me.json() as { isInstanceAdmin: boolean }).isInstanceAdmin).toBe(true);
    await app.close();
  });

  it('generates (and logs once) a password when none is configured', async () => {
    const db = await makeTestDb();
    const log: string[] = [];
    await seedInstance({ db, adminEmail: 'admin@x.test', log: (m) => log.push(m) });
    expect(log.join('\n')).toMatch(/GENERATED password:/);
    // No default password: a wrong/empty guess must not log in.
    const app = await createApp({ db });
    await app.ready();
    const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@x.test', password: '123456' } });
    expect(bad.statusCode).not.toBe(200);
    await app.close();
  });
});
