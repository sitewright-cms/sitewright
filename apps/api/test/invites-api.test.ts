import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function registerOwner(email: string, orgName: string) {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'pw-secret-1', orgName } });
  return { t: token(reg), orgId: (reg.json() as { orgId: string }).orgId };
}

async function makeProject(t: string, orgId: string, slug: string) {
  const res = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects`, cookies: { sw_session: t }, payload: { name: slug, slug } });
  return (res.json() as { project: { id: string } }).project.id;
}

describe('invites API', () => {
  it('client invite → peek → register + accept → reaches ONLY the invited project', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    const projA = await makeProject(t, orgId, 'site-a');
    const projB = await makeProject(t, orgId, 'site-b');
    // Seed a page on project A so the client has something to read.
    await app.inject({ method: 'PUT', url: `/orgs/${orgId}/projects/${projA}/content/page/home`, cookies: { sw_session: t }, payload: { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } } });

    // Owner invites a client to project A only.
    const inv = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects/${projA}/invites`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    expect(inv.statusCode).toBe(201);
    const inviteToken = (inv.json() as { token: string }).token;

    // The token holder can peek to see context — but the email is masked, not disclosed.
    const peek = await app.inject({ method: 'GET', url: `/invites/peek?token=${inviteToken}` });
    expect(peek.json()).toMatchObject({ invite: { role: 'member', orgName: 'Acme', projectName: 'site-a' } });
    expect((peek.json() as { invite: { email: string } }).invite.email).not.toBe('client@acme.test');

    // The client registers (their own throwaway org) and accepts.
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'client@acme.test', password: 'pw-secret-1', orgName: 'Client Personal' } });
    const clientT = token(reg);
    const accept = await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: clientT }, payload: { token: inviteToken } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ projectId: projA, role: 'member' });

    // /me now surfaces project A as project-scoped access.
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: clientT } });
    const access = (me.json() as { projectAccess: Array<{ projectId: string }> }).projectAccess;
    expect(access.map((a) => a.projectId)).toEqual([projA]);

    // The client can read project A …
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects/${projA}/content/page/home`, cookies: { sw_session: clientT } })).statusCode).toBe(200);
    // … but NOT project B in the same org (no membership → 403).
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects/${projB}/content/page/home`, cookies: { sw_session: clientT } })).statusCode).toBe(403);
    // … and is not an org member (cannot list org projects).
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects`, cookies: { sw_session: clientT } })).statusCode).toBe(403);
  });

  it('developer invite → accept → org-wide admin access', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    await makeProject(t, orgId, 'site');
    const inv = await app.inject({ method: 'POST', url: `/orgs/${orgId}/invites`, cookies: { sw_session: t }, payload: { email: 'dev@acme.test' } });
    const inviteToken = (inv.json() as { token: string }).token;

    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'dev@acme.test', password: 'pw-secret-1', orgName: 'Dev Personal' } });
    const devT = token(reg);
    await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: devT }, payload: { token: inviteToken } });

    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: devT } });
    expect((me.json() as { orgs: Array<{ id: string; role: string }> }).orgs).toContainEqual(expect.objectContaining({ id: orgId, role: 'admin' }));
    // An admin can list the org's projects.
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects`, cookies: { sw_session: devT } })).statusCode).toBe(200);
  });

  it('rejects acceptance by the wrong email and enforces owner/admin to invite', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    const proj = await makeProject(t, orgId, 'site');
    const inv = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects/${proj}/invites`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    const inviteToken = (inv.json() as { token: string }).token;

    // A different person cannot accept the client invite.
    const intruder = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'intruder@evil.test', password: 'pw-secret-1', orgName: 'Evil' } });
    expect((await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: token(intruder) }, payload: { token: inviteToken } })).statusCode).toBe(403);

    // The intruder (a non-member of Acme) cannot create invites in Acme.
    expect((await app.inject({ method: 'POST', url: `/orgs/${orgId}/invites`, cookies: { sw_session: token(intruder) }, payload: { email: 'x@acme.test' } })).statusCode).toBe(403);
    // Accept requires a session (no cookie → 401).
    expect((await app.inject({ method: 'POST', url: '/invites/accept', payload: { token: inviteToken } })).statusCode).toBe(401);
  });

  it('lists and revokes pending invites (owner/admin)', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    const proj = await makeProject(t, orgId, 'site');
    const inv = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects/${proj}/invites`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    const inviteId = (inv.json() as { invite: { id: string } }).invite.id;

    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/invites`, cookies: { sw_session: t } });
    expect((list.json() as { invites: unknown[] }).invites).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/orgs/${orgId}/invites/${inviteId}`, cookies: { sw_session: t } })).statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/orgs/${orgId}/invites`, cookies: { sw_session: t } });
    expect((after.json() as { invites: unknown[] }).invites).toHaveLength(0);
  });
});
