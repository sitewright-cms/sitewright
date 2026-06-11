import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, slug = 'site') {
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'Pw-secret-1' },
  });
  const t = token(reg);
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
  id: 'post-1',
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

    const putEntry = await app.inject({ method: 'PUT', url: `${base}/content/entry/post-1`, cookies, payload: entry });
    expect(putEntry.statusCode).toBe(200);

    const dsList = await app.inject({ method: 'GET', url: `${base}/content/dataset`, cookies });
    expect((dsList.json() as { items: unknown[] }).items).toHaveLength(1);

    const entryList = await app.inject({ method: 'GET', url: `${base}/content/entry`, cookies });
    expect((entryList.json() as { items: Array<{ dataset: string }> }).items[0]?.dataset).toBe('posts');
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
    await app.inject({ method: 'PUT', url: `${base}/content/entry/post-1`, cookies, payload: entry });
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/entry/post-1`, cookies });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `${base}/content/entry/post-1`, cookies });
    expect(get.statusCode).toBe(404);
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
      url: `/projects/${a.projectId}/content/entry/post-1`,
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
      url: `/projects/${a.projectId}/content/entry/post-2`,
      cookies: { sw_session: b.t },
      payload: { ...entry, id: 'post-2' },
    });
    expect(bWrites.statusCode).toBe(403);
  });
});
