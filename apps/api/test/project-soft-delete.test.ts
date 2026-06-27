import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { newId } from '../src/id.js';
import { projectMembers, sessions, userMfaTotp, users } from '../src/db/schema.js';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;

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

/** Register a user (default agency staff) + log in for a session cookie. */
async function user(email: string, role: 'admin' | 'developer' | null = 'developer') {
  await registerAccount(db, email, 'Pw-secret-1', role ? { platformRole: role } : {});
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  return { id: (await db.select().from(users).where(eq(users.email, email)))[0]!.id, t: token(login) };
}

async function makeProject(t: string, slug = 'site') {
  const res = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return (res.json() as { project: { id: string } }).project.id;
}

/** Seed a CLIENT (platformRole null) as a member of a project (the invite flow is exercised elsewhere). */
async function addClient(projectId: string, email: string) {
  await registerAccount(db, email, 'Pw-secret-1', {});
  const userId = (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
  await db.insert(projectMembers).values({ id: newId(), userId, projectId, role: 'member', createdAt: new Date() });
  return userId;
}

const list = async (t: string) =>
  ((await app.inject({ method: 'GET', url: '/projects', cookies: { sw_session: t } })).json() as { projects: { id: string }[] }).projects;
const deletedList = async (t: string) =>
  ((await app.inject({ method: 'GET', url: '/admin/deleted-projects', cookies: { sw_session: t } })).json() as {
    projects: { id: string; deletedBy: string | null }[];
  }).projects;

describe('project soft-delete / restore / reap', () => {
  it('soft-delete hides the project from the list + 404s its routes, but keeps the row', async () => {
    const owner = await user('owner@sd.test', 'admin');
    const id = await makeProject(owner.t, 'acme');
    expect(await list(owner.t)).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/projects/${id}`, cookies: { sw_session: owner.t } });
    expect(del.statusCode).toBe(204);

    // Gone from the list; its project routes 404; but the admin can still see it under deleted-projects.
    expect(await list(owner.t)).toHaveLength(0);
    const page = await app.inject({ method: 'GET', url: `/projects/${id}/content/page`, cookies: { sw_session: owner.t } });
    expect(page.statusCode).toBe(404);
    const deleted = await deletedList(owner.t);
    expect(deleted.map((p) => p.id)).toEqual([id]);
    expect(deleted[0]!.deletedBy).toBe('owner@sd.test'); // resolved to the deleter's email
  });

  it('restore brings the project + a CLIENT member’s access back (memberships kept through the delete)', async () => {
    const owner = await user('owner2@sd.test', 'admin');
    const id = await makeProject(owner.t, 'beta');
    // A client member sees the project before deletion.
    await addClient(id, 'client2@sd.test');
    const clientT = token(
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client2@sd.test', password: 'Pw-secret-1' } }),
    );
    expect((await list(clientT)).map((p) => p.id)).toContain(id);

    await app.inject({ method: 'DELETE', url: `/projects/${id}`, cookies: { sw_session: owner.t } });
    expect(await list(owner.t)).toHaveLength(0);
    expect(await list(clientT)).toHaveLength(0); // hidden from the client too while deleted

    const restore = await app.inject({ method: 'POST', url: `/admin/deleted-projects/${id}/restore`, cookies: { sw_session: owner.t } });
    expect(restore.statusCode).toBe(204);
    expect((await list(owner.t)).map((p) => p.id)).toEqual([id]);
    // The client's membership survived the soft-delete, so restore re-grants their access with no re-invite.
    expect((await list(clientT)).map((p) => p.id)).toContain(id);
    expect(await deletedList(owner.t)).toHaveLength(0);
  });

  it('reap permanently removes the project rows + deletes an ORPHANED client, keeps staff + multi-project clients', async () => {
    const admin = await user('admin@sd.test', 'admin');
    const idA = await makeProject(admin.t, 'proj-a');
    const idB = await makeProject(admin.t, 'proj-b');
    // orphaned: a client only in proj-a (with an MFA + session row to prove the cascade)
    const orphan = await addClient(idA, 'orphan@client.test');
    await db.insert(sessions).values({ id: newId(), userId: orphan, createdAt: new Date(), expiresAt: new Date(Date.now() + 1e6) });
    await db.insert(userMfaTotp).values({ userId: orphan, secret: { iv: 'i', ct: 'c', tag: 't' }, confirmedAt: new Date(), createdAt: new Date() });
    // kept: a client in BOTH projects, and a staff developer in proj-a
    const shared = await addClient(idA, 'shared@client.test');
    await db.insert(projectMembers).values({ id: newId(), userId: shared, projectId: idB, role: 'member', createdAt: new Date() });
    const staff = await addClient(idA, 'ignore@x.test'); // overwritten below to staff
    await db.update(users).set({ platformRole: 'developer' }).where(eq(users.id, staff));

    await app.inject({ method: 'DELETE', url: `/projects/${idA}`, cookies: { sw_session: admin.t } });
    const reap = await app.inject({ method: 'DELETE', url: `/admin/deleted-projects/${idA}`, cookies: { sw_session: admin.t } });
    expect(reap.statusCode).toBe(204);

    // proj-a is gone from the deleted list; proj-b untouched.
    expect(await deletedList(admin.t)).toHaveLength(0);
    expect((await list(admin.t)).map((p) => p.id)).toContain(idB);
    // The orphaned client + ALL its rows are gone.
    expect(await db.select().from(users).where(eq(users.id, orphan))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, orphan))).toHaveLength(0);
    expect(await db.select().from(userMfaTotp).where(eq(userMfaTotp.userId, orphan))).toHaveLength(0);
    // The multi-project client + the staff account survive.
    expect(await db.select().from(users).where(eq(users.id, shared))).toHaveLength(1);
    expect(await db.select().from(users).where(eq(users.id, staff))).toHaveLength(1);
  });

  it('reap-all clears every soft-deleted project at once', async () => {
    const admin = await user('admin3@sd.test', 'admin');
    const id1 = await makeProject(admin.t, 'one');
    const id2 = await makeProject(admin.t, 'two');
    await app.inject({ method: 'DELETE', url: `/projects/${id1}`, cookies: { sw_session: admin.t } });
    await app.inject({ method: 'DELETE', url: `/projects/${id2}`, cookies: { sw_session: admin.t } });
    expect(await deletedList(admin.t)).toHaveLength(2);

    const reapAll = await app.inject({ method: 'DELETE', url: '/admin/deleted-projects', cookies: { sw_session: admin.t } });
    expect(reapAll.statusCode).toBe(200);
    expect((reapAll.json() as { reaped: number }).reaped).toBe(2);
    expect(await deletedList(admin.t)).toHaveLength(0);
  });

  it('guards: non-owner cannot soft-delete; non-admin cannot reach admin routes; a live project cannot be reaped', async () => {
    const admin = await user('admin4@sd.test', 'admin');
    const dev = await user('dev@sd.test', 'developer'); // staff but NOT a member of the project
    const id = await makeProject(admin.t, 'gamma');

    // A developer with no membership can't delete it.
    expect((await app.inject({ method: 'DELETE', url: `/projects/${id}`, cookies: { sw_session: dev.t } })).statusCode).toBe(403);
    // A non-admin can't list/restore/reap.
    expect((await app.inject({ method: 'GET', url: '/admin/deleted-projects', cookies: { sw_session: dev.t } })).statusCode).toBe(403);
    // A LIVE project can't be reaped (must be soft-deleted first).
    expect((await app.inject({ method: 'DELETE', url: `/admin/deleted-projects/${id}`, cookies: { sw_session: admin.t } })).statusCode).toBe(403);
  });
});
