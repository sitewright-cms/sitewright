import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DatasetSchema } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository, contentVersion } from '../src/repo/content.js';
import { ensureGlobalProject, globalCtx } from '../src/repo/global-library.js';
import { ProjectEventBus, type ContentChange } from '../src/events/bus.js';
import { content as contentTable, type ContentKind } from '../src/db/schema.js';
import { ConflictError, type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let events: ProjectEventBus;
let content: ContentRepository;
let ctx: ProjectContext;

beforeEach(async () => {
  db = await makeTestDb();
  events = new ProjectEventBus();
  content = new ContentRepository(db, events);
  const a = await registerAccount(db, 'owner@acme.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'P', slug: 'p' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

const dataset = (id: string, slug: string, fields: unknown[] = []) => content.put(ctx, 'dataset', id, { id, name: id, slug, fields });
const languages = (website: object = {}) => content.put(ctx, 'settings', 'settings', { identity: { name: 'P' }, website, settings: { locales: ['en', 'de'], defaultLocale: 'en' } });
const rename = (id: string, slug: string, cascade = true) => content.renameDataset(ctx, id, slug, { cascade });

/** Plant a row exactly as given — the shapes `put` would normalise (defaults filled in, unknown keys dropped). */
async function plant(kind: 'dataset', entityId: string, data: Record<string, unknown>) {
  const now = new Date();
  await db.insert(contentTable).values({ id: `planted-${entityId}`, projectId: ctx.projectId, kind, entityId, scope: '', data, createdAt: now, updatedAt: now });
}

async function rawData(kind: ContentKind, entityId: string, scope = ''): Promise<unknown> {
  const [row] = await db
    .select()
    .from(contentTable)
    .where(and(eq(contentTable.projectId, ctx.projectId), eq(contentTable.kind, kind), eq(contentTable.entityId, entityId), eq(contentTable.scope, scope)));
  return row?.data;
}

describe('the shared library a page reaches', () => {
  beforeEach(async () => {
    await ensureGlobalProject(db);
  });

  it('refuses to rename a widget dataset composed by a LIBRARY template, naming the template and the page', async () => {
    await content.put(globalCtx(), 'template', 'landing', { id: 'landing', name: 'Landing', source: '<div>{{> hero-slider}}</div>' });
    await dataset('hero', 'hero');
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home', template: 'global:landing' });

    await expect(rename('hero', 'hero_main')).rejects.toThrow(/hero-slider.*library template "landing" \(used by page "home"\)/);
    expect(((await content.get(ctx, 'dataset', 'hero')) as { slug: string }).slug).toBe('hero');
  });

  it('refuses (nothing changed) when a library template the site uses reads the dataset by name', async () => {
    await content.put(globalCtx(), 'template', 'team-grid', { id: 'team-grid', name: 'Team grid', source: '<div>{{#each dataset.team}}{{name}}{{/each}}</div>' });
    await dataset('team', 'team');
    await content.put(ctx, 'entry', 'anna', { id: 'anna', dataset: 'team', values: {} });
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'About', template: 'global:team-grid' });

    await expect(rename('team', 'staff')).rejects.toThrow(/library template "team-grid" \(used by page "about"\) reads "team"/);
    // …and says the way out that does not touch the library.
    await expect(rename('team', 'staff')).rejects.toThrow(/Rename slug only/);
    await expect(rename('team', 'staff', false)).resolves.toMatchObject({ newSlug: 'staff', cascaded: false });
    await rename('team', 'team', false); // back, for the checks below
    expect(((await content.get(ctx, 'dataset', 'team')) as { slug: string }).slug).toBe('team');
    expect(await content.get(ctx, 'entry', 'anna', 'team')).toBeTruthy();
    // The library row itself is never touched.
    expect(((await content.get(globalCtx(), 'template', 'team-grid')) as { source: string }).source).toContain('dataset.team}}');
  });

  it('refuses the same for a LIBRARY snippet a page includes — but not for one nothing includes', async () => {
    await content.put(globalCtx(), 'snippet', 'team-list', { id: 'team-list', name: 'team-list', source: '<ul>{{#each dataset.team}}<li>x</li>{{/each}}</ul>' });
    await dataset('team', 'team');
    await expect(rename('team', 'staff')).resolves.toMatchObject({ newSlug: 'staff' }); // nothing includes it
    await rename('team', 'team');

    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{> team-list}}</div>' });
    await expect(rename('team', 'staff')).rejects.toThrow(/library snippet "team-list".*reads "team"/);
  });

  it('a project snippet of the same name wins over the library one, exactly as at render', async () => {
    await content.put(globalCtx(), 'snippet', 'team-list', { id: 'team-list', name: 'team-list', source: '<ul>{{#each dataset.team}}<li>x</li>{{/each}}</ul>' });
    await content.put(ctx, 'snippet', 'team-list', { id: 'team-list', name: 'team-list', source: '<ul>{{#each dataset.team}}<li>own</li>{{/each}}</ul>' });
    await dataset('team', 'team');
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{> team-list}}</div>' });

    await expect(rename('team', 'staff')).resolves.toMatchObject({ snippetsUpdated: 1 });
    expect(((await content.get(ctx, 'snippet', 'team-list')) as { source: string }).source).toContain('dataset.staff}}');
  });

  it('repoints a value picked through a {{sw-control as="dataset"}} that lives in a library snippet', async () => {
    await content.put(globalCtx(), 'snippet', 'picker', { id: 'picker', name: 'picker', source: '{{sw-control target="list_dataset" as="dataset"}}' });
    await dataset('ds1', 'items');
    await content.put(ctx, 'page', 'a', { id: 'a', path: 'a', title: 'A', source: '<div>{{> picker}}</div>', data: { list_dataset: 'items' } });

    await rename('ds1', 'features');
    expect(((await content.get(ctx, 'page', 'a')) as { data: unknown }).data).toEqual({ list_dataset: 'features' });
  });
});

describe('values picked with {{sw-control as="dataset"}} are repointed only where that control renders', () => {
  const control = '{{sw-control target="list_dataset" as="dataset"}}';

  it('a page without the control keeps its value; a page whose TEMPLATE has it, and the template defaults, follow', async () => {
    await dataset('ds1', 'items');
    await content.put(ctx, 'template', 'listing', { id: 'listing', name: 'Listing', source: `<div>${control}</div>`, data: { list_dataset: 'items' } });
    await content.put(ctx, 'page', 'uses-template', { id: 'uses-template', path: 'a', title: 'A', template: 'listing', data: { list_dataset: 'items' } });
    await content.put(ctx, 'page', 'own-control', { id: 'own-control', path: 'b', title: 'B', source: `<div>${control}</div>`, data: { list_dataset: 'items' } });
    await content.put(ctx, 'page', 'no-control', { id: 'no-control', path: 'c', title: 'C', source: '<div>plain</div>', data: { list_dataset: 'items' } });

    await rename('ds1', 'features');

    const data = async (id: string) => ((await content.get(ctx, 'page', id)) as { data: unknown }).data;
    expect(await data('uses-template')).toEqual({ list_dataset: 'features' });
    expect(await data('own-control')).toEqual({ list_dataset: 'features' });
    expect(await data('no-control')).toEqual({ list_dataset: 'items' }); // the same key means something else here
    expect(((await content.get(ctx, 'template', 'listing')) as { data: unknown }).data).toEqual({ list_dataset: 'features' });
  });

  it('a website.data value is repointed when any rendered source carries its control', async () => {
    await dataset('ds1', 'items');
    await content.put(ctx, 'settings', 'settings', {
      identity: { name: 'P' },
      website: { footer: '<div>{{sw-control target="website.data.footer_list" as="dataset"}}</div>', data: { footer_list: 'items', other: 'items' } },
      settings: {},
    });
    await rename('ds1', 'features');
    expect(((await content.get(ctx, 'settings', 'settings')) as { website: { data: unknown } }).website.data).toEqual({ footer_list: 'features', other: 'items' });
  });
});

describe('language copies', () => {
  it('refuses when a copy under the NEW name already exists for a language — that language would silently switch to it', async () => {
    await languages();
    await dataset('team', 'team');
    await dataset('staff_de', 'staff_de');
    for (const cascade of [true, false]) {
      await expect(rename('team', 'staff', cascade)).rejects.toThrow(/"staff_de" already exists.*"de"/);
    }
    expect(((await content.get(ctx, 'dataset', 'team')) as { slug: string }).slug).toBe('team');
  });

  it('reports copies left on the old name (a language the site no longer has, or cascade off)', async () => {
    await languages();
    await dataset('team', 'team');
    await dataset('team_de', 'team_de');
    await dataset('team_fr', 'team_fr');
    await dataset('team_archive', 'team_archive');
    const res = await rename('team', 'staff');
    expect(res.localeCopiesRenamed).toEqual([{ oldSlug: 'team_de', newSlug: 'staff_de' }]);
    // `team_archive` is not named like a language, so it is not a copy of anything.
    expect(res.localeCopiesNotRenamed).toEqual(['team_fr']);
  });

  it('with cascade off, every language copy is reported as left behind', async () => {
    await languages();
    await dataset('team', 'team');
    await dataset('team_de', 'team_de');
    const res = await rename('team', 'staff', false);
    expect(res.localeCopiesNotRenamed).toEqual(['team_de']);
    expect(((await content.get(ctx, 'dataset', 'team_de')) as { slug: string }).slug).toBe('team_de');
  });

  it('keeps a copy row exactly as stored apart from its slug (no re-normalising)', async () => {
    await languages();
    await dataset('team', 'team');
    const stored = { id: 'team_de', name: 'Team (DE)', slug: 'team_de', fields: [{ name: 'name', type: 'text' }], note: 'kept as it is' };
    await plant('dataset', 'team_de', stored);
    await rename('team', 'staff');
    expect(await rawData('dataset', 'team_de')).toEqual({ ...stored, slug: 'staff_de' });
  });

  it('refuses, naming the copy, when its new name would not be a valid slug', async () => {
    await languages();
    await dataset('team', 'team');
    await dataset('team_de', 'team_de');
    const long = `s${'a'.repeat(62)}`; // 63 chars: valid itself, 66 with "_de"
    await expect(rename('team', long)).rejects.toThrow(/"de" copy "team_de" would become ".*_de", which is not a valid dataset slug/);
    expect(((await content.get(ctx, 'dataset', 'team')) as { slug: string }).slug).toBe('team');
  });
});

describe('widgets', () => {
  it("refuses to rename a widget dataset's LANGUAGE COPY while the widget is used, and names where", async () => {
    await languages();
    await dataset('hero', 'hero');
    await dataset('hero_de', 'hero_de');
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{> hero-slider}}</div>' });
    await expect(rename('hero_de', 'hero_german')).rejects.toThrow(/\{\{> hero-slider\}\}.*page "home"/);
    await expect(rename('hero', 'hero_main')).rejects.toThrow(/\{\{> hero-slider\}\}.*page "home"/);
    expect(((await content.get(ctx, 'dataset', 'hero_de')) as { slug: string }).slug).toBe('hero_de');
  });

  it('names a project template and the chrome slot that compose it', async () => {
    await dataset('hero', 'hero');
    await content.put(ctx, 'template', 'landing', { id: 'landing', name: 'Landing', source: '<div>{{> hero-slider}}</div>' });
    await content.put(ctx, 'settings', 'settings', { identity: { name: 'P' }, website: { bottom: '<div>{{> hero-slider}}</div>' }, settings: {} });
    await expect(rename('hero', 'hero_main')).rejects.toThrow(/template "landing".*website bottom/);
  });
});

describe('what a rename announces', () => {
  it('each event carries the scope and the version of what was stored, as a save does', async () => {
    await dataset('ds1', 'items');
    await content.put(ctx, 'entry', 'e1', { id: 'e1', dataset: 'items', values: {} });
    await content.put(ctx, 'settings', 'settings', { identity: { name: 'P' }, website: { footer: '<div>{{#each dataset.items}}x{{/each}}</div>' }, settings: {} });
    const seen: ContentChange[] = [];
    events.subscribe(ctx.projectId, (c) => seen.push(c));

    await rename('ds1', 'features');

    const byKind = (kind: string) => seen.find((c) => c.kind === kind)!;
    expect(byKind('settings')).toMatchObject({ entityId: 'settings', scope: '', version: contentVersion(await rawData('settings', 'settings')) });
    expect(byKind('entry')).toMatchObject({ entityId: 'e1', scope: 'features', version: contentVersion(await rawData('entry', 'e1', 'features')) });
    expect(byKind('dataset')).toMatchObject({ entityId: 'ds1', scope: '', version: contentVersion(await rawData('dataset', 'ds1')) });
  });
});

describe('which entries a rename moves', () => {
  /** Plant an entry row whose SCOPE (where every list finds it) and declared `dataset` disagree — legacy data. */
  async function plantEntry(entityId: string, scope: string, declared: string) {
    const now = new Date();
    await db.insert(contentTable).values({ id: `planted-e-${entityId}-${scope}`, projectId: ctx.projectId, kind: 'entry', entityId, scope, data: { id: entityId, dataset: declared, values: {} }, createdAt: now, updatedAt: now });
  }
  const scopesOf = async (entityId: string) =>
    (await db.select().from(contentTable).where(and(eq(contentTable.projectId, ctx.projectId), eq(contentTable.kind, 'entry'), eq(contentTable.entityId, entityId)))).map((r) => r.scope).sort();

  it("reads only the renamed dataset's rows (by scope) — a row filed under another dataset is not copied over", async () => {
    await dataset('ds1', 'items');
    await dataset('ds2', 'other');
    await plantEntry('stray', 'other', 'items'); // listed under `other`, though it claims `items`
    await plantEntry('mine', 'items', 'mislabelled'); // listed under `items` — it moves with it
    const res = await rename('ds1', 'features');
    expect(res.entriesUpdated).toBe(1);
    expect(await scopesOf('stray')).toEqual(['other']); // not duplicated into `features`
    expect(await scopesOf('mine')).toEqual(['features']);
    expect(await rawData('entry', 'mine', 'features')).toEqual({ id: 'mine', dataset: 'features', values: {} });
  });

  it('refuses with a clear 409, naming the entry, when a leftover row already sits under the new slug', async () => {
    await dataset('ds1', 'items');
    await content.put(ctx, 'entry', 'e1', { id: 'e1', dataset: 'items', values: {} });
    await plantEntry('e1', 'features', 'features'); // stranded by some earlier mishap; no `features` dataset exists
    const err = await rename('ds1', 'features').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toMatch(/entry "e1".*"features"/);
    expect(((await content.get(ctx, 'dataset', 'ds1')) as { slug: string }).slug).toBe('items');
    expect(await scopesOf('e1')).toEqual(['features', 'items']);
  });
});

describe('a plain rename of a dataset nothing refers to', () => {
  it('writes exactly what it always did: the dataset with its new slug, and its entries moved', async () => {
    await dataset('ds1', 'items', [{ name: 'title', type: 'text' }]);
    await content.put(ctx, 'entry', 'e1', { id: 'e1', dataset: 'items', values: { title: 'A' } });
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>no data</div>' });
    await content.put(ctx, 'settings', 'settings', { identity: { name: 'P' }, website: { footer: '<div>x</div>' }, settings: {} });
    const snapshot = async () =>
      (await db.select().from(contentTable).where(eq(contentTable.projectId, ctx.projectId)))
        .map((r) => ({ kind: r.kind, entityId: r.entityId, scope: r.scope, data: r.data, updatedAt: r.updatedAt.getTime() }))
        .sort((a, b) => `${a.kind}:${a.entityId}`.localeCompare(`${b.kind}:${b.entityId}`));
    const before = await snapshot();
    const ds = (await content.get(ctx, 'dataset', 'ds1')) as Record<string, unknown>;

    await rename('ds1', 'features');

    const after = await snapshot();
    const untouched = (s: typeof before) => s.filter((r) => r.kind !== 'dataset' && r.kind !== 'entry');
    expect(untouched(after)).toEqual(untouched(before));
    expect(after.find((r) => r.kind === 'dataset')!.data).toEqual(DatasetSchema.parse({ ...ds, slug: 'features' }));
    expect(after.find((r) => r.kind === 'entry')).toMatchObject({ scope: 'features', data: { id: 'e1', dataset: 'features', values: { title: 'A' } } });
  });
});
