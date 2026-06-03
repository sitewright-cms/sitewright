import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, sessionToken, type Harness } from './harness.js';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };

describe('integration harness', () => {
  it('signs up distinct users with no project access until they create one (isolation is by project)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    // Flat tenancy: there is no org layer; users are distinct and isolation is
    // enforced per-project (see the cross-tenant tests).
    expect(a.userId).not.toBe(b.userId);

    // A fresh user holds no project memberships until they create or are invited to a project.
    const me = await a.get('/me');
    expect(me.statusCode).toBe(200);
    const body = me.json() as { userId: string; platformRole: string | null; isInstanceAdmin: boolean; projects: Array<{ id: string; role: string }> };
    expect(body.userId).toBe(a.userId);
    expect(body.projects).toHaveLength(0);

    // After creating a project, the caller surfaces as its owner.
    const projectId = await a.createProject('Site', 'site');
    const after = (await a.get('/me')).json() as { projects: Array<{ id: string; role: string }> };
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0]).toMatchObject({ id: projectId, role: 'owner' });
  });

  it('round-trips a page through the content API of a created project', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject('Site', 'site'));

    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    const got = await proj.getContent('page', 'home');
    expect(got.statusCode).toBe(200);
    expect((got.json() as { item: { title: string } }).item.title).toBe('Home');
    expect((await proj.exportBundle().then((r) => r.json() as { pages: unknown[] })).pages).toHaveLength(1);
  });

  it('blocks cross-tenant access while the owner can read their own content', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    const aProj = a.project(await a.createProject());
    expect((await aProj.putContent('page', 'home', page)).statusCode).toBe(200);

    // Positive proof first: A can read its own content.
    const owned = await aProj.getContent('page', 'home');
    expect(owned.statusCode).toBe(200);
    expect((owned.json() as { item: { title: string } }).item.title).toBe('Home');

    // Negative: B (different org) cannot read A's content — a clean denial, never a 5xx,
    // and A's data must not leak into the body.
    const crossPath = `/projects/${aProj.projectId}/content/page/home`;
    const denied = await b.get(crossPath);
    expect(denied.statusCode).toBeLessThan(500);
    expect([403, 404]).toContain(denied.statusCode);
    expect(denied.body).not.toContain('Home');
  });

  it('exposes the raw session token for lower-level assertions', async () => {
    h = await makeHarness();
    const a = await h.signup();
    expect(typeof a.token).toBe('string');
    expect(a.token.length).toBeGreaterThan(0);
    // sanity: a no-cookie request to a protected route is rejected
    const anon = await h.app.inject({ method: 'GET', url: '/me' });
    expect(anon.statusCode).toBe(401);
    void sessionToken;
  });
});
