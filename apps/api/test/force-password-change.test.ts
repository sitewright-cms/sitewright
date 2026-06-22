import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { seedInstance, DEFAULT_ADMIN_EMAIL } from '../src/seed.js';
import { registerAccount } from '../src/repo/accounts.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/client.js';

/**
 * PR4 of the env-slimming epic: the first-boot admin left on the well-known DEFAULT password is forced
 * to change it before doing anything. The seed sets `users.must_change_password` ONLY for that case; a
 * server guard 403s every state-changing request with a `password-change-required` sentinel until the
 * password is changed (which clears the flag).
 */

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}

/** Registers a flagged admin directly (fast — skips the full demo seed) and returns a live session cookie. */
async function flaggedAdmin(db: Database, app: FastifyInstance, password = 'Pw-secret-1'): Promise<{ email: string; cookie: string }> {
  const email = 'forced@x.test';
  await registerAccount(db, email, password, { platformRole: 'admin', mustChangePassword: true });
  return { email, cookie: await login(app, email, password) };
}

describe('seed sets must_change_password only for the default password', () => {
  it('DEFAULT password → flag true', async () => {
    const db = await makeTestDb();
    await seedInstance({ db, adminEmail: DEFAULT_ADMIN_EMAIL });
    const [admin] = await db.select().from(users).where(eq(users.email, DEFAULT_ADMIN_EMAIL));
    expect(admin?.mustChangePassword).toBe(true);
  });

  it('explicit SW_ADMIN_PASSWORD → flag false', async () => {
    const db = await makeTestDb();
    await seedInstance({ db, adminEmail: DEFAULT_ADMIN_EMAIL, adminPassword: 'A-real-Pw-1' });
    const [admin] = await db.select().from(users).where(eq(users.email, DEFAULT_ADMIN_EMAIL));
    expect(admin?.mustChangePassword).toBe(false);
  });
});

describe('GET /me exposes mustChangePassword', () => {
  it('is true for the default-password admin and false for a normal user', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();

    const { cookie: forcedCookie } = await flaggedAdmin(db, app);
    const me1 = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: forcedCookie } });
    expect((me1.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    await registerAccount(db, 'normal@x.test', 'Pw-secret-1');
    const normalCookie = await login(app, 'normal@x.test', 'Pw-secret-1');
    const me2 = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: normalCookie } });
    expect((me2.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
    await app.close();
  });
});

describe('the forced-change guard', () => {
  it('403s state-changing requests with the sentinel but allows reads', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    const { cookie } = await flaggedAdmin(db, app);

    // A read passes through (so the SPA can load and show the forced screen).
    const read = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: cookie } });
    expect(read.statusCode).toBe(200);

    // A mutating request is blocked with the recognizable sentinel — before the handler runs.
    const write = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: { sw_session: cookie },
      payload: { name: 'Nope', slug: 'nope' },
    });
    expect(write.statusCode).toBe(403);
    expect((write.json() as { error: string }).error).toBe('password-change-required');
    await app.close();
  });

  it('lets the user change their password (escape hatch), which clears the flag and unblocks writes', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    const { cookie } = await flaggedAdmin(db, app, 'Pw-secret-1');

    // The change-password escape hatch is allowed even while flagged.
    const change = await app.inject({
      method: 'PUT',
      url: '/account/password',
      cookies: { sw_session: cookie },
      payload: { currentPassword: 'Pw-secret-1', newPassword: 'New-Pw-secret-2' },
    });
    expect(change.statusCode).toBe(204);

    // Flag cleared in the DB; /me reflects it; this session survives (others were revoked).
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: cookie } });
    expect((me.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(false);

    // A previously-blocked mutating request now goes through to the handler (201, not the 403 sentinel).
    const write = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: { sw_session: cookie },
      payload: { name: 'Now allowed', slug: 'now-allowed' },
    });
    expect(write.statusCode).toBe(201);
    await app.close();
  });

  it('lets a flagged user sign out', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    const { cookie } = await flaggedAdmin(db, app);
    const out = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { sw_session: cookie } });
    expect(out.statusCode).toBeLessThan(400);
    await app.close();
  });

  it('does not affect a normal (non-flagged) user', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    await registerAccount(db, 'normal@x.test', 'Pw-secret-1');
    const cookie = await login(app, 'normal@x.test', 'Pw-secret-1');
    const write = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: { sw_session: cookie },
      payload: { name: 'Fine', slug: 'fine' },
    });
    expect(write.statusCode).toBe(201);
    await app.close();
  });
});
