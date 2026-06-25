import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

let app: FastifyInstance;
let db: Database;

// The owner registers as `owner@acme.test` and is promoted to a platform (instance) admin via the
// persisted `platform_role` (registerOwner promotes it) — the way to exercise the platform-admin
// endpoints (platform invites, platform invite listing) in an HTTP test.
const ADMIN_EMAIL = 'owner@acme.test';

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function registerOwner(email: string) {
  // The owner is the instance admin in these tests. The /auth/register route is invite-only now, so
  // seed the account via the repo with the admin platform role, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', email === ADMIN_EMAIL ? { platformRole: 'admin' } : {});
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  return { t: token(login) };
}

async function makeProject(t: string, slug: string) {
  const res = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: slug, slug } });
  return (res.json() as { project: { id: string } }).project.id;
}

describe('invites API', () => {
  it('client invite → peek → register + accept → reaches ONLY the invited project', async () => {
    const { t } = await registerOwner('owner@acme.test');
    const projA = await makeProject(t, 'site-a');
    const projB = await makeProject(t, 'site-b');
    // Seed a page on project A so the client has something to read.
    await app.inject({ method: 'PUT', url: `/projects/${projA}/content/page/home`, cookies: { sw_session: t }, payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } } });

    // Owner invites a client to project A only.
    const inv = await app.inject({ method: 'POST', url: `/projects/${projA}/invites`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    expect(inv.statusCode).toBe(201);
    const inviteToken = (inv.json() as { token: string }).token;

    // The token holder peeks for context — the invited email is DISCLOSED (the unguessable token proves
    // they were sent it) so the accept form can pre-fill it, and hasAccount is false (no account yet).
    const peek = await app.inject({ method: 'GET', url: `/invites/peek?token=${inviteToken}` });
    expect(peek.json()).toMatchObject({ invite: { role: 'member', projectName: 'site-a', email: 'client@acme.test', hasAccount: false } });

    // The client registers and accepts.
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'client@acme.test', password: 'Pw-secret-1' } });
    const clientT = token(reg);
    const accept = await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: clientT }, payload: { token: inviteToken } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ projectId: projA, role: 'member' });

    // /me now surfaces project A as project-scoped access.
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: clientT } });
    const access = (me.json() as { projects: Array<{ id: string }> }).projects;
    expect(access.map((a) => a.id)).toEqual([projA]);

    // The client can read project A …
    expect((await app.inject({ method: 'GET', url: `/projects/${projA}/content/page/home`, cookies: { sw_session: clientT } })).statusCode).toBe(200);
    // … but NOT project B (no membership → 403).
    expect((await app.inject({ method: 'GET', url: `/projects/${projB}/content/page/home`, cookies: { sw_session: clientT } })).statusCode).toBe(403);
    // … and the project list returns ONLY the client's membership (project A), never project B.
    const projList = await app.inject({ method: 'GET', url: `/projects`, cookies: { sw_session: clientT } });
    expect(projList.statusCode).toBe(200);
    expect((projList.json() as { projects: Array<{ id: string }> }).projects.map((p) => p.id)).toEqual([projA]);
  });

  it('platform-admin invite → accept → instance admin reaching ALL projects', async () => {
    // Owner (an instance admin via the persisted role) owns a project nobody else is a member of.
    const { t } = await registerOwner('owner@acme.test');
    const ownerProject = await makeProject(t, 'site');

    // A PLATFORM invite (no projectId) with role:'admin' — requires a platform-admin caller.
    const inv = await app.inject({ method: 'POST', url: `/admin/invites`, cookies: { sw_session: t }, payload: { email: 'dev@acme.test', role: 'admin' } });
    expect(inv.statusCode).toBe(201);
    const inviteToken = (inv.json() as { token: string }).token;

    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'dev@acme.test', password: 'Pw-secret-1' } });
    const devT = token(reg);
    await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: devT }, payload: { token: inviteToken } });

    // The accepted user is now an instance admin: /me reflects it, and they reach EVERY project —
    // including the owner's project they were never explicitly added to → 200 (real authz signal).
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: devT } });
    expect(me.json()).toMatchObject({ platformRole: 'admin', isInstanceAdmin: true });
    expect((await app.inject({ method: 'GET', url: `/projects/${ownerProject}`, cookies: { sw_session: devT } })).statusCode).toBe(200);
  });

  it('plain developer invite → accept → platformRole:developer (not an instance admin)', async () => {
    const { t } = await registerOwner('owner@acme.test');
    // A PLATFORM invite with no role defaults to developer.
    const inv = await app.inject({ method: 'POST', url: `/admin/invites`, cookies: { sw_session: t }, payload: { email: 'dev@acme.test' } });
    expect(inv.statusCode).toBe(201);
    const inviteToken = (inv.json() as { token: string }).token;

    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'dev@acme.test', password: 'Pw-secret-1' } });
    const devT = token(reg);
    await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: devT }, payload: { token: inviteToken } });

    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: devT } });
    // A developer is platform staff but NOT an instance admin (no all-projects reach).
    expect(me.json()).toMatchObject({ platformRole: 'developer', isInstanceAdmin: false });
  });

  it('rejects acceptance by the wrong email and enforces owner/admin to invite', async () => {
    const { t } = await registerOwner('owner@acme.test');
    const proj = await makeProject(t, 'site');
    const inv = await app.inject({ method: 'POST', url: `/projects/${proj}/invites`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    const inviteToken = (inv.json() as { token: string }).token;

    // A different person cannot accept the client invite. The intruder holds NO pending invite, so it
    // can't self-register (invite-only) — seed a plain account via the repo, then log in for a session.
    await registerAccount(db, 'intruder@evil.test', 'Pw-secret-1');
    const intruder = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'intruder@evil.test', password: 'Pw-secret-1' } });
    expect((await app.inject({ method: 'POST', url: '/invites/accept', cookies: { sw_session: token(intruder) }, payload: { token: inviteToken } })).statusCode).toBe(403);

    // The intruder (a non-member) cannot create invites for this project.
    expect((await app.inject({ method: 'POST', url: `/projects/${proj}/invites`, cookies: { sw_session: token(intruder) }, payload: { email: 'x@acme.test' } })).statusCode).toBe(403);
    // Accept requires a session (no cookie → 401).
    expect((await app.inject({ method: 'POST', url: '/invites/accept', payload: { token: inviteToken } })).statusCode).toBe(401);
  });

  it('lists and revokes pending PROJECT invites (owner) scoped by projectId', async () => {
    const { t } = await registerOwner('owner@acme.test');
    const proj = await makeProject(t, 'site');
    const inv = await app.inject({ method: 'POST', url: `/projects/${proj}/invites`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    const inviteId = (inv.json() as { invite: { id: string } }).invite.id;

    // Project invites are listed via the project-scoped invites route (owner/admin).
    const list = await app.inject({ method: 'GET', url: `/projects/${proj}/invites`, cookies: { sw_session: t } });
    expect((list.json() as { invites: unknown[] }).invites).toHaveLength(1);
    // Revoke via DELETE /invites/:id (owner for a project invite).
    expect((await app.inject({ method: 'DELETE', url: `/invites/${inviteId}`, cookies: { sw_session: t } })).statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/projects/${proj}/invites`, cookies: { sw_session: t } });
    expect((after.json() as { invites: unknown[] }).invites).toHaveLength(0);
  });
});
