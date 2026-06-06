import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { projectMembers } from '../src/db/schema.js';

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
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1' },
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

const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };

describe('content API', () => {
  it('a project member may write any content kind (constrained client-write removed)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = `/projects/${projectId}`;
    const editablePage = {
      id: 'home',
      path: '',
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
    expect((await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: t }, payload: editablePage })).statusCode).toBe(200);

    // A second user granted access to this project as a member.
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'client@acme.test', password: 'pw-secret-1'} });
    const memberT = token(reg);
    const memberUserId = (reg.json() as { userId: string }).userId;
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberUserId, projectId, role: 'member', createdAt: new Date() });

    const edit = (mut: (p: typeof editablePage) => void) => {
      const next = JSON.parse(JSON.stringify(editablePage));
      mut(next);
      return app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: memberT }, payload: next });
    };

    // A member may now write all of these — the old constrained-write gate is gone.
    // Editable node content → allowed.
    expect((await edit((p) => { p.root.children[1]!.props.text = 'Client wrote this'; })).statusCode).toBe(200);
    // Previously-locked node content → now allowed.
    expect((await edit((p) => { p.root.children[0]!.props.text = 'Member edit'; })).statusCode).toBe(200);
    // Structural change → now allowed.
    expect((await edit((p) => { p.root.children.pop(); })).statusCode).toBe(200);
    // A non-page kind → now allowed.
    const partial = await app.inject({ method: 'PUT', url: `${base}/content/partial/x`, cookies: { sw_session: memberT }, payload: { id: 'x', name: 'X', root: { id: 'xr', type: 'Section' } } });
    expect(partial.statusCode).toBe(200);
  });

  it('rate-limits the content routes tighter than the global cap (writes 60, reads 120)', async () => {
    const { t, projectId } = await setup('rl@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const put = await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: page });
    expect(put.statusCode).toBe(200);
    expect(Number(put.headers['x-ratelimit-limit'])).toBe(60);
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/page/home`, cookies });
    expect(Number(del.headers['x-ratelimit-limit'])).toBe(60);
    const list = await app.inject({ method: 'GET', url: `${base}/content/page`, cookies });
    expect(Number(list.headers['x-ratelimit-limit'])).toBe(120);
    const get = await app.inject({ method: 'GET', url: `${base}/content/dataset/none`, cookies });
    expect(Number(get.headers['x-ratelimit-limit'])).toBe(120);
  });

  it('PUT → GET → list → export a page', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    const put = await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies: { sw_session: t },
      payload: page,
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect((get.json() as { item: { title: string } }).item.title).toBe('Home');

    const list = await app.inject({ method: 'GET', url: `${base}/content/page`, cookies: { sw_session: t } });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);

    const exp = await app.inject({ method: 'GET', url: `${base}/export`, cookies: { sw_session: t } });
    expect((exp.json() as { pages: unknown[] }).pages).toHaveLength(1);
  });

  it('rejects an invalid payload (400) and an unknown kind (404)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    const bad = await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies: { sw_session: t },
      payload: { id: 'home', title: 'No root' },
    });
    expect(bad.statusCode).toBe(400);

    const unknown = await app.inject({
      method: 'GET',
      url: `${base}/content/widgets`,
      cookies: { sw_session: t },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('imports a bundle (200) and rejects an invalid one (409)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    const ok = await app.inject({
      method: 'POST',
      url: `${base}/import`,
      cookies: { sw_session: t },
      payload: { pages: [page] },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { imported: number }).imported).toBeGreaterThanOrEqual(1);

    const bad = await app.inject({
      method: 'POST',
      url: `${base}/import`,
      cookies: { sw_session: t },
      payload: {
        pages: [
          { id: 'b', path: 'b', title: 'B', root: { id: 'r', type: 'Grid', binding: { dataset: 'ghost', mode: 'list' } } },
        ],
      },
    });
    expect(bad.statusCode).toBe(409);
  });

  it('deletes a page (204) and 404s afterwards', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: t }, payload: page });
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect(get.statusCode).toBe(404);
  });

  it('isolates content across tenants (a non-member cannot touch another owner’s project)', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    await app.inject({
      method: 'PUT',
      url: `/projects/${a.projectId}/content/page/home`,
      cookies: { sw_session: a.t },
      payload: page,
    });

    const bReadsA = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/content/page`,
      cookies: { sw_session: b.t },
    });
    expect(bReadsA.statusCode).toBe(403);
  });
});
