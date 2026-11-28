import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

let db: Awaited<ReturnType<typeof makeTestDb>>;
let app: FastifyInstance;
beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup() {
  await registerAccount(db, 'dev@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'dev@acme.test', password: 'Pw-secret-1' } }));
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'P', slug: 'p' } })).json() as { project: { id: string } }).project.id;
  const put = (kind: string, id: string, body: object) => app.inject({ method: 'PUT', url: `/projects/${pid}/content/${kind}/${id}`, cookies: { sw_session: t }, payload: body });
  const get = (kind: string, id: string, dataset?: string) =>
    app.inject({ method: 'GET', url: `/projects/${pid}/content/${kind}/${id}${dataset ? `?dataset=${dataset}` : ''}`, cookies: { sw_session: t } });
  return { t, pid, put, get };
}

describe('POST /projects/:id/datasets/:id/rename', () => {
  it('cascades a slug rename to entries + page/template sources + reference targets', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [{ name: 'title', type: 'text' }] });
    // `config.target` is NOT the key anything reads (that is `config.dataset`, below) — a row that holds it
    // anyway keeps being repointed, so data written against the old cascade is not left behind.
    await put('dataset', 'ds2', { id: 'ds2', name: 'Other', slug: 'other', fields: [{ name: 'rel', type: 'reference', config: { target: 'items' } }] });
    await put('entry', 'e1', { id: 'e1', dataset: 'items', values: { title: 'A' } });
    await put('entry', 'e2', { id: 'e2', dataset: 'items', values: { title: 'B' } });
    await put('entry', 'e3', { id: 'e3', dataset: 'other', values: {} });
    await put('page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{#each dataset.items}}<p>{{title}}</p>{{/each}} {{sw-control dataset="items" as="dataset-item" target="page.data.x"}}</div>' });

    const res = await app.inject({ method: 'POST', url: `/projects/${pid}/datasets/ds1/rename`, cookies: { sw_session: t }, payload: { slug: 'features' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ oldSlug: 'items', newSlug: 'features', cascaded: true, entriesUpdated: 2, pagesUpdated: 1, referencesUpdated: 1 });

    expect((await get('dataset', 'ds1')).json().item.slug).toBe('features');
    // The cascade re-scoped e1/e2 to the NEW dataset slug (they move with the rename); e3 stays in 'other'.
    expect((await get('entry', 'e1', 'features')).json().item.dataset).toBe('features');
    expect((await get('entry', 'e2', 'features')).json().item.dataset).toBe('features');
    expect((await get('entry', 'e3', 'other')).json().item.dataset).toBe('other'); // untouched
    const homeSrc = (await get('page', 'home')).json().item.source as string;
    expect(homeSrc).toContain('dataset.features');
    expect(homeSrc).toContain('dataset="features"');
    expect(homeSrc).not.toContain('dataset.items');
    expect((await get('dataset', 'ds2')).json().item.fields[0].config.target).toBe('features'); // reference retargeted
  });

  it('cascade:false leaves PAGE references alone but still moves the entries it OWNS', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [] });
    await put('entry', 'e1', { id: 'e1', dataset: 'items', values: {} });
    await put('page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{#each dataset.items}}<p>x</p>{{/each}}</div>' });

    const res = await app.inject({ method: 'POST', url: `/projects/${pid}/datasets/ds1/rename`, cookies: { sw_session: t }, payload: { slug: 'features', cascade: false } });
    expect(res.statusCode).toBe(200);
    // Entries are OWNED, so they move regardless of `cascade` — they are still counted as updated.
    expect(res.json()).toMatchObject({ newSlug: 'features', cascaded: false, entriesUpdated: 1, pagesUpdated: 0 });
    expect((await get('dataset', 'ds1')).json().item.slug).toBe('features');

    // The entry followed its dataset…
    expect((await get('entry', 'e1', 'features')).json().item.dataset).toBe('features');
    // …and is NOT still sitting under the old scope, invisible to every list and to publish. Leaving it
    // there is what silently stranded 336 rows in a real project; no flag may produce that state.
    expect((await get('entry', 'e1', 'items')).statusCode).toBe(404);

    // What cascade:false actually opts out of: the author's own markup is left for them to fix.
    expect((await get('page', 'home')).json().item.source).toContain('dataset.items');
  });

  it('rejects renaming to a slug another dataset already uses (409)', async () => {
    const { t, pid, put } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Posts', slug: 'posts', fields: [] });
    const res = await app.inject({ method: 'POST', url: `/projects/${pid}/datasets/ds1/rename`, cookies: { sw_session: t }, payload: { slug: 'posts' } });
    expect(res.statusCode).toBe(409);
  });
});

// Everything else in a project that names a dataset BY SLUG. Each of these used to keep the old slug after
// a rename, so the thing broke without an error: an empty loop, an entry picker with nothing to pick, a
// data file of `[]`, a German page in English.
describe('rename reaches every place that names the dataset', () => {
  async function rename(t: string, pid: string, id: string, payload: object) {
    return app.inject({ method: 'POST', url: `/projects/${pid}/datasets/${id}/rename`, cookies: { sw_session: t }, payload });
  }
  const settingsBody = (website: object, settings: object = {}) => ({ identity: { name: 'P' }, website, settings });

  it('repoints a reference field at its config.dataset — the key the editor and agents write', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'team', {
      id: 'team',
      name: 'Team',
      slug: 'team',
      // a dataset may reference ITSELF (a manager is a team member) — that field must follow too
      fields: [{ name: 'name', type: 'text' }, { name: 'manager', type: 'reference', config: { dataset: 'team' } }],
    });
    await put('dataset', 'roles', {
      id: 'roles',
      name: 'Roles',
      slug: 'roles',
      fields: [
        { name: 'lead', type: 'reference', config: { dataset: 'team' } },
        { name: 'crew', type: 'list', fields: [{ name: 'member', type: 'reference', config: { dataset: 'team' } }] },
        { name: 'elsewhere', type: 'reference', config: { dataset: 'team_archive' } },
      ],
    });

    const res = await rename(t, pid, 'team', { slug: 'staff' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ referencesUpdated: 1 });

    const roles = (await get('dataset', 'roles')).json().item;
    expect(roles.fields[0].config.dataset).toBe('staff');
    expect(roles.fields[1].fields[0].config.dataset).toBe('staff');
    expect(roles.fields[2].config.dataset).toBe('team_archive'); // a different dataset that merely shares the prefix
    const team = (await get('dataset', 'team')).json().item;
    expect(team.slug).toBe('staff');
    expect(team.fields[1].config.dataset).toBe('staff');
  });

  it('rewrites snippets, keyed item.<slug> lookups, chrome slots and data files', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [{ name: 'title', type: 'text' }] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Items2', slug: 'items2', fields: [{ name: 'title', type: 'text' }] });
    await put('entry', 'e1', { id: 'e1', dataset: 'items', values: { title: 'A' } });
    expect((await put('snippet', 'card-list', { id: 'card-list', name: 'card-list', source: '<ul>{{#each dataset.items}}<li>{{title}}</li>{{/each}}</ul>' })).statusCode).toBe(200);
    await put('page', 'home', {
      id: 'home',
      path: '',
      title: 'Home',
      source: '<div><h2>{{item.items.e1.title}}</h2>{{#each dataset.items2}}<p>{{lookup @root.item.items title}}</p>{{/each}}<p>{{item.items2.x.title}}</p></div>',
    });
    const settingsRes = await put('settings', 'settings', settingsBody({
      footer: '<div>{{#each dataset.items}}<span>{{title}}</span>{{/each}}</div>',
      dataFiles: [{ path: 'items.json', dataset: 'items' }, { path: 'other.json', dataset: 'items2' }],
    }));
    expect(settingsRes.statusCode).toBe(200);

    const res = await rename(t, pid, 'ds1', { slug: 'features' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pagesUpdated: 1, snippetsUpdated: 1, settingsUpdated: true });

    expect((await get('snippet', 'card-list')).json().item.source).toBe('<ul>{{#each dataset.features}}<li>{{title}}</li>{{/each}}</ul>');
    expect((await get('page', 'home')).json().item.source).toBe(
      '<div><h2>{{item.features.e1.title}}</h2>{{#each dataset.items2}}<p>{{lookup @root.item.features title}}</p>{{/each}}<p>{{item.items2.x.title}}</p></div>',
    );
    const website = (await get('settings', 'settings')).json().item.website;
    expect(website.footer).toBe('<div>{{#each dataset.features}}<span>{{title}}</span>{{/each}}</div>');
    expect(website.dataFiles).toEqual([{ path: 'items.json', dataset: 'features' }, { path: 'other.json', dataset: 'items2' }]);
  });

  it('repoints a page value a client picked with {{sw-control as="dataset"}}', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Posts', slug: 'posts', fields: [] });
    const source = '<div>{{sw-control target="list_dataset" as="dataset" label="List"}}{{#each (lookup dataset page.data.list_dataset)}}<p>x</p>{{/each}}</div>';
    await put('page', 'a', { id: 'a', path: 'a', title: 'A', source, data: { list_dataset: 'items', note: 'items' } });
    await put('page', 'b', { id: 'b', path: 'b', title: 'B', source, data: { list_dataset: 'posts' } });

    expect((await rename(t, pid, 'ds1', { slug: 'features' })).statusCode).toBe(200);

    // The control's value names the dataset; an unrelated field that happens to hold the same word does not.
    expect((await get('page', 'a')).json().item.data).toEqual({ list_dataset: 'features', note: 'items' });
    expect((await get('page', 'b')).json().item.data).toEqual({ list_dataset: 'posts' });
  });

  it('renames the per-language copies (<slug>_<locale>) with it, entries and references included', async () => {
    const { t, pid, put, get } = await setup();
    expect((await put('settings', 'settings', settingsBody({}, { locales: ['en', 'de'], defaultLocale: 'en' }))).statusCode).toBe(200);
    await put('dataset', 'team', { id: 'team', name: 'Team', slug: 'team', fields: [{ name: 'name', type: 'text' }] });
    await put('dataset', 'team_de', { id: 'team_de', name: 'Team (DE)', slug: 'team_de', fields: [{ name: 'name', type: 'text' }] });
    await put('dataset', 'roles_de', { id: 'roles_de', name: 'Roles (DE)', slug: 'roles_de', fields: [{ name: 'lead', type: 'reference', config: { dataset: 'team_de' } }] });
    await put('entry', 'anna', { id: 'anna', dataset: 'team', values: { name: 'Anna' } });
    await put('entry', 'anna', { id: 'anna', dataset: 'team_de', values: { name: 'Anna (DE)' } });
    await put('page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{#each dataset.team}}{{name}}{{/each}}{{#each dataset.team_de}}{{name}}{{/each}}</div>' });

    const res = await rename(t, pid, 'team', { slug: 'staff' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ entriesUpdated: 2, localeCopiesRenamed: [{ oldSlug: 'team_de', newSlug: 'staff_de' }] });

    // A German page reads `dataset.staff` as `staff_de` — so the copy has to be called that, or every German
    // page silently falls back to the main language.
    expect((await get('dataset', 'team_de')).json().item.slug).toBe('staff_de');
    expect((await get('entry', 'anna', 'staff_de')).json().item.values).toEqual({ name: 'Anna (DE)' });
    expect((await get('entry', 'anna', 'team_de')).statusCode).toBe(404);
    expect((await get('dataset', 'roles_de')).json().item.fields[0].config.dataset).toBe('staff_de');
    expect((await get('page', 'home')).json().item.source).toBe('<div>{{#each dataset.staff}}{{name}}{{/each}}{{#each dataset.staff_de}}{{name}}{{/each}}</div>');
  });

  it('refuses (409) and changes NOTHING when a language copy would collide', async () => {
    const { t, pid, put, get } = await setup();
    await put('settings', 'settings', settingsBody({}, { locales: ['en', 'de'], defaultLocale: 'en' }));
    await put('dataset', 'team', { id: 'team', name: 'Team', slug: 'team', fields: [] });
    await put('dataset', 'team_de', { id: 'team_de', name: 'Team (DE)', slug: 'team_de', fields: [] });
    await put('dataset', 'staff_de', { id: 'staff_de', name: 'Staff (DE)', slug: 'staff_de', fields: [] });
    await put('entry', 'anna', { id: 'anna', dataset: 'team', values: {} });
    await put('page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{#each dataset.team}}x{{/each}}</div>' });

    const res = await rename(t, pid, 'team', { slug: 'staff' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/staff_de/);
    expect((await get('dataset', 'team')).json().item.slug).toBe('team');
    expect((await get('dataset', 'team_de')).json().item.slug).toBe('team_de');
    expect((await get('entry', 'anna', 'team')).statusCode).toBe(200);
    expect((await get('page', 'home')).json().item.source).toContain('dataset.team}}');
  });

  it('refuses (409) to rename a dataset a widget on the site reads by name; the display name can still change', async () => {
    const { t, pid, put, get } = await setup();
    // Saving a page that composes the hero slider provisions its `hero` dataset.
    expect((await put('page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{> hero-slider}}</div>' })).statusCode).toBe(200);
    expect((await get('dataset', 'hero')).json().item.slug).toBe('hero');

    const res = await rename(t, pid, 'hero', { slug: 'hero_main' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/hero-slider/);
    expect((await get('dataset', 'hero')).json().item.slug).toBe('hero');

    expect((await rename(t, pid, 'hero', { slug: 'hero', name: 'Front page slider' })).statusCode).toBe(200);
    expect((await get('dataset', 'hero')).json().item.name).toBe('Front page slider');
  });

  it('cascade:false leaves all of those for the author, but still moves the entries', async () => {
    const { t, pid, put, get } = await setup();
    await put('settings', 'settings', settingsBody({ footer: '<div>{{#each dataset.items}}x{{/each}}</div>', dataFiles: [{ path: 'items.json', dataset: 'items' }] }, { locales: ['en', 'de'], defaultLocale: 'en' }));
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [] });
    await put('dataset', 'items_de', { id: 'items_de', name: 'Items (DE)', slug: 'items_de', fields: [] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Other', slug: 'other', fields: [{ name: 'rel', type: 'reference', config: { dataset: 'items' } }] });
    await put('entry', 'e1', { id: 'e1', dataset: 'items', values: {} });
    await put('snippet', 'list', { id: 'list', name: 'list', source: '<ul>{{#each dataset.items}}<li>x</li>{{/each}}</ul>' });

    const res = await rename(t, pid, 'ds1', { slug: 'features', cascade: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ entriesUpdated: 1, snippetsUpdated: 0, settingsUpdated: false, referencesUpdated: 0, localeCopiesRenamed: [] });
    expect((await get('entry', 'e1', 'features')).statusCode).toBe(200);
    expect((await get('snippet', 'list')).json().item.source).toContain('dataset.items}}');
    expect((await get('dataset', 'items_de')).json().item.slug).toBe('items_de');
    expect((await get('dataset', 'ds2')).json().item.fields[0].config.dataset).toBe('items');
    expect((await get('settings', 'settings')).json().item.website.dataFiles[0].dataset).toBe('items');
  });

  it('a rename and its reverse restore every reference exactly (and a same-slug rename touches nothing)', async () => {
    const { t, pid, put, get } = await setup();
    await put('settings', 'settings', settingsBody({ footer: '<div>{{#each dataset.items}}x{{/each}}</div>', dataFiles: [{ path: 'items.json', dataset: 'items' }] }, { locales: ['en', 'de'], defaultLocale: 'en' }));
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [{ name: 'self', type: 'reference', config: { dataset: 'items' } }] });
    await put('dataset', 'items_de', { id: 'items_de', name: 'Items (DE)', slug: 'items_de', fields: [] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Other', slug: 'other', fields: [{ name: 'rel', type: 'reference', config: { dataset: 'items' } }] });
    await put('snippet', 'list', { id: 'list', name: 'list', source: '<ul>{{#each dataset.items}}<li>{{item.items.e1.title}}</li>{{/each}}</ul>' });
    const snapshot = async () => ({
      ds1: (await get('dataset', 'ds1')).json().item,
      de: (await get('dataset', 'items_de')).json().item,
      ds2: (await get('dataset', 'ds2')).json().item,
      snippet: (await get('snippet', 'list')).json().item,
      website: (await get('settings', 'settings')).json().item.website,
    });
    const before = await snapshot();

    expect((await rename(t, pid, 'ds1', { slug: 'features' })).statusCode).toBe(200);
    expect((await rename(t, pid, 'ds1', { slug: 'items' })).statusCode).toBe(200);
    expect(await snapshot()).toEqual(before);

    const same = await rename(t, pid, 'ds1', { slug: 'items' });
    expect(same.json()).toMatchObject({ entriesUpdated: 0, pagesUpdated: 0, snippetsUpdated: 0, settingsUpdated: false, referencesUpdated: 0 });
  });
});
