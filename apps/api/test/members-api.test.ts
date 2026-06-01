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

describe('org member management API', () => {
  it('provisions a client end-to-end: owner adds by email → client logs in with the one-time password → sees member role', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');

    const add = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      cookies: { sw_session: t },
      payload: { email: 'client@acme.test' },
    });
    expect(add.statusCode).toBe(201);
    const { member, tempPassword } = add.json() as { member: { userId: string; role: string }; tempPassword?: string };
    expect(member.role).toBe('member');
    expect(typeof tempPassword).toBe('string');

    // The client logs in with the returned one-time password.
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client@acme.test', password: tempPassword } });
    expect(login.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: token(login) } });
    const orgs = (me.json() as { orgs: Array<{ id: string; role: string }> }).orgs;
    expect(orgs).toEqual([expect.objectContaining({ id: orgId, role: 'member' })]);

    // Owner can list the members (owner + client).
    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/members`, cookies: { sw_session: t } });
    const emails = (list.json() as { members: Array<{ email: string }> }).members.map((m) => m.email).sort();
    expect(emails).toEqual(['client@acme.test', 'owner@acme.test']);
  });

  it('rejects a duplicate add (409) and a malformed email (400)', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    await app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, cookies: { sw_session: t }, payload: { email: 'c@acme.test' } });
    const dup = await app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, cookies: { sw_session: t }, payload: { email: 'c@acme.test' } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, cookies: { sw_session: t }, payload: { email: 'not-an-email' } });
    expect(bad.statusCode).toBe(400);
  });

  it('forbids a member from managing membership and isolates across orgs', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    const add = await app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    const { tempPassword } = add.json() as { tempPassword: string };
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client@acme.test', password: tempPassword } });
    const memberT = token(login);

    // The member cannot list or add members.
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}/members`, cookies: { sw_session: memberT } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, cookies: { sw_session: memberT }, payload: { email: 'x@acme.test' } })).statusCode).toBe(403);

    // A different org's owner cannot touch this org's membership (tenant isolation → 403, not a member).
    const other = await registerOwner('intruder@globex.test', 'Globex');
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}/members`, cookies: { sw_session: other.t } })).statusCode).toBe(403);
  });

  it('removes a member (204) but protects the owner and self', async () => {
    const { t, orgId } = await registerOwner('owner@acme.test', 'Acme');
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: t } });
    const ownerId = (me.json() as { userId: string }).userId;
    const add = await app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, cookies: { sw_session: t }, payload: { email: 'client@acme.test' } });
    const { member } = add.json() as { member: { userId: string } };

    expect((await app.inject({ method: 'DELETE', url: `/orgs/${orgId}/members/${ownerId}`, cookies: { sw_session: t } })).statusCode).toBe(403); // self/owner
    expect((await app.inject({ method: 'DELETE', url: `/orgs/${orgId}/members/${member.userId}`, cookies: { sw_session: t } })).statusCode).toBe(204);
    // The removed client is no longer a member.
    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/members`, cookies: { sw_session: t } });
    expect((list.json() as { members: unknown[] }).members).toHaveLength(1);
  });
});
