import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  const db = await makeTestDb();
  app = await createApp({ db });
  await app.ready();
});

function sessionToken(res: { cookies: Array<{ name: string; value: string }> }): string {
  const token = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!token) throw new Error('no session cookie set');
  return token;
}

async function register(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1' },
  });
  return { res, token: sessionToken(res), body: res.json() as { userId: string } };
}

describe('API — auth + tenant-scoped projects', () => {
  it('registers, sets a session, and returns the current user', async () => {
    const { res, token, body } = await register('a@acme.test');
    expect(res.statusCode).toBe(201);
    expect(body.userId).toBeTruthy();

    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: token } });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { userId: string; projects: unknown[] };
    expect(meBody.userId).toBe(body.userId);
    // A fresh user holds no project memberships until they create or are invited to one.
    expect(meBody.projects).toHaveLength(0);
  });

  it('requires authentication for /me', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login with a wrong password', async () => {
    await register('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@acme.test', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates the register body (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'short'},
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates and lists projects for the caller', async () => {
    const { token } = await register('a@acme.test');
    const created = await app.inject({
      method: 'POST',
      url: `/projects`,
      cookies: { sw_session: token },
      payload: { name: 'Client Site', slug: 'client-site' },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/projects`,
      cookies: { sw_session: token },
    });
    expect((list.json() as { projects: unknown[] }).projects).toHaveLength(1);
  });

  it('isolates tenants by project: B’s project list excludes A’s project and B cannot read it', async () => {
    const a = await register('a@acme.test');
    const b = await register('b@globex.test');
    const created = await app.inject({
      method: 'POST',
      url: `/projects`,
      cookies: { sw_session: a.token },
      payload: { name: 'Secret', slug: 'secret-a' },
    });
    const projectId = (created.json() as { project: { id: string } }).project.id;

    // Flat tenancy: the project list
    // is per-user (each sees only memberships they own). B has its own project…
    const bCreated = await app.inject({
      method: 'POST',
      url: `/projects`,
      cookies: { sw_session: b.token },
      payload: { name: 'Bee', slug: 'secret-b' },
    });
    const bProjectId = (bCreated.json() as { project: { id: string } }).project.id;

    // …and B's list must contain only B's project, never A's.
    const bLists = await app.inject({
      method: 'GET',
      url: `/projects`,
      cookies: { sw_session: b.token },
    });
    expect(bLists.statusCode).toBe(200);
    const bIds = (bLists.json() as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(bIds).toContain(bProjectId);
    expect(bIds).not.toContain(projectId);

    // B reading A's project by id is forbidden (not a member) → 403, no leak.
    const bReadsA = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}`,
      cookies: { sw_session: b.token },
    });
    expect(bReadsA.statusCode).toBe(403);
    expect(bReadsA.body).not.toContain('Secret');
  });

  it('logs out (session no longer valid)', async () => {
    const { token } = await register('a@acme.test');
    await app.inject({ method: 'POST', url: '/auth/logout', cookies: { sw_session: token } });
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: token } });
    expect(me.statusCode).toBe(401);
  });
});

describe('signed sessions (cookieSecret configured)', () => {
  it('round-trips a signed cookie and rejects a tampered one', async () => {
    const db = await makeTestDb();
    const signedApp = await createApp({ db, cookieSecret: 'test-cookie-secret' });
    await signedApp.ready();

    const reg = await signedApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 's@x.test', password: 'pw-secret-1'},
    });
    expect(reg.statusCode).toBe(201);
    const token = sessionToken(reg);

    // A correctly-signed cookie authenticates.
    const ok = await signedApp.inject({ method: 'GET', url: '/me', cookies: { sw_session: token } });
    expect(ok.statusCode).toBe(200);

    // A tampered cookie fails signature verification → unauthenticated.
    const tampered = await signedApp.inject({
      method: 'GET',
      url: '/me',
      cookies: { sw_session: `${token}x` },
    });
    expect(tampered.statusCode).toBe(401);
  });
});
