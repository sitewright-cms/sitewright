import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { projectMembers } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

// Fresh page ids (NOT the seeded `home`) so revision counts are exact.
const aboutPage = (title: string) => ({ id: 'about', path: 'about', title });

let h: Harness;
let client: TestClient;
let pid: string;

beforeEach(async () => {
  h = await makeHarness({ revisionCoalesceMs: 0 }); // every save is a distinct revision
  client = await h.signup({ email: 'rev@e2e.test' });
  pid = await client.createProject('Site', 'site');
});
afterEach(() => h.close());

const revBase = (kind: string, id: string) => `/projects/${pid}/content/${kind}/${id}/revisions`;

describe('revision routes', () => {
  it('lists history newest-first and returns a snapshot by id', async () => {
    const proj = client.project(pid);
    await proj.putContent('page', 'about', aboutPage('A'));
    await proj.putContent('page', 'about', aboutPage('B'));

    const list = await client.get(revBase('page', 'about'));
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ id: string; op: string; author: { isYou: boolean; email: string | null } }>;
    expect(items.length).toBe(2);
    expect(items[0]!.op).toBe('put');
    expect(items[0]!.author.isYou).toBe(true);
    expect(items[0]!.author.email).toBe('rev@e2e.test');

    const oldest = items[items.length - 1]!; // title 'A'
    const got = await client.get(`${revBase('page', 'about')}/${oldest.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.json().revision.data.title).toBe('A');
  });

  it('restores a revision (content reverts) and records a restore revision', async () => {
    const proj = client.project(pid);
    await proj.putContent('page', 'about', aboutPage('A'));
    const vA = (await client.get(revBase('page', 'about'))).json().items[0].id;
    await proj.putContent('page', 'about', aboutPage('B'));

    const restore = await client.post(`${revBase('page', 'about')}/${vA}/restore`);
    expect(restore.statusCode).toBe(200);
    expect((await proj.getContent('page', 'about')).json().item.title).toBe('A');

    const after = (await client.get(revBase('page', 'about'))).json().items;
    expect(after[0].op).toBe('restore');
    expect(after[0].note).toMatch(/Restored from/);
    expect(after.length).toBe(3); // A, B, restore — B still recoverable
  });

  it('restores a DELETED entity from its tombstone', async () => {
    const proj = client.project(pid);
    await proj.putContent('page', 'gone', { id: 'gone', path: 'gone', title: 'Bye' });
    expect((await client.del(`/projects/${pid}/content/page/gone`)).statusCode).toBe(204);
    expect((await proj.getContent('page', 'gone')).statusCode).toBe(404);

    const items = (await client.get(revBase('page', 'gone'))).json().items;
    expect(items[0].op).toBe('delete');
    const restore = await client.post(`${revBase('page', 'gone')}/${items[0].id}/restore`);
    expect(restore.statusCode).toBe(200);
    expect((await proj.getContent('page', 'gone')).json().item.title).toBe('Bye');
  });

  it('404s for a kind without revision history (e.g. media)', async () => {
    expect((await client.get(revBase('media', 'x'))).statusCode).toBe(404);
  });

  it('isolates history across tenants (a non-member is forbidden)', async () => {
    await client.project(pid).putContent('page', 'about', aboutPage('A'));
    const other = await h.signup({ email: 'other@e2e.test' });
    expect((await other.get(revBase('page', 'about'))).statusCode).toBe(403);
  });

  it('a content:read token can list but NOT restore (restore needs content:write)', async () => {
    const proj = client.project(pid);
    await proj.putContent('page', 'about', aboutPage('A'));
    const token = (
      await client.post(`/projects/${pid}/api-keys`, {
        name: 'ro',
        role: 'member',
        expiresInDays: 1,
        capabilities: ['content:read'],
      })
    ).json().token as string;
    const auth = { authorization: `Bearer ${token}` };

    const list = await h.app.inject({ method: 'GET', url: revBase('page', 'about'), headers: auth });
    expect(list.statusCode).toBe(200);
    const revId = list.json().items[0].id as string;
    const restore = await h.app.inject({ method: 'POST', url: `${revBase('page', 'about')}/${revId}/restore`, headers: auth });
    expect(restore.statusCode).toBe(403);
  });
});

// Privacy: a former member's email must not be disclosed to a project's current readers, even though
// their userId lingers in history. Needs direct DB membership control, so it builds its own app.
describe('revision author email is scoped to CURRENT members', () => {
  let app: FastifyInstance;
  let db: Database;
  let ownerCookie: string;
  let memberCookie: string;
  let memberId: string;
  let projectId: string;

  const cookie = (res: { cookies: Array<{ name: string; value: string }> }) =>
    res.cookies.find((c) => c.name === 'sw_session')!.value;

  beforeEach(async () => {
    db = await makeTestDb();
    app = await createApp({ db, revisionCoalesceMs: 0, openRegistration: true });
    await app.ready();
    ownerCookie = cookie(await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'owner@e2e.test', password: 'Pw-secret-1' } }));
    projectId = (await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: ownerCookie }, payload: { name: 'S', slug: 'site' } })).json().project.id;
    // A second user, added as a member, who authors a revision.
    const member = await registerAccount(db, 'member@e2e.test', 'Pw-secret-1');
    memberId = member.userId;
    await addProjectMember(db, memberId, projectId, 'member');
    memberCookie = cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'member@e2e.test', password: 'Pw-secret-1' } }));
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/content/page/p`, cookies: { sw_session: memberCookie }, payload: { id: 'p', path: 'p', title: 'By member' } });
  });
  afterEach(() => app.close());

  it('shows the email while the author is a member, and null after they are removed', async () => {
    const url = `/projects/${projectId}/content/page/p/revisions`;
    const before = (await app.inject({ method: 'GET', url, cookies: { sw_session: ownerCookie } })).json().items[0];
    expect(before.author.userId).toBe(memberId);
    expect(before.author.email).toBe('member@e2e.test'); // current member → email shown

    await db.delete(projectMembers).where(and(eq(projectMembers.userId, memberId), eq(projectMembers.projectId, projectId)));

    const after = (await app.inject({ method: 'GET', url, cookies: { sw_session: ownerCookie } })).json().items[0];
    expect(after.author.userId).toBe(memberId); // attribution kept
    expect(after.author.email).toBeNull(); // ...but the ex-member's email is NOT disclosed
  });
});
