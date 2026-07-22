import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, slug = 'site') {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }),
  );
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

// A dataset keyed by slug (id === slug, as the editor does it).
const dataset = {
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'body', type: 'richtext' },
  ],
};
const entry = {
  id: 'post_1',
  dataset: 'posts',
  status: 'published',
  values: { title: 'Hello', body: 'World' },
};

describe('dataset + entry content API', () => {
  it('PUT → GET → list a dataset, then an entry', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const putDs = await app.inject({ method: 'PUT', url: `${base}/content/dataset/posts`, cookies, payload: dataset });
    expect(putDs.statusCode).toBe(200);
    // Zod applies defaults (required:false, localized:false) to fields.
    expect((putDs.json() as { item: { slug: string } }).item.slug).toBe('posts');

    const putEntry = await app.inject({ method: 'PUT', url: `${base}/content/entry/post_1`, cookies, payload: entry });
    expect(putEntry.statusCode).toBe(200);

    const dsList = await app.inject({ method: 'GET', url: `${base}/content/dataset`, cookies });
    expect((dsList.json() as { items: unknown[] }).items).toHaveLength(1);

    const entryList = await app.inject({ method: 'GET', url: `${base}/content/entry`, cookies });
    expect((entryList.json() as { items: Array<{ dataset: string }> }).items[0]?.dataset).toBe('posts');
  });

  it('rejects a dataset put whose SLUG belongs to another entity (409, the post-rename footgun)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await app.inject({ method: 'PUT', url: `${base}/content/dataset/posts`, cookies, payload: dataset });
    // Rename changes only the SLUG — the entity keeps id "posts".
    const renamed = await app.inject({ method: 'POST', url: `${base}/datasets/posts/rename`, cookies, payload: { slug: 'articles', cascade: true } });
    expect(renamed.statusCode).toBe(200);
    // An agent that re-puts using the NEW slug as the id must get a 409 pointing at the real entity,
    // not a silent second dataset carrying the same slug.
    const dup = await app.inject({
      method: 'PUT', url: `${base}/content/dataset/articles`, cookies,
      payload: { ...dataset, id: 'articles', slug: 'articles' },
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: string }).error).toContain('posts');
    // Writing via the ORIGINAL id still works.
    const ok = await app.inject({
      method: 'PUT', url: `${base}/content/dataset/posts`, cookies,
      payload: { ...dataset, slug: 'articles' },
    });
    expect(ok.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `${base}/content/dataset`, cookies });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('rejects a dataset whose id does not match the path (409)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/dataset/posts`,
      cookies: { sw_session: t },
      payload: { ...dataset, id: 'mismatch' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an invalid dataset field type (400)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/dataset/bad`,
      cookies: { sw_session: t },
      payload: { id: 'bad', name: 'Bad', slug: 'bad', fields: [{ name: 'x', type: 'nonsense' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deletes an entry (204) then 404s', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    // The owning dataset must exist first — an entry put against an unknown dataset 409s now.
    await app.inject({ method: 'PUT', url: `${base}/content/dataset/posts`, cookies, payload: dataset });
    const put = await app.inject({ method: 'PUT', url: `${base}/content/entry/post_1`, cookies, payload: entry });
    expect(put.statusCode).toBe(200);
    // An entry id is only unique within its dataset, so read/delete carry the owning dataset as ?dataset=.
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/entry/post_1?dataset=posts`, cookies });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `${base}/content/entry/post_1?dataset=posts`, cookies });
    expect(get.statusCode).toBe(404);
  });

  it('scopes entry ids to their dataset — two datasets can hold the SAME id', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const field = [{ name: 'title', type: 'text' }];
    await app.inject({ method: 'PUT', url: `${base}/content/dataset/posts`, cookies, payload: { id: 'posts', name: 'Posts', slug: 'posts', fields: field } });
    await app.inject({ method: 'PUT', url: `${base}/content/dataset/news`, cookies, payload: { id: 'news', name: 'News', slug: 'news', fields: field } });
    // Same entry id 'intro' in BOTH datasets — the second is NOT a conflict (different scope).
    const a = await app.inject({ method: 'PUT', url: `${base}/content/entry/intro`, cookies, payload: { id: 'intro', dataset: 'posts', status: 'published', values: { title: 'Posts intro' } } });
    const b = await app.inject({ method: 'PUT', url: `${base}/content/entry/intro`, cookies, payload: { id: 'intro', dataset: 'news', status: 'published', values: { title: 'News intro' } } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    // Both rows coexist.
    const list = (await app.inject({ method: 'GET', url: `${base}/content/entry`, cookies })).json() as { items: Array<{ id: string }> };
    expect(list.items.filter((e) => e.id === 'intro')).toHaveLength(2);

    // ?dataset= scopes the entry list to ONE dataset's rows.
    const postsList = (await app.inject({ method: 'GET', url: `${base}/content/entry?dataset=posts`, cookies })).json() as { items: Array<{ id: string; dataset: string; values: { title: string } }> };
    expect(postsList.items).toHaveLength(1);
    expect(postsList.items[0]!.dataset).toBe('posts');
    expect(postsList.items[0]!.values.title).toBe('Posts intro');
    // an invalid dataset slug → 400
    expect((await app.inject({ method: 'GET', url: `${base}/content/entry?dataset=Bad Slug!`, cookies })).statusCode).toBe(400);

    // GET by (dataset, id) resolves the RIGHT one.
    const posts = (await app.inject({ method: 'GET', url: `${base}/content/entry/intro?dataset=posts`, cookies })).json() as { item: { values: { title: string } } };
    const news = (await app.inject({ method: 'GET', url: `${base}/content/entry/intro?dataset=news`, cookies })).json() as { item: { values: { title: string } } };
    expect(posts.item.values.title).toBe('Posts intro');
    expect(news.item.values.title).toBe('News intro');

    // Deleting posts/intro leaves news/intro intact.
    expect((await app.inject({ method: 'DELETE', url: `${base}/content/entry/intro?dataset=posts`, cookies })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `${base}/content/entry/intro?dataset=posts`, cookies })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${base}/content/entry/intro?dataset=news`, cookies })).statusCode).toBe(200);
  });

  it('requires the ?dataset= query to address an entry by id (400)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await app.inject({ method: 'PUT', url: `${base}/content/dataset/posts`, cookies, payload: dataset });
    await app.inject({ method: 'PUT', url: `${base}/content/entry/post_1`, cookies, payload: entry });
    // The id alone is ambiguous across datasets → GET/DELETE without ?dataset= is a 400.
    expect((await app.inject({ method: 'GET', url: `${base}/content/entry/post_1`, cookies })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `${base}/content/entry/post_1`, cookies })).statusCode).toBe(400);
  });

  it('isolates datasets across tenants', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    await app.inject({
      method: 'PUT',
      url: `/projects/${a.projectId}/content/dataset/posts`,
      cookies: { sw_session: a.t },
      payload: dataset,
    });
    const bReadsA = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/content/dataset`,
      cookies: { sw_session: b.t },
    });
    expect(bReadsA.statusCode).toBe(403);
  });

  it('isolates entries across tenants (read and write)', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    await app.inject({
      method: 'PUT',
      url: `/projects/${a.projectId}/content/entry/post_1`,
      cookies: { sw_session: a.t },
      payload: entry,
    });

    const bReads = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/content/entry`,
      cookies: { sw_session: b.t },
    });
    expect(bReads.statusCode).toBe(403);

    const bWrites = await app.inject({
      method: 'PUT',
      url: `/projects/${a.projectId}/content/entry/post_2`,
      cookies: { sw_session: b.t },
      payload: { ...entry, id: 'post_2' },
    });
    expect(bWrites.statusCode).toBe(403);
  });
});
