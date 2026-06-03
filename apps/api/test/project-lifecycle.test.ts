import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { makeHarness, type Harness } from './harness.js';

// One harness (and its temp DB) per test; closed in afterEach to release the file.
let h: Harness;
afterEach(async () => {
  await h?.close();
});

// Flat tenancy: there is no org layer. A signed-in non-member hitting a specific
// project they don't belong to is denied with 403 (they cannot probe other
// projects). (Mirrors tenant-isolation.test.ts.)

// A minimal valid page payload (mirrors the existing content suites).
const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };

interface ProjectShape {
  id: string;
  name: string;
  slug: string;
  createdAt?: string;
  role?: string;
}

describe('project lifecycle (HTTP layer)', () => {
  // ---- 1. Create → echo → list → get-by-id ----
  it('creates a project that echoes name/slug, appears in the accessible-project list, and is fetchable by id', async () => {
    h = await makeHarness();
    const a = await h.signup();

    const create = await a.post(`/projects`, { name: 'My Site', slug: 'my-site' });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { project: ProjectShape }).project;
    expect(created.id).toBeTruthy();
    // Flat model: the project record carries just name/slug.
    expect(created).toMatchObject({ name: 'My Site', slug: 'my-site' });

    // Appears in the caller's accessible-project list (creator is the owner).
    const list = await a.get(`/projects`);
    expect(list.statusCode).toBe(200);
    const projects = (list.json() as { projects: ProjectShape[] }).projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
    expect(projects[0]?.slug).toBe('my-site');

    // GET-by-id returns the same project.
    const byId = await a.get(`/projects/${created.id}`);
    expect(byId.statusCode).toBe(200);
    expect((byId.json() as { project: ProjectShape }).project).toMatchObject({
      id: created.id,
      name: 'My Site',
      slug: 'my-site',
    });

    // GET-by-id for an unknown project id → 403 (the caller holds no membership for it;
    // a clean deny that does not reveal whether the project exists).
    const missing = await a.get(`/projects/${randomUUID()}`);
    expect(missing.statusCode).toBe(403);
  });

  // ---- 2. Slug rules (instance-unique) ----
  it('rejects invalid slugs (uppercase / spaces / special chars) with 400', async () => {
    h = await makeHarness();
    const a = await h.signup();

    const invalidSlugs = ['UpperCase', 'has spaces', 'special_char', 'trailing-', '-leading', 'co..m', 'slug!'];
    for (const slug of invalidSlugs) {
      const res = await a.post(`/projects`, { name: 'Site', slug });
      expect(res.statusCode, `slug "${slug}"`).toBe(400);
    }
    // Nothing was created from the rejected attempts.
    const list = await a.get(`/projects`);
    expect((list.json() as { projects: unknown[] }).projects).toHaveLength(0);
  });

  it('accepts a valid slug but rejects a duplicate slug from the same caller with 409', async () => {
    h = await makeHarness();
    const a = await h.signup();

    const first = await a.post(`/projects`, { name: 'Site One', slug: 'shared-slug' });
    expect(first.statusCode).toBe(201);

    // Duplicate slug → ConflictError → 409 (slugs are instance-unique).
    const dup = await a.post(`/projects`, { name: 'Site Two', slug: 'shared-slug' });
    expect(dup.statusCode).toBe(409);

    // The caller still has exactly the one original project (the dup was not created).
    const list = await a.get(`/projects`);
    expect((list.json() as { projects: unknown[] }).projects).toHaveLength(1);
  });

  it('rejects a duplicate slug even from a DIFFERENT user (slugs are instance-unique)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();

    expect((await a.post(`/projects`, { name: 'A Site', slug: 'shared-slug' })).statusCode).toBe(201);
    // Flat model: slugs are instance-unique — a different user reusing the slug is REJECTED (409).
    const bCreate = await b.post(`/projects`, { name: 'B Site', slug: 'shared-slug' });
    expect(bCreate.statusCode).toBe(409);

    // B created nothing.
    const bList = await b.get(`/projects`);
    expect((bList.json() as { projects: unknown[] }).projects).toHaveLength(0);
  });

  // ---- 3. Delete lifecycle ----
  it('deletes an (empty) project so it leaves the list and is no longer reachable (403)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const projectId = await a.createProject('Site', 'site-a');
    const base = `/projects/${projectId}`;

    // The project resolves before deletion.
    expect((await a.get(`/projects/${projectId}`)).statusCode).toBe(200);

    // Delete the project → 204.
    const del = await a.del(`/projects/${projectId}`);
    expect(del.statusCode).toBe(204);

    // Gone from the list.
    const list = await a.get(`/projects`);
    expect((list.json() as { projects: ProjectShape[] }).projects).toHaveLength(0);

    // Delete also removed the owner's membership row, so the (former) owner now resolves
    // no role for the gone project → 403 (a clean deny that doesn't reveal existence).
    expect((await a.get(`/projects/${projectId}`)).statusCode).toBe(403);

    // Its (would-be) content is no longer accessible: resolveProject → no role → 403.
    expect((await a.get(`${base}/content/page/home`)).statusCode).toBe(403);
    expect((await a.get(`${base}/content/page`)).statusCode).toBe(403);
  });

  // Regression: a project with content must be deletable. `content.project_id`
  // has no DB-level ON DELETE CASCADE, so ProjectRepository.remove deletes the
  // content rows + the project row in one transaction. (Previously the bare
  // project delete violated the FK → 500, making projects with content
  // undeletable.)
  it('deletes a project that has content, cascading its content rows (204)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const projectId = await a.createProject('Site', 'site-b');
    const base = `/projects/${projectId}`;

    // Seed a content row so the project has a dependent FK reference.
    expect((await a.put(`${base}/content/page/home`, page)).statusCode).toBe(200);

    // Delete now cascades to content rows in one transaction (previously 500'd on the FK).
    const del = await a.del(`/projects/${projectId}`);
    expect(del.statusCode).toBe(204);

    // The project and its content are gone; the (former) owner's membership went with it,
    // so re-reading now resolves no role → 403.
    expect((await a.get(`/projects/${projectId}`)).statusCode).toBe(403);
    expect((await a.get(`${base}/content/page/home`)).statusCode).toBe(403);
  });

  it('returns 403 when deleting a project the caller has no membership for (incl. non-existent)', async () => {
    h = await makeHarness();
    const a = await h.signup();

    // No membership for a random/unknown project id → resolveProjectRole null → 403
    // (a clean deny that does not reveal whether the project exists).
    const del = await a.del(`/projects/${randomUUID()}`);
    expect(del.statusCode).toBe(403);
  });

  // ---- 4. Rename / update ----
  // No rename/update route exists for projects: app.ts only registers
  // POST/GET(list)/GET(by id)/DELETE on /projects[/:id] and the
  // ProjectRepository exposes only list/get/create/remove (no update method).
  // Skipped because the product offers no such endpoint to test.
  it.skip('renames/updates a project (no PUT/PATCH route exists on /projects/:id)', () => {
    // Intentionally empty: no update route to exercise.
  });

  // ---- 5. /me reflects the caller's project memberships + owner role ----
  it('exposes the caller’s owned project with owner role via /me', async () => {
    h = await makeHarness();
    const a = await h.signup();

    // A fresh user has no project access yet.
    const empty = await a.get('/me');
    expect(empty.statusCode).toBe(200);
    const emptyBody = empty.json() as { userId: string; projects: ProjectShape[] };
    expect(emptyBody.userId).toBe(a.userId);
    expect(emptyBody.projects).toHaveLength(0);

    // After creating a project, /me surfaces it with the owner role.
    const projectId = await a.createProject('My Site', 'my-site');
    const me = await a.get('/me');
    const meBody = me.json() as { userId: string; projects: ProjectShape[] };
    expect(meBody.projects).toHaveLength(1);
    expect(meBody.projects[0]).toMatchObject({ id: projectId, slug: 'my-site', role: 'owner' });
  });

  it('does not reveal another tenant’s projects via /me (project-scoped access is isolated)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    const aProjectId = await a.createProject('Secret Site', 'secret-site');

    // Flat model: isolation lives at the PROJECT layer. B's /me surfaces no project access at all
    // (B owns none) and never leaks A's.
    const bMe = await b.get('/me');
    const bBody = bMe.json() as { projects: Array<{ id: string }> };
    expect(bBody.projects).toHaveLength(0);
    expect(bMe.body).not.toContain(aProjectId);
    expect(bMe.body).not.toContain('secret-site');

    // A's own /me does surface A's project; B's does not.
    const aMe = await a.get('/me');
    const aAccess = (aMe.json() as { projects: Array<{ id: string }> }).projects;
    expect(aAccess.map((p) => p.id)).toEqual([aProjectId]);
  });

  // ---- 6. Cross-tenant project access + anonymous auth ----
  it('isolates tenant B from get/delete of tenant A’s project; B’s list never leaks A’s data', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    const projectId = await a.createProject('Secret Site', 'secret-site');

    // Flat model: the project list returns the CALLER's accessible projects, so B's list is its
    // own — 200, empty, and never leaks A's project.
    const bList = await b.get(`/projects`);
    expect(bList.statusCode).toBe(200);
    expect((bList.json() as { projects: ProjectShape[] }).projects).toHaveLength(0);
    expect(bList.body).not.toContain(projectId);
    expect(bList.body).not.toContain('secret-site');

    // B gets A's project by id → 403 (non-member; no leak).
    const bGet = await b.get(`/projects/${projectId}`);
    expect(bGet.statusCode).toBe(403);
    expect(bGet.body).not.toContain('secret-site');

    // B deletes A's project → 403 (non-member).
    const bDel = await b.del(`/projects/${projectId}`);
    expect(bDel.statusCode).toBe(403);

    // Sanity: A's project is untouched — still there for A, and B's own list is empty.
    const aList = await a.get(`/projects`);
    expect((aList.json() as { projects: ProjectShape[] }).projects).toHaveLength(1);
    expect((await a.get(`/projects/${projectId}`)).statusCode).toBe(200);
    expect((await b.get(`/projects`)).json()).toMatchObject({ projects: [] });
  });

  it('rejects anonymous (no-cookie) requests to the project lifecycle routes with 401', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const projectId = await a.createProject('Site', 'site-a');

    const anonRoutes: InjectOptions[] = [
      { method: 'GET', url: '/me' },
      { method: 'GET', url: `/projects` },
      { method: 'POST', url: `/projects`, payload: { name: 'X', slug: 'x' } },
      { method: 'GET', url: `/projects/${projectId}` },
      { method: 'DELETE', url: `/projects/${projectId}` },
    ];

    for (const opts of anonRoutes) {
      const res = await h.app.inject(opts);
      expect(res.statusCode, `${opts.method} ${opts.url} anon`).toBe(401);
    }

    // Control: the project still exists (no anonymous mutation took effect).
    expect((await a.get(`/projects/${projectId}`)).statusCode).toBe(200);
  });
});
