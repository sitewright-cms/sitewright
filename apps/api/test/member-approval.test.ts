import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import type { Database } from '../src/db/client.js';

let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const token = (res: { cookies: Array<{ name: string; value: string }> }): string => {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
};

async function login(email: string, password = 'Pw-secret-1'): Promise<string> {
  return token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } }));
}

/** A staff owner with a project, plus a pending client invite on it. */
async function setup(): Promise<{ t: string; projectId: string; inviteId: string; inviteToken: string; email: string }> {
  await registerAccount(db, 'owner@agency.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = await login('owner@agency.test');
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  const email = 'client@example.test';
  const inv = await app.inject({ method: 'POST', url: `/projects/${projectId}/invites`, cookies: { sw_session: t }, payload: { email } });
  expect(inv.statusCode).toBe(201);
  const inviteToken = (inv.json() as { token: string }).token;
  const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/invites`, cookies: { sw_session: t } });
  const inviteId = (list.json() as { invites: Array<{ id: string; email: string }> }).invites.find((i) => i.email === email)!.id;
  return { t, projectId, inviteId, inviteToken, email };
}

describe('approving a pending member without the invite link', () => {
  it('creates the account, grants membership, and returns a one-time password', async () => {
    const { t, projectId, inviteId, email } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/invites/${inviteId}/approve`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { email: string; created: boolean; password?: string };
    expect(body).toMatchObject({ email, created: true });
    expect(body.password, 'a new account gets a password to hand over').toBeTruthy();

    // The password works — the whole point is the invitee can sign in with it immediately.
    const signIn = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: body.password } });
    expect(signIn.statusCode).toBe(200);

    // …and they are a member of the project.
    const members = await app.inject({ method: 'GET', url: `/projects/${projectId}/members`, cookies: { sw_session: t } });
    expect((members.json() as { members: Array<{ email: string }> }).members.map((m) => m.email)).toContain(email);
  });

  it('BURNS the outstanding invite link, so the same grant cannot be redeemed twice', async () => {
    const { t, projectId, inviteId, inviteToken } = await setup();
    await app.inject({ method: 'POST', url: `/projects/${projectId}/invites/${inviteId}/approve`, cookies: { sw_session: t } });

    // Someone else signs up and tries the link that was mailed out earlier.
    await registerAccount(db, 'stranger@example.test', 'Pw-secret-1');
    const strangerT = await login('stranger@example.test');
    const redeem = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      cookies: { sw_session: strangerT },
      payload: { token: inviteToken },
    });
    expect(redeem.statusCode, 'a used invite is not redeemable').toBeGreaterThanOrEqual(400);
  });

  it('grants an EXISTING account without touching its password', async () => {
    const { t, projectId, inviteId, email } = await setup();
    await registerAccount(db, email, 'TheirOwn-1!');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/invites/${inviteId}/approve`, cookies: { sw_session: t } });
    const body = res.json() as { created: boolean; password?: string };
    expect(body.created).toBe(false);
    expect(body.password, 'never mint a password for an account that has one').toBeUndefined();
    // Their existing password still works — approval is a GRANT, not a credential change.
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'TheirOwn-1!' } })).statusCode).toBe(200);
  });

  it('refuses a second approval', async () => {
    const { t, projectId, inviteId } = await setup();
    await app.inject({ method: 'POST', url: `/projects/${projectId}/invites/${inviteId}/approve`, cookies: { sw_session: t } });
    const again = await app.inject({ method: 'POST', url: `/projects/${projectId}/invites/${inviteId}/approve`, cookies: { sw_session: t } });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('will not approve an invite belonging to another project', async () => {
    const { t, inviteId } = await setup();
    const other = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Other', slug: 'other' } });
    const otherId = (other.json() as { project: { id: string } }).project.id;
    const res = await app.inject({ method: 'POST', url: `/projects/${otherId}/invites/${inviteId}/approve`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(404);
  });
});

describe('resetting a member password', () => {
  it('issues a working password for a project-only member', async () => {
    const { t, projectId, inviteId, email } = await setup();
    const approved = await app.inject({ method: 'POST', url: `/projects/${projectId}/invites/${inviteId}/approve`, cookies: { sw_session: t } });
    const userId = (approved.json() as { userId: string }).userId;

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/members/${userId}/password`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    const { password } = res.json() as { password: string };
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })).statusCode).toBe(200);
  });

  it('REFUSES a member who also has access elsewhere, unless the caller is a platform admin', async () => {
    // The guard that matters: managing one project must not hand over an account that reaches further.
    const { t, projectId } = await setup();
    const staff = await registerAccount(db, 'other-staff@agency.test', 'Pw-secret-1', { platformRole: 'developer' });
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      cookies: { sw_session: t },
      payload: { userId: staff.userId, role: 'member' },
    });
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/members/${staff.userId}/password`, cookies: { sw_session: t } });
    expect(res.statusCode, 'a developer account is not a project owner’s to reset').toBeGreaterThanOrEqual(400);
    // And the account still works with its own password.
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'other-staff@agency.test', password: 'Pw-secret-1' } })).statusCode).toBe(200);
  });

  it('refuses a user who is not a member of the project at all', async () => {
    const { t, projectId } = await setup();
    const outsider = await registerAccount(db, 'outsider@example.test', 'Pw-secret-1');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/members/${outsider.userId}/password`, cookies: { sw_session: t } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
