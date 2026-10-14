import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember, deleteUserAccount } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { RevisionsRepository } from '../src/repo/revisions.js';
import { AgentGrantsRepository } from '../src/repo/agent-grants.js';
import { checkDatabaseIntegrity, runIntegrityAction } from '../src/repo/integrity.js';
import { content as contentTable } from '../src/db/schema.js';
import { ensureGlobalProject, globalCtx } from '../src/repo/global-library.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

// The integrity check REPORTS rows that exist but cannot be reached. These tests close the ways such rows
// were CREATED, at the write that created them — so the check has nothing new to find.

let db: Database;
let content: ContentRepository;
let revisions: RevisionsRepository;
let ctx: ProjectContext;

const page = (id: string, over: Record<string, unknown> = {}) => ({ id, path: id, title: id, ...over });

beforeEach(async () => {
  db = await makeTestDb();
  revisions = new RevisionsRepository(db, { policy: () => Promise.resolve({}) });
  content = new ContentRepository(db, undefined, revisions);
  const a = await registerAccount(db, 'owner@root.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'P', slug: 'p' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
  await content.put(ctx, 'settings', 'settings', { identity: { name: 'P' }, settings: { defaultLocale: 'en', locales: ['en', 'de'] } });
  await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home' });
});

const issueCodes = async () => (await checkDatabaseIntegrity(db)).issues.map((i) => i.code);
const parentOf = async (id: string) => ((await content.get(ctx, 'page', id)) as { parent?: string }).parent;

describe('deleting a page takes what depends on it along', () => {
  it('★ its children move up a level and its translated titles go — nothing for the integrity check', async () => {
    await content.put(ctx, 'page', 'services', page('services', { parent: 'home' }));
    await content.put(ctx, 'page', 'web', page('web', { parent: 'services' }));
    await content.put(ctx, 'page', 'seo', page('seo', { parent: 'web' }));
    await content.put(ctx, 'translation', 'web__de', { id: 'web__de', pageId: 'web', locale: 'de', title: 'Web' });

    await content.remove(ctx, 'page', 'web');

    // `seo` lands where `web` was — under `services` — so /services/web/seo/ becomes /services/seo/.
    expect(await parentOf('seo')).toBe('services');
    expect((await content.list(ctx, 'translation')) as unknown[]).toHaveLength(0);
    // These two used to be `missing_page_parent` and `orphan_translation`.
    expect(await issueCodes()).toEqual([]);
    // Everything removed is restorable, and the History rail says why the child moved.
    expect((await revisions.list(ctx, 'page', 'web')).map((r) => r.op)).toContain('delete');
    expect((await revisions.list(ctx, 'translation', 'web__de')).map((r) => r.op)).toContain('delete');
    expect((await revisions.list(ctx, 'page', 'seo'))[0]).toMatchObject({ op: 'put', note: 'Moved up: its parent page was deleted' });
  });

  it('★ an API delete of a main-language page takes the language variants that follow it, and detaches the rest', async () => {
    await content.put(ctx, 'page', 'home-de', { id: 'home-de', path: 'de', title: 'Start', locale: 'de', parent: 'home', translationGroup: 'home' });
    await content.put(ctx, 'page', 'about', page('about', { parent: 'home', translationGroup: 'about', source: '<h1>About</h1>' }));
    // Follows the main page's code — empty without it.
    await content.put(ctx, 'page', 'about-de', page('about-de', { path: 'about', locale: 'de', parent: 'home-de', translationGroup: 'about' }));
    // Its own code — stands alone.
    await content.put(ctx, 'page', 'about-fr', page('about-fr', { path: 'a-propos', locale: 'fr', parent: 'home', translationGroup: 'about', source: '<h1>FR</h1>' }));

    await content.remove(ctx, 'page', 'about');

    const ids = ((await content.list(ctx, 'page')) as Array<{ id: string }>).map((p) => p.id).sort();
    expect(ids).toEqual(['about-fr', 'home', 'home-de']);
    expect(await content.get(ctx, 'page', 'about-fr')).not.toHaveProperty('translationGroup');
    expect((await revisions.list(ctx, 'page', 'about-de')).map((r) => r.op)).toContain('delete');
  });

  it('refuses — changing nothing — when moving the children up would put two pages on one address', async () => {
    await content.put(ctx, 'page', 'team', page('team', { parent: 'home' }));
    await content.put(ctx, 'page', 'about', page('about', { parent: 'home' }));
    await content.put(ctx, 'page', 'about-team', page('about-team', { path: 'team', parent: 'about' })); // /about/team/

    await expect(content.remove(ctx, 'page', 'about')).rejects.toThrow(/\/team\/ \((about-team, team|team, about-team)\)/);
    expect(await content.get(ctx, 'page', 'about')).toBeDefined();
    expect(await parentOf('about-team')).toBe('about');
  });

  it('refuses the home page while pages hang under it', async () => {
    await content.put(ctx, 'page', 'about', page('about', { parent: 'home' }));
    await expect(content.remove(ctx, 'page', 'home')).rejects.toThrow(/home page cannot be deleted while 1 page hangs under it/);
  });

  it('removing a language also removes its translated titles, which are keyed by the main page that stays', async () => {
    await content.put(ctx, 'page', 'home-de', { id: 'home-de', path: 'de', title: 'Start', locale: 'de', parent: 'home', translationGroup: 'home' });
    await content.put(ctx, 'page', 'about', page('about', { parent: 'home' }));
    await content.put(ctx, 'translation', 'about__de', { id: 'about__de', pageId: 'about', locale: 'de', title: 'Über' });
    await content.put(ctx, 'translation', 'about__fr', { id: 'about__fr', pageId: 'about', locale: 'fr', title: 'À propos' });

    await content.applyLocaleChange(ctx, {
      removePageIds: ['home-de'],
      settings: { identity: { name: 'P' }, settings: { defaultLocale: 'en', locales: ['en'] } },
      removedLocale: 'de',
    });

    expect(((await content.list(ctx, 'translation')) as Array<{ id: string }>).map((t) => t.id)).toEqual(['about__fr']);
    // …tombstoned like the pages, which are now restorable too.
    expect((await revisions.list(ctx, 'translation', 'about__de')).map((r) => r.op)).toContain('delete');
    expect((await revisions.list(ctx, 'page', 'home-de')).map((r) => r.op)).toContain('delete');
  });

  it('deleting across languages moves the main page’s children up too', async () => {
    await content.put(ctx, 'page', 'about', page('about', { parent: 'home' }));
    await content.put(ctx, 'page', 'team', page('team', { parent: 'about' }));
    await content.applyLocaleChange(ctx, { removePageIds: ['about'] });
    expect(await parentOf('team')).toBe('home');
    expect(await issueCodes()).toEqual([]);
  });
});

describe('many pages at once — the bulk route and the integrity repair', () => {
  it('deletes a parent and its child under ONE plan: the child goes, it is never moved up first', async () => {
    await content.put(ctx, 'page', 'a', page('a', { parent: 'home' }));
    await content.put(ctx, 'page', 'b', page('b', { parent: 'a' }));
    await content.put(ctx, 'page', 'c', page('c', { parent: 'b' }));
    const res = await content.removePages(ctx, ['b', 'a', 'nope']);
    expect(res).toEqual({ deleted: ['b', 'a'], failed: [{ id: 'nope', error: 'page not found' }] });
    expect(await parentOf('c')).toBe('home');
    // `b` was deleted, not first rewritten under `home` — its only History entries are its own.
    expect((await revisions.list(ctx, 'page', 'b')).map((r) => r.note)).not.toContain('Moved up: its parent page was deleted');
  });

  it('refuses a refused page on its own, and a clash for the whole batch — nothing deleted', async () => {
    await content.put(ctx, 'page', 'team', page('team', { parent: 'home' }));
    await content.put(ctx, 'page', 'about', page('about', { parent: 'home' }));
    await content.put(ctx, 'page', 'about-team', page('about-team', { path: 'team', parent: 'about' }));
    await content.put(ctx, 'page', 'leaf', page('leaf', { parent: 'home' }));
    const res = await content.removePages(ctx, ['home', 'about', 'leaf']);
    expect(res.deleted).toEqual([]);
    expect(res.failed.map((f) => f.id)).toEqual(['home', 'about', 'leaf']);
    expect(res.failed[1]!.error).toMatch(/another page already has/);
    expect(await content.get(ctx, 'page', 'leaf')).toBeDefined();
  });

  it('refuses rather than overwrite a page edited after the delete read it', async () => {
    await content.put(ctx, 'page', 'a', page('a', { parent: 'home' }));
    await content.put(ctx, 'page', 'b', page('b', { parent: 'a', title: 'Before' }));
    // The delete plans from a read that is STALE for `b`: an edit landed after it.
    const realList = content.list.bind(content);
    const spy = vi.spyOn(content, 'list').mockImplementationOnce(async (c, kind) => {
      const pages = (await realList(c, kind)) as Array<Record<string, unknown>>;
      await content.put(ctx, 'page', 'b', page('b', { parent: 'a', title: 'Edited meanwhile' }));
      return pages;
    });
    await expect(content.remove(ctx, 'page', 'a')).rejects.toThrow(/page "b" changed while it was being moved/);
    spy.mockRestore();
    expect(await content.get(ctx, 'page', 'b')).toMatchObject({ title: 'Edited meanwhile', parent: 'a' });
    expect(await content.get(ctx, 'page', 'a')).toBeDefined();
  });
});

describe('writes that would point at nothing are refused', () => {
  it('…but a legacy row that already does stays editable — and movable by the integrity repair', async () => {
    const now = new Date();
    const legacy = { id: 'old', path: 'old', title: 'Old', parent: 'ghost', template: 'ghost_tpl' };
    await db.insert(contentTable).values({ id: 'legacy-old', projectId: ctx.projectId, kind: 'page', entityId: 'old', scope: '', data: legacy, createdAt: now, updatedAt: now });
    // An ordinary edit keeps the (broken) template it already had…
    await content.put(ctx, 'page', 'old', { ...legacy, title: 'Renamed' });
    // …and the parent repair, which rewrites the whole page, is not refused for the OTHER defect.
    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'reparent_pages', projectId: ctx.projectId, subject: 'ghost' });
    expect(res.changed).toBe(1);
    expect(await content.get(ctx, 'page', 'old')).toMatchObject({ parent: 'home', template: 'ghost_tpl', title: 'Renamed' });
    // Pointing it at a DIFFERENT missing template is still refused.
    await expect(content.put(ctx, 'page', 'old', { ...legacy, template: 'other_ghost' })).rejects.toThrow(/unknown template "other_ghost"/);
  });


  it('a translated title for a page that does not exist', async () => {
    await expect(
      content.put(ctx, 'translation', 'ghost__de', { id: 'ghost__de', pageId: 'ghost', locale: 'de', title: 'X' }),
    ).rejects.toThrow(/targets unknown page "ghost" — create the page first/);
  });

  it('a page using a project template that does not exist (a `global:` one is the library’s business)', async () => {
    await expect(content.put(ctx, 'page', 'p', page('p', { parent: 'home', template: 'card' }))).rejects.toThrow(
      /references unknown template "card" — create the template first/,
    );
    await content.put(ctx, 'template', 'card', { id: 'card', name: 'Card', source: '<article></article>' });
    await content.put(ctx, 'page', 'p', page('p', { parent: 'home', template: 'card' }));
    await content.put(ctx, 'page', 'g', page('g', { parent: 'home', template: 'global:blog' }));
  });
});

describe('a template in use cannot be deleted', () => {
  it('names the pages using it, and goes once nothing does', async () => {
    await content.put(ctx, 'template', 'card', { id: 'card', name: 'Card', source: '<article></article>' });
    await content.put(ctx, 'page', 'a', page('a', { parent: 'home', template: 'card' }));
    await expect(content.remove(ctx, 'template', 'card')).rejects.toThrow(/template "card" is used by 1 page \(a\)/);

    await content.put(ctx, 'page', 'a', page('a', { parent: 'home' }));
    await content.remove(ctx, 'template', 'card');
    expect(await issueCodes()).toEqual([]);
  });

  it('a GLOBAL library template is refused while any project uses it', async () => {
    await ensureGlobalProject(db);
    const gctx = globalCtx(ctx.userId);
    await content.put(gctx, 'template', 'promo', { id: 'promo', name: 'Promo', source: '<section></section>' });
    await content.put(ctx, 'page', 'landing', page('landing', { parent: 'home', template: 'global:promo' }));
    await expect(content.remove(gctx, 'template', 'promo')).rejects.toThrow(/used by 1 page \(p\/landing\)/);
  });
});

describe('deleting a user', () => {
  it('★ also removes their agent grants — the missed table made the account impossible to delete', async () => {
    const client = await registerAccount(db, 'client@root.test', 'Pw-secret-1');
    await addProjectMember(db, client.userId, ctx.projectId, 'member');
    await new AgentGrantsRepository(db).upsert(client.userId, ctx.projectId, { capabilities: ['content:read'], autonomy: 'full' });
    await deleteUserAccount(db, client.userId);
    const left = (await db.all(sql`select count(*) as n from agent_grants where user_id = ${client.userId}`)) as Array<{ n: number }>;
    expect(left[0]!.n).toBe(0);
  });

  // The drift guard, as `project-reap.test.ts` has for projects: every table with an FK to `users` must
  // be cleared by deleteUserAccount, or deleting such a user fails on the constraint. Adding a table that
  // references `users` fails this by name.
  it('deleteUserAccount clears EVERY table that carries an FK to users', async () => {
    const tables = (await db.all(sql`select name from sqlite_master where type='table' and name not like 'sqlite_%'`)) as Array<{ name: string }>;
    const referencing: string[] = [];
    for (const { name } of tables) {
      const fks = (await db.all(sql`select "table" as target from pragma_foreign_key_list(${name})`)) as Array<{ target: string }>;
      if (fks.some((f) => f.target === 'users')) referencing.push(name);
    }
    // `users` itself references users (invites.accepted_by lives on invites; users.accepted_by on users is
    // a self-reference cleared with the row). If this fails, add a `tx.delete(...)` for the new table in
    // deleteUserAccount and list it here — do not just update the list.
    expect(referencing.sort()).toEqual(
      [
        'agent_grants',
        'ai_usage',
        'api_keys',
        'invites',
        'member_tokens',
        'mfa_login_tickets',
        'oauth_auth_codes',
        'oauth_refresh_tokens',
        'oidc_identities',
        'project_members',
        'sessions',
        'user_mfa_recovery_codes',
        'user_mfa_totp',
        'user_passkeys',
      ].sort(),
    );
  });
});
