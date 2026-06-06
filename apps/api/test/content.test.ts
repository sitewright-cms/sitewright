import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { ConflictError, NotFoundError, ForbiddenError, type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let content: ContentRepository;
let pctxA: ProjectContext;
let pctxB: ProjectContext;
let projA: { id: string; name: string; slug: string };

const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const projects = new ProjectRepository(db);

  const a = await registerAccount(db, 'a@acme.test', 'pw-secret-1');
  const b = await registerAccount(db, 'b@globex.test', 'pw-secret-1');
  projA = await projects.create({ name: 'Site A', slug: 'site-a' });
  const projB = await projects.create({ name: 'Site B', slug: 'site-b' });
  await addProjectMember(db, a.userId, projA.id, 'owner');
  await addProjectMember(db, b.userId, projB.id, 'owner');
  pctxA = { userId: a.userId, projectId: projA.id, role: 'owner' };
  pctxB = { userId: b.userId, projectId: projB.id, role: 'owner' };
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

  it('lets a member write content freely (the constrained client-write gate was removed)', async () => {
    // NOTE: in the old org model a 'member' was a read-only/editable-node-only client and the
    // assertions below threw ForbiddenError. The constrained client-write gate has been REMOVED:
    // any project role ('owner' or 'member') may now write any content kind. These assertions are
    // FLIPPED accordingly — what used to be forbidden is now allowed.
    const member: ProjectContext = { ...pctxA, role: 'member' };

    // A member can CREATE a page (no prior version required).
    await content.put(member, 'page', 'home', page);
    expect(await content.get(member, 'page', 'home')).toMatchObject({ title: 'Home' });

    // Author a page with two nodes; a member may freely edit either node...
    const richPage = {
      id: 'home',
      path: '',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'h', type: 'Heading', props: { text: 'Heading', level: 2 } },
          { id: 't', type: 'RichText', props: { text: 'Edit me' } },
        ],
      },
    };
    await content.put(member, 'page', 'home', richPage);

    // ...edit any node's content → allowed + persisted.
    const edited = JSON.parse(JSON.stringify(richPage));
    edited.root.children[0].props.text = 'Member edit';
    await content.put(member, 'page', 'home', edited);
    const stored = (await content.get(member, 'page', 'home')) as {
      root: { children: Array<{ props: { text: string } }> };
    };
    expect(stored.root.children[0]!.props.text).toBe('Member edit');

    // ...restructure the tree (remove a node) → allowed.
    const restructured = JSON.parse(JSON.stringify(richPage));
    restructured.root.children.pop();
    await content.put(member, 'page', 'home', restructured);
    const after = (await content.get(member, 'page', 'home')) as { root: { children: unknown[] } };
    expect(after.root.children).toHaveLength(1);

    // ...write a non-page content kind → allowed.
    await content.put(member, 'partial', 'p', { id: 'p', name: 'P', root: { id: 'pr', type: 'Section' } });
    expect(await content.get(member, 'partial', 'p')).toMatchObject({ name: 'P' });
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
      path: 'bad',
      title: 'Bad',
      root: { id: 'r', type: 'Grid', binding: { dataset: 'ghost', mode: 'list' } },
    };
    await expect(content.importBundle(pctxA, projA, { pages: [badPage] })).rejects.toThrow(
      ConflictError,
    );
  });

  it('isolates content across two projects owned by the same user', async () => {
    // Tenancy is now the project (no org layer). The same user owns a second project;
    // content must still not leak between their projects — isolation is strictly by projectId.
    const proj2 = await new ProjectRepository(db).create({ name: 'Site A2', slug: 'site-a2' });
    await addProjectMember(db, pctxA.userId, proj2.id, 'owner');
    const pctxA2: ProjectContext = { ...pctxA, projectId: proj2.id };
    await content.put(pctxA, 'page', 'home', page);
    await expect(content.get(pctxA2, 'page', 'home')).rejects.toThrow(NotFoundError);
    expect(await content.list(pctxA2, 'page')).toHaveLength(0);
  });

  it('rejects an over-deep page tree before parsing (DoS guard)', async () => {
    let node: Record<string, unknown> = { id: 'leaf', type: 'Leaf' };
    for (let i = 0; i < 250; i++) node = { id: `n${i}`, type: 'Box', children: [node] };
    const deep = { id: 'deep', path: 'deep', title: 'Deep', root: node };
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
