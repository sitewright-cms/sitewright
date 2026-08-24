import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let content: ContentRepository;
let ctx: ProjectContext;
let project: { id: string; name: string; slug: string };

const HOME = { id: 'home', path: '', title: 'Home' };

/** Read a page's stored `parent` (undefined when it has none). */
async function parentOf(id: string): Promise<string | undefined> {
  return ((await content.get(ctx, 'page', id)) as { parent?: string }).parent;
}

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const projects = new ProjectRepository(db);
  const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
  project = await projects.create({ name: 'Site A', slug: 'site-a' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
  await content.put(ctx, 'settings', 'settings', {
    identity: { name: 'Site A', colors: {} },
    settings: { defaultLocale: 'en', locales: ['en', 'de'] },
  });
  await content.put(ctx, 'page', 'home', HOME);
});

describe('page-tree invariant on write', () => {
  it('parents a new page to home when the writer omits it', async () => {
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'About' });
    expect(await parentOf('about')).toBe('home');
  });

  it('leaves the home page parentless', async () => {
    expect(await parentOf('home')).toBeUndefined();
  });

  it('parents a non-default-locale page to its own locale home', async () => {
    await content.put(ctx, 'page', 'home-de', {
      id: 'home-de', path: 'de', title: 'Startseite', locale: 'de', parent: 'home', translationGroup: 'home',
    });
    await content.put(ctx, 'page', 'leistungen', {
      id: 'leistungen', path: 'leistungen', title: 'Leistungen', locale: 'de',
    });
    expect(await parentOf('leistungen')).toBe('home-de');
  });

  it('falls back to the root home when that language has no home', async () => {
    await content.put(ctx, 'page', 'services', { id: 'services', path: 'services', title: 'S', locale: 'fr' });
    expect(await parentOf('services')).toBe('home');
  });

  it('never overrides a parent the writer set', async () => {
    await content.put(ctx, 'page', 'services', { id: 'services', path: 'services', title: 'S' });
    await content.put(ctx, 'page', 'web', { id: 'web', path: 'web-design', title: 'W', parent: 'services' });
    expect(await parentOf('web')).toBe('services');
  });

  it('CARRIES the stored parent through a full replace that omits it', async () => {
    // The MCP `put_page` hazard: a total replace used to clear `parent` and yank the page up to root,
    // silently moving /services/web-design to /web-design.
    await content.put(ctx, 'page', 'services', { id: 'services', path: 'services', title: 'S' });
    await content.put(ctx, 'page', 'web', { id: 'web', path: 'web-design', title: 'W', parent: 'services' });
    await content.put(ctx, 'page', 'web', { id: 'web', path: 'web-design', title: 'Renamed' });
    expect(await parentOf('web')).toBe('services');
  });

  it('leaves a parent naming a page that does not exist yet alone (child-first creation)', async () => {
    await content.put(ctx, 'page', 'child', { id: 'child', path: 'child', title: 'C', parent: 'later' });
    expect(await parentOf('child')).toBe('later');
  });

  it('parents the very first page of an empty project to nothing (no home yet)', async () => {
    const b = await registerAccount(db, 'b@globex.test', 'Pw-secret-1');
    const projects = new ProjectRepository(db);
    const p2 = await projects.create({ name: 'Site B', slug: 'site-b' });
    await addProjectMember(db, b.userId, p2.id, 'owner');
    const ctx2: ProjectContext = { userId: b.userId, projectId: p2.id, role: 'owner' };
    const saved = (await content.put(ctx2, 'page', 'solo', { id: 'solo', path: 'solo', title: 'Solo' })) as { parent?: string };
    expect(saved.parent).toBeUndefined();
  });
});

describe('page-tree invariant on bundle import', () => {
  it('parents every parentless page and repairs a dangling one', async () => {
    const b = await registerAccount(db, 'imp@acme.test', 'Pw-secret-1');
    const projects = new ProjectRepository(db);
    const p2 = await projects.create({ name: 'Imported', slug: 'imported' });
    await addProjectMember(db, b.userId, p2.id, 'owner');
    const ctx2: ProjectContext = { userId: b.userId, projectId: p2.id, role: 'owner' };

    await content.importBundle(ctx2, { id: p2.id, name: 'Imported', slug: 'imported' }, {
      project: {
        identity: { name: 'Imported', colors: {} },
        settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      },
      pages: [
        { id: 'home', path: '', title: 'Home' },
        { id: 'about', path: 'about', title: 'About' },
        { id: 'home-de', path: 'de', title: 'Start', locale: 'de', translationGroup: 'home' },
        { id: 'kontakt', path: 'kontakt', title: 'Kontakt', locale: 'de' },
        { id: 'ghosted', path: 'ghosted', title: 'G', parent: 'no-such-page' },
      ],
    });

    const pages = (await content.list(ctx2, 'page')) as Array<{ id: string; parent?: string }>;
    const by = Object.fromEntries(pages.map((p) => [p.id, p.parent]));
    expect(by.home).toBeUndefined();
    expect(by.about).toBe('home');
    expect(by['home-de']).toBe('home');
    expect(by.kontakt).toBe('home-de');
    expect(by.ghosted).toBe('home');
  });
});

describe('a content-only bundle re-imported into an existing project', () => {
  it('resolves the locale home from the PROJECT default, not a hardcoded "en"', async () => {
    // German-default project with an English subtree. A bundle carrying no `project` block must read
    // the project's own defaultLocale — assuming `en` would treat the English page as default-locale
    // and hang it off the ROOT home, moving it from /en/about to /about, onto the German slug.
    const b = await registerAccount(db, 'de@acme.test', 'Pw-secret-1');
    const projects = new ProjectRepository(db);
    const p2 = await projects.create({ name: 'DE Site', slug: 'de-site' });
    await addProjectMember(db, b.userId, p2.id, 'owner');
    const ctx2: ProjectContext = { userId: b.userId, projectId: p2.id, role: 'owner' };

    await content.put(ctx2, 'settings', 'settings', {
      identity: { name: 'DE Site', colors: {} },
      settings: { defaultLocale: 'de', locales: ['de', 'en'] },
    });
    await content.put(ctx2, 'page', 'home', { id: 'home', path: '', title: 'Startseite' });
    await content.put(ctx2, 'page', 'home-en', {
      id: 'home-en', path: 'en', title: 'Home', locale: 'en', parent: 'home', translationGroup: 'home',
    });

    await content.importBundle(ctx2, { id: p2.id, name: 'DE Site', slug: 'de-site' }, {
      pages: [{ id: 'about-en', path: 'about', title: 'About', locale: 'en' }],
    });

    expect(((await content.get(ctx2, 'page', 'about-en')) as { parent?: string }).parent).toBe('home-en');
  });

  it('does not strip a bundle page\'s parent that points at a page ALREADY in the project', () => {
    // `repairDangling` reads an unresolvable id as broken. Resolving against the bundle alone would call
    // a perfectly good reference to a stored page unresolvable and yank the page up to home.
    return (async () => {
      const c = await registerAccount(db, 'ref@acme.test', 'Pw-secret-1');
      const projects = new ProjectRepository(db);
      const p3 = await projects.create({ name: 'Ref Site', slug: 'ref-site' });
      await addProjectMember(db, c.userId, p3.id, 'owner');
      const ctx3: ProjectContext = { userId: c.userId, projectId: p3.id, role: 'owner' };

      await content.put(ctx3, 'page', 'home', { id: 'home', path: '', title: 'Home' });
      await content.put(ctx3, 'page', 'services', { id: 'services', path: 'services', title: 'Services' });

      await content.importBundle(ctx3, { id: p3.id, name: 'Ref Site', slug: 'ref-site' }, {
        pages: [{ id: 'web', path: 'web-design', title: 'Web Design', parent: 'services' }],
      });

      expect(((await content.get(ctx3, 'page', 'web')) as { parent?: string }).parent).toBe('services');
    })();
  });
});
