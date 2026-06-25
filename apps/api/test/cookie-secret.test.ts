import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no sw_session cookie');
  return t;
}
// The /auth/register route is invite-only now, so seed accounts via the repo (bypasses the gate +
// password policy), then log in for a session cookie. `admin` seeds the instance-admin platform role.
async function register(db: Database, app: FastifyInstance, email: string, admin = false): Promise<string> {
  await registerAccount(db, email, 'Pw-secret-1', admin ? { platformRole: 'admin' } : {});
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  if (login.statusCode !== 200) throw new Error(`login ${login.statusCode}: ${login.body}`);
  return token(login);
}
const me = (app: FastifyInstance, t: string) => app.inject({ method: 'GET', url: '/me', cookies: { sw_session: t } });

describe('cookie secret: auto-generate, persist, rotate', () => {
  it('auto-generates a secret and a session survives a "restart" (same DB → same secret)', async () => {
    const db = await makeTestDb();
    const app1 = await createApp({ db }); // no cookieSecret → auto-generated + persisted
    await app1.ready();
    const cookie = await register(db, app1, 'a@x.test');
    expect((await me(app1, cookie)).statusCode).toBe(200);
    await app1.close();

    // A fresh app over the SAME db reads the persisted secret → the old cookie still verifies.
    const app2 = await createApp({ db });
    await app2.ready();
    expect((await me(app2, cookie)).statusCode).toBe(200);
    await app2.close();
  });

  it('a fresh DB with no env secret still signs cookies (no raw-token acceptance)', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    const cookie = await register(db, app, 'b@x.test');
    // The cookie is signed (value carries an HMAC suffix), and a raw/tampered value is rejected.
    expect(cookie).toContain('.');
    expect((await me(app, cookie)).statusCode).toBe(200);
    expect((await me(app, `${cookie}x`)).statusCode).toBe(401);
    await app.close();
  });

  it('rotating the secret invalidates existing cookies; a new login works', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    const adminCookie = await register(db, app, 'admin@x.test', true);
    expect((await me(app, adminCookie)).statusCode).toBe(200);

    // GET reports it is NOT pinned (auto-generated).
    const settings = await app.inject({ method: 'GET', url: '/admin/settings', cookies: { sw_session: adminCookie } });
    const sj = settings.json() as { cookieSecretPinned: boolean; settings: Record<string, unknown> };
    expect(sj.cookieSecretPinned).toBe(false);
    expect(sj.settings.cookieSecret).toBeUndefined(); // the secret is never in the masked settings view

    const rot = await app.inject({ method: 'POST', url: '/admin/cookie-secret/rotate', cookies: { sw_session: adminCookie } });
    expect(rot.statusCode).toBe(200);

    // The old cookie no longer verifies → everyone re-logs-in.
    expect((await me(app, adminCookie)).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@x.test', password: 'Pw-secret-1' } });
    expect(login.statusCode).toBe(200);
    expect((await me(app, token(login))).statusCode).toBe(200);
    await app.close();
  });

  it('a rotation persists: a fresh app over the same DB rejects pre-rotation cookies', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    const adminCookie = await register(db, app, 'admin@x.test', true);
    await app.inject({ method: 'POST', url: '/admin/cookie-secret/rotate', cookies: { sw_session: adminCookie } });
    const fresh = await register(db, app, 'c@x.test'); // signed with the rotated secret
    await app.close();

    const app2 = await createApp({ db });
    await app2.ready();
    expect((await me(app2, fresh)).statusCode).toBe(200); // post-rotation cookie still valid
    await app2.close();
  });

  it('an env-pinned secret cannot be rotated (409) and reports pinned', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db, cookieSecret: 'pinned-env-secret' });
    await app.ready();
    const adminCookie = await register(db, app, 'admin@x.test', true);
    const settings = await app.inject({ method: 'GET', url: '/admin/settings', cookies: { sw_session: adminCookie } });
    expect((settings.json() as { cookieSecretPinned: boolean }).cookieSecretPinned).toBe(true);
    const rot = await app.inject({ method: 'POST', url: '/admin/cookie-secret/rotate', cookies: { sw_session: adminCookie } });
    expect(rot.statusCode).toBe(409);
    expect((await me(app, adminCookie)).statusCode).toBe(200); // still valid (no rotation happened)
    await app.close();
  });
});
