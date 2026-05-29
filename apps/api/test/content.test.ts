import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, tenantContext } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { ConflictError, ForbiddenError, NotFoundError, type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let content: ContentRepository;
let pctxA: ProjectContext;
let pctxB: ProjectContext;
let projA: { id: string; name: string; slug: string };

const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const projects = new ProjectRepository(db);

  const a = await registerAccount(db, 'a@acme.test', 'pw-secret-1', 'Acme');
  const b = await registerAccount(db, 'b@globex.test', 'pw-secret-1', 'Globex');
  const ctxA = await tenantContext(db, a.userId, a.orgId);
  const ctxB = await tenantContext(db, b.userId, b.orgId);
  projA = await projects.create(ctxA, { name: 'Site A', slug: 'site-a' });
  const projB = await projects.create(ctxB, { name: 'Site B', slug: 'site-b' });
  pctxA = { ...ctxA, projectId: projA.id };
  pctxB = { ...ctxB, projectId: projB.id };
});

describe('ContentRepository', () => {
  it('puts and gets a page (roundtrip), and lists it', async () => {
    await content.put(pctxA, 'page', 'home', page);
    expect(await content.get(pctxA, 'page', 'home')).toMatchObject({ title: 'Home' });
    expect(await content.list(pctxA, 'page')).toHaveLength(1);
  });

  it('validates the payload against the kind schema', async () => {
    await expect(content.put(pctxA, 'page', 'home', { id: 'home', title: 'X' })).rejects.toThrow();
  });

  it('rejects an id that does not match the path', async () => {
    await expect(content.put(pctxA, 'page', 'other', page)).rejects.toThrow(ConflictError);
  });

  it('isolates content per project (project B cannot read A’s page)', async () => {
    await content.put(pctxA, 'page', 'home', page);
    await expect(content.get(pctxB, 'page', 'home')).rejects.toThrow(NotFoundError);
    expect(await content.list(pctxB, 'page')).toHaveLength(0);
  });

  it('forbids a member role from writing', async () => {
    const member: ProjectContext = { ...pctxA, role: 'member' };
    await expect(member && content.put(member, 'page', 'home', page)).rejects.toThrow(ForbiddenError);
  });

  it('exports a bundle containing the project’s content', async () => {
    await content.put(pctxA, 'page', 'home', page);
    const bundle = await content.exportBundle(pctxA, projA);
    expect(bundle.pages.map((p) => p.id)).toEqual(['home']);
    expect(bundle.project.slug).toBe('site-a');
  });

  it('imports a valid bundle and rejects one that fails integrity checks', async () => {
    const result = await content.importBundle(pctxA, projA, { pages: [page] });
    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(await content.get(pctxA, 'page', 'home')).toMatchObject({ title: 'Home' });

    // page binds a dataset that doesn't exist → validateProject rejects
    const badPage = {
      id: 'bad',
      path: '/bad',
      title: 'Bad',
      root: { id: 'r', type: 'Grid', binding: { dataset: 'ghost', mode: 'list' } },
    };
    await expect(content.importBundle(pctxA, projA, { pages: [badPage] })).rejects.toThrow(
      ConflictError,
    );
  });

  it('imports a full bundle and exports it back', async () => {
    const bundle = {
      project: {
        brand: { name: 'Acme', colors: { primary: '#0a7' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
      },
      pages: [page],
      partials: [{ id: 'hdr', name: 'Header', root: { id: 'h', type: 'Header' } }],
      datasets: [
        { id: 'd1', name: 'Posts', slug: 'posts', fields: [{ name: 'title', type: 'text' }] },
      ],
      entries: [{ id: 'e1', dataset: 'posts', status: 'published', values: { title: 'Hi' } }],
    };
    const res = await content.importBundle(pctxA, projA, bundle);
    expect(res.imported).toBe(5); // settings + page + partial + dataset + entry

    const out = await content.exportBundle(pctxA, projA);
    expect(out.project.brand).toMatchObject({ name: 'Acme' });
    expect(out.partials).toHaveLength(1);
    expect(out.datasets).toHaveLength(1);
    expect(out.entries).toHaveLength(1);
  });
});
