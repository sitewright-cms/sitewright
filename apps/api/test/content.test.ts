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

const page = { id: 'home', path: '', title: 'Home' };

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const projects = new ProjectRepository(db);

  const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
  const b = await registerAccount(db, 'b@globex.test', 'Pw-secret-1');
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

  it("isolates content per project (project B cannot read A's page)", async () => {
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

    // Author a page with editable data; a member may freely edit it.
    const richPage = {
      id: 'home',
      path: '',
      title: 'Home',
      source: '<h1 data-sw-text="headline">Hi</h1>',
      data: { headline: 'Heading', body: 'Content' },
    };
    await content.put(member, 'page', 'home', richPage);

    // ...edit any data field → allowed + persisted.
    const edited = JSON.parse(JSON.stringify(richPage));
    edited.data.headline = 'Member edit';
    await content.put(member, 'page', 'home', edited);
    const stored = (await content.get(member, 'page', 'home')) as {
      data: { headline: string; body: string };
    };
    expect(stored.data.headline).toBe('Member edit');

    // ...remove a data field → allowed.
    const restructured = JSON.parse(JSON.stringify(richPage));
    delete restructured.data.body;
    await content.put(member, 'page', 'home', restructured);
    const after = (await content.get(member, 'page', 'home')) as { data: Record<string, unknown> };
    expect(Object.keys(after.data)).toHaveLength(1);
  });

  it("exports a bundle containing the project's content", async () => {
    await content.put(pctxA, 'page', 'home', page);
    const bundle = await content.exportBundle(pctxA, projA);
    expect(bundle.pages.map((p) => p.id)).toEqual(['home']);
    expect(bundle.project.slug).toBe('site-a');
  });

  it('assembles a COMPLETE export bundle (snippets, translations, forms, media, folders)', async () => {
    await content.put(pctxA, 'page', 'home', page);
    await content.put(pctxA, 'snippet', 'hero', { id: 'hero', name: 'hero', source: '<div>hi</div>' });
    await content.put(pctxA, 'translation', 'home__de', {
      id: 'home__de',
      pageId: 'home',
      locale: 'de',
      title: 'Startseite',
    });
    await content.put(pctxA, 'form', 'contact', {
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email' }],
      recipient: 'owner@acme.test',
    });
    await content.put(pctxA, 'media', 'doc1', {
      kind: 'file',
      id: 'doc1',
      filename: 'doc.pdf',
      folder: '',
      bytes: 1234,
      contentType: 'application/pdf',
      storedName: 'doc.pdf',
      url: '/media/site-a/doc1/file/doc.pdf',
    });
    await content.put(pctxA, 'mediafolder', 'f1', { id: 'f1', path: 'docs' });

    const bundle = await content.assembleExportBundle(pctxA, projA);
    // The legacy sections are still present…
    expect(bundle.formatVersion).toBe(2);
    expect(bundle.pages.map((p) => p.id)).toEqual(['home']);
    // …and the five sections a whole-project archive adds are populated.
    expect(bundle.snippets.map((s) => s.name)).toEqual(['hero']);
    expect(bundle.translations.map((t) => t.id)).toEqual(['home__de']);
    expect(bundle.forms.map((f) => f.id)).toEqual(['contact']);
    expect(bundle.media.map((m) => m.id)).toEqual(['doc1']);
    expect(bundle.mediaFolders.map((f) => f.path)).toEqual(['docs']);
  });

  it('imports a valid bundle and rejects one that fails integrity checks', async () => {
    const result = await content.importBundle(pctxA, projA, { pages: [page] });
    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(await content.get(pctxA, 'page', 'home')).toMatchObject({ title: 'Home' });

    // page references a collection dataset that doesn't exist → validateProject rejects
    const badPage = {
      id: 'bad',
      path: '[slug]',
      title: 'Bad',
      collection: { dataset: 'ghost', param: 'slug' },
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
      datasets: [
        { id: 'd1', name: 'Posts', slug: 'posts', fields: [{ name: 'title', type: 'text' }] },
      ],
      entries: [{ id: 'e1', dataset: 'posts', status: 'published', values: { title: 'Hi' } }],
    };
    const res = await content.importBundle(pctxA, projA, bundle);
    expect(res.imported).toBe(4); // settings + page + dataset + entry

    const out = await content.exportBundle(pctxA, projA);
    expect(out.project.identity).toMatchObject({ name: 'Acme' });
    expect(out.datasets).toHaveLength(1);
    expect(out.entries).toHaveLength(1);
  });
});
