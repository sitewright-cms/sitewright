import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { makeHarness, type Harness } from './harness.js';

// One harness (and its temp DB) per test; closed in afterEach to release the file.
let h: Harness;
afterEach(async () => {
  await h?.close();
});

// Cross-tenant probes hit A's exact org/project path with B's session. They are
// rejected either at the org gate (tenantContext → ForbiddenError → 403, because
// B is not a member of A's org) or, when B uses its own org with A's projectId,
// at the project gate (projects.get → NotFoundError → 404). Either is acceptable
// isolation; we assert one of [403, 404]. (Mirrors tenant-isolation.test.ts.)
const ISOLATION_CODES = [403, 404];

// A minimal valid page payload (mirrors the existing content suites).
const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };

interface ProjectShape {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}
interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

describe('organization + project lifecycle (HTTP layer)', () => {
  // ---- 1. Create → echo → list → get-by-id ----
  it('creates a project that echoes name/slug, appears in the org list, and is fetchable by id', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });

    const create = await a.post(`/orgs/${a.orgId}/projects`, { name: 'My Site', slug: 'my-site' });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { project: ProjectShape }).project;
    expect(created.id).toBeTruthy();
    expect(created).toMatchObject({ orgId: a.orgId, name: 'My Site', slug: 'my-site' });

    // Appears in the org's project list.
    const list = await a.get(`/orgs/${a.orgId}/projects`);
    expect(list.statusCode).toBe(200);
    const projects = (list.json() as { projects: ProjectShape[] }).projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
    expect(projects[0]?.slug).toBe('my-site');

    // GET-by-id returns the same project.
    const byId = await a.get(`/orgs/${a.orgId}/projects/${created.id}`);
    expect(byId.statusCode).toBe(200);
    expect((byId.json() as { project: ProjectShape }).project).toMatchObject({
      id: created.id,
      name: 'My Site',
      slug: 'my-site',
    });

    // GET-by-id for an unknown project id → 404 (no leak).
    const missing = await a.get(`/orgs/${a.orgId}/projects/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
  });

  // ---- 2. Slug rules (org-scoped) ----
  it('rejects invalid slugs (uppercase / spaces / special chars) with 400', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });

    const invalidSlugs = ['UpperCase', 'has spaces', 'special_char', 'trailing-', '-leading', 'co..m', 'slug!'];
    for (const slug of invalidSlugs) {
      const res = await a.post(`/orgs/${a.orgId}/projects`, { name: 'Site', slug });
      expect(res.statusCode, `slug "${slug}"`).toBe(400);
    }
    // Nothing was created from the rejected attempts.
    const list = await a.get(`/orgs/${a.orgId}/projects`);
    expect((list.json() as { projects: unknown[] }).projects).toHaveLength(0);
  });

  it('accepts a valid slug but rejects a duplicate slug within the same org with 409', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });

    const first = await a.post(`/orgs/${a.orgId}/projects`, { name: 'Site One', slug: 'shared-slug' });
    expect(first.statusCode).toBe(201);

    // Duplicate slug in the SAME org → ConflictError → 409.
    const dup = await a.post(`/orgs/${a.orgId}/projects`, { name: 'Site Two', slug: 'shared-slug' });
    expect(dup.statusCode).toBe(409);

    // The org still has exactly the one original project (the dup was not created).
    const list = await a.get(`/orgs/${a.orgId}/projects`);
    expect((list.json() as { projects: unknown[] }).projects).toHaveLength(1);
  });

  it('allows the SAME slug in a DIFFERENT org (slugs are org-scoped)', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });
    const b = await h.signup({ orgName: 'Globex' });

    expect((await a.post(`/orgs/${a.orgId}/projects`, { name: 'A Site', slug: 'shared-slug' })).statusCode).toBe(201);
    // Same slug, different org → allowed (tenant isolation).
    const bCreate = await b.post(`/orgs/${b.orgId}/projects`, { name: 'B Site', slug: 'shared-slug' });
    expect(bCreate.statusCode).toBe(201);
    expect((bCreate.json() as { project: ProjectShape }).project.slug).toBe('shared-slug');
  });

  // ---- 3. Delete lifecycle ----
  it('deletes an (empty) project so it leaves the list and is no longer fetchable (404)', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });
    const projectId = await a.createProject('Site', 'site-a');
    const base = `/orgs/${a.orgId}/projects/${projectId}`;

    // The project resolves before deletion.
    expect((await a.get(`/orgs/${a.orgId}/projects/${projectId}`)).statusCode).toBe(200);

    // Delete the project → 204.
    const del = await a.del(`/orgs/${a.orgId}/projects/${projectId}`);
    expect(del.statusCode).toBe(204);

    // Gone from the list.
    const list = await a.get(`/orgs/${a.orgId}/projects`);
    expect((list.json() as { projects: ProjectShape[] }).projects).toHaveLength(0);

    // GET-by-id of the deleted project → 404.
    expect((await a.get(`/orgs/${a.orgId}/projects/${projectId}`)).statusCode).toBe(404);

    // Its (would-be) content is no longer accessible: resolveProject → projects.get → 404.
    expect((await a.get(`${base}/content/page/home`)).statusCode).toBe(404);
    expect((await a.get(`${base}/content/page`)).statusCode).toBe(404);
  });

  // Regression: a project with content must be deletable. `content.project_id`
  // has no DB-level ON DELETE CASCADE, so ProjectRepository.remove deletes the
  // content rows + the project row in one transaction. (Previously the bare
  // project delete violated the FK → 500, making projects with content
  // undeletable.)
  it('deletes a project that has content, cascading its content rows (204)', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });
    const projectId = await a.createProject('Site', 'site-b');
    const base = `/orgs/${a.orgId}/projects/${projectId}`;

    // Seed a content row so the project has a dependent FK reference.
    expect((await a.put(`${base}/content/page/home`, page)).statusCode).toBe(200);

    // Delete now cascades to content rows in one transaction (previously 500'd on the FK).
    const del = await a.del(`/orgs/${a.orgId}/projects/${projectId}`);
    expect(del.statusCode).toBe(204);

    // The project and its content are gone.
    expect((await a.get(`/orgs/${a.orgId}/projects/${projectId}`)).statusCode).toBe(404);
    expect((await a.get(`${base}/content/page/home`)).statusCode).toBe(404);
  });

  it('returns 404 when deleting a non-existent project', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });

    const del = await a.del(`/orgs/${a.orgId}/projects/${randomUUID()}`);
    expect(del.statusCode).toBe(404);
  });

  // ---- 4. Rename / update ----
  // No rename/update route exists for projects: app.ts only registers
  // POST/GET(list)/GET(by id)/DELETE on /orgs/:orgId/projects[/:id] and the
  // ProjectRepository exposes only list/get/create/remove (no update method).
  // Skipped because the product offers no such endpoint to test.
  it.skip('renames/updates a project (no PUT/PATCH route exists on /orgs/:orgId/projects/:id)', () => {
    // Intentionally empty: no update route to exercise.
  });

  // ---- 5. /me + /orgs reflect the user's orgs and owner role ----
  it('exposes the user’s org with owner role via /me and /orgs', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });

    const me = await a.get('/me');
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { userId: string; orgs: OrgSummary[] };
    expect(meBody.userId).toBe(a.userId);
    expect(meBody.orgs).toHaveLength(1);
    expect(meBody.orgs[0]).toMatchObject({ id: a.orgId, name: 'Acme', role: 'owner' });
    expect(meBody.orgs[0]?.slug).toBe('acme');

    const orgs = await a.get('/orgs');
    expect(orgs.statusCode).toBe(200);
    const orgsBody = orgs.json() as { orgs: OrgSummary[] };
    expect(orgsBody.orgs).toHaveLength(1);
    expect(orgsBody.orgs[0]).toMatchObject({ id: a.orgId, name: 'Acme', role: 'owner' });
  });

  it('does not reveal another tenant’s org via /me or /orgs', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });
    const b = await h.signup({ orgName: 'Globex' });

    // B's /me and /orgs list only B's org, never A's.
    const bMe = await b.get('/me');
    const bMeOrgs = (bMe.json() as { orgs: OrgSummary[] }).orgs;
    expect(bMeOrgs).toHaveLength(1);
    expect(bMeOrgs[0]?.id).toBe(b.orgId);
    expect(bMe.body).not.toContain(a.orgId);
    expect(bMe.body).not.toContain('Acme');

    const bOrgs = await b.get('/orgs');
    expect((bOrgs.json() as { orgs: OrgSummary[] }).orgs.map((o) => o.id)).toEqual([b.orgId]);
    expect(bOrgs.body).not.toContain(a.orgId);
  });

  // ---- 6. Cross-tenant project access + anonymous auth ----
  it('blocks tenant B from create/list/get/delete against tenant A’s org and project (403/404)', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });
    const b = await h.signup({ orgName: 'Globex' });
    const projectId = await a.createProject('Secret Site', 'secret-site');

    // B lists A's projects → blocked, no leak.
    const bList = await b.get(`/orgs/${a.orgId}/projects`);
    expect(ISOLATION_CODES).toContain(bList.statusCode);
    expect(bList.body).not.toContain(projectId);
    expect(bList.body).not.toContain('secret-site');

    // B gets A's project by id → blocked.
    const bGet = await b.get(`/orgs/${a.orgId}/projects/${projectId}`);
    expect(ISOLATION_CODES).toContain(bGet.statusCode);
    expect(bGet.body).not.toContain('secret-site');

    // B creates a project under A's org → blocked at the org gate.
    const bCreate = await b.post(`/orgs/${a.orgId}/projects`, { name: 'Intruder', slug: 'intruder' });
    expect(ISOLATION_CODES).toContain(bCreate.statusCode);

    // B deletes A's project → blocked.
    const bDel = await b.del(`/orgs/${a.orgId}/projects/${projectId}`);
    expect(ISOLATION_CODES).toContain(bDel.statusCode);

    // Sanity: nothing changed in A's org — the project is still there for A.
    const aList = await a.get(`/orgs/${a.orgId}/projects`);
    expect((aList.json() as { projects: ProjectShape[] }).projects).toHaveLength(1);
    expect((await a.get(`/orgs/${a.orgId}/projects/${projectId}`)).statusCode).toBe(200);
  });

  it('rejects anonymous (no-cookie) requests to the project lifecycle routes with 401', async () => {
    h = await makeHarness();
    const a = await h.signup({ orgName: 'Acme' });
    const projectId = await a.createProject('Site', 'site-a');

    const anonRoutes: InjectOptions[] = [
      { method: 'GET', url: '/me' },
      { method: 'GET', url: '/orgs' },
      { method: 'GET', url: `/orgs/${a.orgId}/projects` },
      { method: 'POST', url: `/orgs/${a.orgId}/projects`, payload: { name: 'X', slug: 'x' } },
      { method: 'GET', url: `/orgs/${a.orgId}/projects/${projectId}` },
      { method: 'DELETE', url: `/orgs/${a.orgId}/projects/${projectId}` },
    ];

    for (const opts of anonRoutes) {
      const res = await h.app.inject(opts);
      expect(res.statusCode, `${opts.method} ${opts.url} anon`).toBe(401);
    }

    // Control: the project still exists (no anonymous mutation took effect).
    expect((await a.get(`/orgs/${a.orgId}/projects/${projectId}`)).statusCode).toBe(200);
  });
});
