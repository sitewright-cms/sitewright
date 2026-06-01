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

  it('lets a member (client role) edit ONLY editable-node content of an existing page', async () => {
    const member: ProjectContext = { ...pctxA, role: 'member' };
    // A member cannot CREATE a page (no prior version to constrain the edit against).
    await expect(content.put(member, 'page', 'home', page)).rejects.toThrow(ForbiddenError);

    // Owner authors a page with one editable node (RichText) and one locked (Heading).
    const editablePage = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'h', type: 'Heading', props: { text: 'Locked', level: 2 } },
          { id: 't', type: 'RichText', editable: true, props: { text: 'Edit me' } },
        ],
      },
    };
    await content.put(pctxA, 'page', 'home', editablePage);

    // Member edits the editable node's content → allowed + persisted.
    const edited = JSON.parse(JSON.stringify(editablePage));
    edited.root.children[1].props.text = 'Client edit';
    await content.put(member, 'page', 'home', edited);
    const stored = (await content.get(member, 'page', 'home')) as { root: { children: Array<{ props: { text: string } }> } };
    expect(stored.root.children[1]!.props.text).toBe('Client edit');

    // Member edits the LOCKED node → rejected.
    const hacked = JSON.parse(JSON.stringify(editablePage));
    hacked.root.children[0].props.text = 'Hacked';
    await expect(content.put(member, 'page', 'home', hacked)).rejects.toThrow(ForbiddenError);

    // Member changes structure (removes a node) → rejected.
    const restructured = JSON.parse(JSON.stringify(editablePage));
    restructured.root.children.pop();
    await expect(content.put(member, 'page', 'home', restructured)).rejects.toThrow(ForbiddenError);

    // Member writes a non-page content kind → rejected.
    await expect(
      content.put(member, 'partial', 'p', { id: 'p', name: 'P', root: { id: 'pr', type: 'Section' } }),
    ).rejects.toThrow(ForbiddenError);
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

  it('isolates content across two projects in the SAME org', async () => {
    // pctxA's org owns projA; create a second project in the same org.
    const projects = new (await import('../src/repo/projects.js')).ProjectRepository(db);
    const proj2 = await projects.create(
      { userId: pctxA.userId, orgId: pctxA.orgId, role: pctxA.role },
      { name: 'Site A2', slug: 'site-a2' },
    );
    const pctxA2: ProjectContext = { ...pctxA, projectId: proj2.id };
    await content.put(pctxA, 'page', 'home', page);
    await expect(content.get(pctxA2, 'page', 'home')).rejects.toThrow(NotFoundError);
    expect(await content.list(pctxA2, 'page')).toHaveLength(0);
  });

  it('rejects an over-deep page tree before parsing (DoS guard)', async () => {
    let node: Record<string, unknown> = { id: 'leaf', type: 'Leaf' };
    for (let i = 0; i < 250; i++) node = { id: `n${i}`, type: 'Box', children: [node] };
    const deep = { id: 'deep', path: '/deep', title: 'Deep', root: node };
    await expect(content.put(pctxA, 'page', 'deep', deep)).rejects.toThrow(RangeError);
  });

  it('cannot delete the settings singleton', async () => {
    await expect(content.remove(pctxA, 'settings', 'settings')).rejects.toThrow(ForbiddenError);
  });

  it('imports a full bundle and exports it back', async () => {
    const bundle = {
      project: {
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
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
    expect(out.project.identity).toMatchObject({ name: 'Acme' });
    expect(out.partials).toHaveLength(1);
    expect(out.datasets).toHaveLength(1);
    expect(out.entries).toHaveLength(1);
  });
});
