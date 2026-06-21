import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { seedInstance, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from '../src/seed.js';
import { users, projects } from '../src/db/schema.js';

// Each test registers the admin via argon2 (CPU-heavy); under the full suite + coverage that can
// exceed the 5s default, so give these a generous ceiling (they're not slow on their own).
describe('seedInstance — first-boot bootstrap', { timeout: 30_000 }, () => {
  it('seeds the admin + Example Project, is idempotent, and the admin can log in', async () => {
    const db = await makeTestDb();
    await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1' });

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
      payload: { email: 'admin@sitewright.example', password: 'Pw-secret-1' },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });

  it('the seeded admin is an instance admin via its persisted platform_role', async () => {
    // Admin is a persisted role (the seed sets platform_role='admin') — no env email allowlist.
    const db = await makeTestDb();
    await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1' });

    const app = await createApp({ db });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@sitewright.example', password: 'Pw-secret-1' },
    });
    const cookie = login.cookies.find((c) => c.name === 'sw_session')?.value;
    expect(cookie).toBeTruthy();

    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: cookie! } });
    expect((me.json() as { isInstanceAdmin: boolean }).isInstanceAdmin).toBe(true);
    await app.close();
  });

  it('uses the FIXED default credentials when none are configured — and warns loudly', async () => {
    // Deliberate product decision: the first-boot credentials are always
    // admin@sitewright.example / 123456 — predictable, never auto-generated.
    const db = await makeTestDb();
    const log: string[] = [];
    await seedInstance({ db, adminEmail: DEFAULT_ADMIN_EMAIL, log: (m) => log.push(m) });
    expect(log.join('\n')).toMatch(/WARNING/); // grep-discoverable on the credential notice itself
    expect(log.join('\n')).toMatch(/DEFAULT password/);
    expect(log.join('\n')).toMatch(/change it after first login/i);

    const app = await createApp({ db });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    // An explicit SW_ADMIN_PASSWORD still wins over the default (no warning)…
    const db2 = await makeTestDb();
    const log2: string[] = [];
    await seedInstance({ db: db2, adminEmail: DEFAULT_ADMIN_EMAIL, adminPassword: 'Pw-secret-1', log: (m) => log2.push(m) });
    expect(log2.join('\n')).not.toMatch(/DEFAULT password/);
    // …but a whitespace-only value means "use the default" (warned), never a
    // whitespace password that locks everyone out.
    const db3 = await makeTestDb();
    const log3: string[] = [];
    await seedInstance({ db: db3, adminEmail: DEFAULT_ADMIN_EMAIL, adminPassword: '   ', log: (m) => log3.push(m) });
    expect(log3.join('\n')).toMatch(/DEFAULT password/);
    await app.close();
  });
});
