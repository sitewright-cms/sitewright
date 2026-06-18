import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// One harness (and its temp DB) per test; closed in afterEach to release the file.
let h: Harness;
afterEach(async () => {
  await h?.close();
});

// ---- Valid per-kind payloads (mirroring the existing content/dataset suites) ----
const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };
const dataset = {
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  fields: [{ name: 'title', type: 'text', required: true }],
};
const entry = { id: 'post-1', dataset: 'posts', status: 'published', values: { title: 'Hello' } };
const settings = {
  brand: { name: 'Acme', colors: {} },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

// A saved deploy target body (host is allow-listed below so creation succeeds).
const ALLOWED_HOST = 'allowed.example.com';
const deployTarget = {
  name: 'Prod webspace',
  protocol: 'sftp',
  host: ALLOWED_HOST,
  user: 'deployer',
  password: 'super-secret-password',
  remoteDir: '/var/www',
};

/** Seeds one valid entity of every generic content kind into A's project. */
async function seedAllKinds(a: TestClient, projectId: string): Promise<void> {
  const proj = a.project(projectId);
  expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
  expect((await proj.putContent('dataset', 'posts', dataset)).statusCode).toBe(200);
  expect((await proj.putContent('entry', 'post-1', entry)).statusCode).toBe(200);
  expect((await proj.putContent('settings', 'settings', settings)).statusCode).toBe(200);
}

// Cross-tenant probes are sent to A's exact project path BUT with B's session. In the flat model B
// is not a member of A's project, so the single access gate (resolveProjectRole → null) rejects
// with 403. (A Bearer key bound to another project would 404 instead — that path is covered by the
// API-key suite; these probes are session-based.) We assert one of [403, 404] to stay robust to the
// per-route choice, but for a session probe the expected code is 403.
const ISOLATION_CODES = [403, 404];

describe('multi-tenant isolation + role enforcement (HTTP layer)', () => {
  it('blocks tenant B from GET/PUT/DELETE across every content kind (incl. settings) in A’s project, while A retains access', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    const projectId = await a.createProject('Site', 'site-a', { localHosting: false });
    await seedAllKinds(a, projectId);

    const aBase = `/projects/${projectId}`;

    // Each generic kind has a representative existing entityId; settings uses its singleton id.
    const probes: Array<{ kind: string; entityId: string; writeBody: unknown }> = [
      { kind: 'page', entityId: 'home', writeBody: page },
      { kind: 'dataset', entityId: 'posts', writeBody: dataset },
      { kind: 'entry', entityId: 'post-1', writeBody: entry },
      { kind: 'settings', entityId: 'settings', writeBody: settings },
    ];

    for (const { kind, entityId, writeBody } of probes) {
      // B reads A's list endpoint → blocked.
      const bList = await b.get(`${aBase}/content/${kind}`);
      expect(ISOLATION_CODES, `B list ${kind}`).toContain(bList.statusCode);

      // B reads A's single item → blocked.
      const bGet = await b.get(`${aBase}/content/${kind}/${entityId}`);
      expect(ISOLATION_CODES, `B get ${kind}`).toContain(bGet.statusCode);

      // B overwrites A's item → blocked.
      const bPut = await b.put(`${aBase}/content/${kind}/${entityId}`, writeBody);
      expect(ISOLATION_CODES, `B put ${kind}`).toContain(bPut.statusCode);

      // B deletes A's item → blocked.
      const bDel = await b.del(`${aBase}/content/${kind}/${entityId}`);
      expect(ISOLATION_CODES, `B delete ${kind}`).toContain(bDel.statusCode);

      // None of B's attempts may leak A's data.
      expect(bList.body, `B list ${kind} body`).not.toContain('Acme');
      expect(bGet.body, `B get ${kind} body`).not.toContain('Acme');
    }

    // A still has full access: list/get/put/delete-then-restore on a page, and settings read.
    const aProj = a.project(projectId);
    const aList = await aProj.listContent('page');
    expect(aList.statusCode).toBe(200);
    expect((aList.json() as { items: unknown[] }).items).toHaveLength(1);

    const aGet = await aProj.getContent('page', 'home');
    expect(aGet.statusCode).toBe(200);
    expect((aGet.json() as { item: { title: string } }).item.title).toBe('Home');

    expect((await a.get(`${aBase}/content/settings/settings`)).statusCode).toBe(200);

    const aDel = await a.del(`${aBase}/content/page/home`);
    expect(aDel.statusCode).toBe(204);
    expect((await a.put(`${aBase}/content/page/home`, page)).statusCode).toBe(200);
  });

  it('prevents B from listing A’s projects, creating under A’s org, or reading A’s export / writing A’s import', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    const projectId = await a.createProject('Site', 'site-a', { localHosting: false });
    await a.project(projectId).putContent('page', 'home', page);

    // Flat model: the list returns the CALLER's accessible projects, so B's
    // list is its own — 200, empty, and never leaks A's project.
    const bListProjects = await b.get(`/projects`);
    expect(bListProjects.statusCode).toBe(200);
    expect((bListProjects.json() as { projects: unknown[] }).projects).toHaveLength(0);
    expect(bListProjects.body).not.toContain(projectId);

    // B reads A's single project by id → blocked (non-member → 403).
    const bGetProject = await b.get(`/projects/${projectId}`);
    expect(ISOLATION_CODES).toContain(bGetProject.statusCode);

    // B creating a project only creates B's OWN project; it never touches A's data.
    // Confirm A's list is unchanged at exactly its one project.
    const bCreate = await b.post(`/projects`, { name: 'Intruder', slug: 'intruder' });
    expect(bCreate.statusCode).toBe(201);
    const aProjects = await a.get(`/projects`);
    const aProjectIds = (aProjects.json() as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(aProjectIds).toEqual([projectId]);

    // B deletes A's project → blocked.
    const bDeleteProject = await b.del(`/projects/${projectId}`);
    expect(ISOLATION_CODES).toContain(bDeleteProject.statusCode);

    // B reads A's export bundle → blocked, no leakage.
    const bExport = await b.get(`/projects/${projectId}/export`);
    expect(ISOLATION_CODES).toContain(bExport.statusCode);
    expect(bExport.body).not.toContain('Home');

    // B writes A's import → blocked.
    const bImport = await b.post(`/projects/${projectId}/import`, { pages: [page] });
    expect(ISOLATION_CODES).toContain(bImport.statusCode);

    // Sanity: A can still export its own project and see the seeded page.
    const aExport = await a.project(projectId).exportBundle();
    expect(aExport.statusCode).toBe(200);
    expect((aExport.json() as { pages: unknown[] }).pages).toHaveLength(1);
  });

  it('rejects generic content access to deploy_target (DEDICATED_KIND) and never leaks the encrypted secret via the dedicated routes', async () => {
    // A 32-byte key enables the saved-deploy-target routes (see app.ts opts.encryptionKey).
    const encryptionKey = randomBytes(32);
    h = await makeHarness({ encryptionKey, deployAllowedHosts: [ALLOWED_HOST] });
    const a = await h.signup();
    const projectId = await a.createProject('Site', 'site-a', { localHosting: false });
    const base = `/projects/${projectId}`;

    // Create a real saved target (encrypts the password) via its dedicated route.
    const create = await a.post(`${base}/deploy-targets`, deployTarget);
    expect(create.statusCode).toBe(201);
    const created = create.json() as { target: { id: string } };
    const targetId = created.target.id;
    // The dedicated create response strips the encrypted secret and the plaintext.
    expect(create.body).not.toContain('secret');
    expect(create.body).not.toContain('super-secret-password');

    // Generic LIST of deploy_target is rejected (would otherwise return the encrypted secret).
    const genericList = await a.get(`${base}/content/deploy_target`);
    expect(genericList.statusCode).toBe(403);
    expect(genericList.body).not.toContain('secret');

    // Generic GET-by-id of deploy_target is rejected too.
    const genericGet = await a.get(`${base}/content/deploy_target/${targetId}`);
    expect(genericGet.statusCode).toBe(403);
    expect(genericGet.body).not.toContain('secret');

    // Generic WRITE/DELETE of deploy_target is rejected (can't forge an attacker secret blob).
    const genericPut = await a.put(`${base}/content/deploy_target/${targetId}`, { id: targetId });
    expect(genericPut.statusCode).toBe(403);
    const genericDel = await a.del(`${base}/content/deploy_target/${targetId}`);
    expect(genericDel.statusCode).toBe(403);

    // The dedicated list route DOES return the target, but with the secret stripped.
    const dedicatedList = await a.get(`${base}/deploy-targets`);
    expect(dedicatedList.statusCode).toBe(200);
    const items = (dedicatedList.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: targetId, host: ALLOWED_HOST, user: 'deployer' });
    expect(items[0]).not.toHaveProperty('secret');
    expect(dedicatedList.body).not.toContain('super-secret-password');
    // Neither the encrypted-envelope keys nor the literal "secret" key leak.
    expect(dedicatedList.body).not.toContain('"secret"');
  });

  it('rejects anonymous (no-cookie) requests to protected routes with 401', async () => {
    const encryptionKey = randomBytes(32);
    h = await makeHarness({ encryptionKey, deployAllowedHosts: [ALLOWED_HOST] });
    // Seed a real project so the routes would otherwise resolve to data.
    const a = await h.signup();
    const projectId = await a.createProject('Site', 'site-a', { localHosting: false });
    const base = `/projects/${projectId}`;

    // Every probe uses the bare app (no session cookie attached).
    const protectedRoutes: InjectOptions[] = [
      { method: 'GET', url: '/me' },
      { method: 'GET', url: `/projects` },
      { method: 'POST', url: `/projects`, payload: { name: 'X', slug: 'x' } },
      { method: 'GET', url: `${base}/content/page` },
      { method: 'GET', url: `${base}/content/page/home` },
      { method: 'PUT', url: `${base}/content/page/home`, payload: page },
      { method: 'DELETE', url: `${base}/content/page/home` },
      { method: 'GET', url: `${base}/export` },
      { method: 'POST', url: `${base}/import`, payload: { pages: [page] } },
      { method: 'GET', url: `${base}/deploy-targets` },
      { method: 'POST', url: `${base}/deploy-targets`, payload: deployTarget },
    ];

    for (const opts of protectedRoutes) {
      const res = await h.app.inject(opts);
      expect(res.statusCode, `${opts.method} ${opts.url} anon`).toBe(401);
    }

    // Public/informational routes are reachable without a cookie (control assertions).
    expect((await h.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/version' })).statusCode).toBe(200);
  });
});
