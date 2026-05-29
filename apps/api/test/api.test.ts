import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  const db = await makeTestDb();
  app = createApp({ db });
  await app.ready();
});

function sessionToken(res: { cookies: Array<{ name: string; value: string }> }): string {
  const token = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!token) throw new Error('no session cookie set');
  return token;
}

async function register(email: string, orgName: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1', orgName },
  });
  return { res, token: sessionToken(res), body: res.json() as { userId: string; orgId: string } };
}

describe('API — auth + tenant-scoped projects', () => {
  it('registers, sets a session, and returns the current user', async () => {
    const { res, token, body } = await register('a@acme.test', 'Acme');
    expect(res.statusCode).toBe(201);
    expect(body.orgId).toBeTruthy();

    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: token } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { orgs: unknown[] }).orgs).toHaveLength(1);
  });

  it('requires authentication for /me', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login with a wrong password', async () => {
    await register('a@acme.test', 'Acme');
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
      payload: { email: 'not-an-email', password: 'short', orgName: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates and lists projects within the caller’s org', async () => {
    const { token, body } = await register('a@acme.test', 'Acme');
    const created = await app.inject({
      method: 'POST',
      url: `/orgs/${body.orgId}/projects`,
      cookies: { sw_session: token },
      payload: { name: 'Client Site', slug: 'client-site' },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/orgs/${body.orgId}/projects`,
      cookies: { sw_session: token },
    });
    expect((list.json() as { projects: unknown[] }).projects).toHaveLength(1);
  });

  it('isolates tenants: org B cannot list or read org A’s projects', async () => {
    const a = await register('a@acme.test', 'Acme');
    const b = await register('b@globex.test', 'Globex');
    const created = await app.inject({
      method: 'POST',
      url: `/orgs/${a.body.orgId}/projects`,
      cookies: { sw_session: a.token },
      payload: { name: 'Secret', slug: 'secret' },
    });
    const projectId = (created.json() as { project: { id: string } }).project.id;

    // B is not a member of A's org → 403 on A's org routes
    const bListsA = await app.inject({
      method: 'GET',
      url: `/orgs/${a.body.orgId}/projects`,
      cookies: { sw_session: b.token },
    });
    expect(bListsA.statusCode).toBe(403);

    const bReadsA = await app.inject({
      method: 'GET',
      url: `/orgs/${a.body.orgId}/projects/${projectId}`,
      cookies: { sw_session: b.token },
    });
    expect(bReadsA.statusCode).toBe(403);

    // Even via B's own org, A's project id is not found (no cross-tenant leak)
    const bReadsViaOwnOrg = await app.inject({
      method: 'GET',
      url: `/orgs/${b.body.orgId}/projects/${projectId}`,
      cookies: { sw_session: b.token },
    });
    expect(bReadsViaOwnOrg.statusCode).toBe(404);
  });

  it('logs out (session no longer valid)', async () => {
    const { token } = await register('a@acme.test', 'Acme');
    await app.inject({ method: 'POST', url: '/auth/logout', cookies: { sw_session: token } });
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: token } });
    expect(me.statusCode).toBe(401);
  });
});

describe('signed sessions (cookieSecret configured)', () => {
  it('round-trips a signed cookie and rejects a tampered one', async () => {
    const db = await makeTestDb();
    const signedApp = createApp({ db, cookieSecret: 'test-cookie-secret' });
    await signedApp.ready();

    const reg = await signedApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 's@x.test', password: 'pw-secret-1', orgName: 'Signed' },
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
