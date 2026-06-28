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
  const get = (kind: string, id: string) => app.inject({ method: 'GET', url: `/projects/${pid}/content/${kind}/${id}`, cookies: { sw_session: t } });
  return { t, pid, put, get };
}

describe('POST /projects/:id/datasets/:id/rename', () => {
  it('cascades a slug rename to entries + page/template sources + reference targets', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [{ name: 'title', type: 'text' }] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Other', slug: 'other', fields: [{ name: 'rel', type: 'reference', config: { target: 'items' } }] });
    await put('entry', 'e1', { id: 'e1', dataset: 'items', values: { title: 'A' } });
    await put('entry', 'e2', { id: 'e2', dataset: 'items', values: { title: 'B' } });
    await put('entry', 'e3', { id: 'e3', dataset: 'other', values: {} });
    await put('page', 'home', { id: 'home', path: '', title: 'Home', source: '<div>{{#each dataset.items}}<p>{{title}}</p>{{/each}} {{sw-control dataset="items" as="dataset-item" target="page.data.x"}}</div>' });

    const res = await app.inject({ method: 'POST', url: `/projects/${pid}/datasets/ds1/rename`, cookies: { sw_session: t }, payload: { slug: 'features' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ oldSlug: 'items', newSlug: 'features', cascaded: true, entriesUpdated: 2, pagesUpdated: 1, referencesUpdated: 1 });

    expect((await get('dataset', 'ds1')).json().item.slug).toBe('features');
    expect((await get('entry', 'e1')).json().item.dataset).toBe('features');
    expect((await get('entry', 'e2')).json().item.dataset).toBe('features');
    expect((await get('entry', 'e3')).json().item.dataset).toBe('other'); // untouched
    const homeSrc = (await get('page', 'home')).json().item.source as string;
    expect(homeSrc).toContain('dataset.features');
    expect(homeSrc).toContain('dataset="features"');
    expect(homeSrc).not.toContain('dataset.items');
    expect((await get('dataset', 'ds2')).json().item.fields[0].config.target).toBe('features'); // reference retargeted
  });

  it('cascade:false renames only the dataset, leaving references on the old slug', async () => {
    const { t, pid, put, get } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [] });
    await put('entry', 'e1', { id: 'e1', dataset: 'items', values: {} });
    const res = await app.inject({ method: 'POST', url: `/projects/${pid}/datasets/ds1/rename`, cookies: { sw_session: t }, payload: { slug: 'features', cascade: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ newSlug: 'features', cascaded: false, entriesUpdated: 0 });
    expect((await get('dataset', 'ds1')).json().item.slug).toBe('features');
    expect((await get('entry', 'e1')).json().item.dataset).toBe('items'); // intentionally NOT cascaded
  });

  it('rejects renaming to a slug another dataset already uses (409)', async () => {
    const { t, pid, put } = await setup();
    await put('dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [] });
    await put('dataset', 'ds2', { id: 'ds2', name: 'Posts', slug: 'posts', fields: [] });
    const res = await app.inject({ method: 'POST', url: `/projects/${pid}/datasets/ds1/rename`, cookies: { sw_session: t }, payload: { slug: 'posts' } });
    expect(res.statusCode).toBe(409);
  });
});
