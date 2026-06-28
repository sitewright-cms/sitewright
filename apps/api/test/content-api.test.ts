import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { projectMembers } from '../src/db/schema.js';
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
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

const page = { id: 'home', path: '', title: 'Home' };

describe('content API', () => {
  it('a project member may write any content kind (constrained client-write removed)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = `/projects/${projectId}`;
    const editablePage = {
      id: 'home',
      path: '',
      title: 'Home',
      source: '<h1 data-sw-text="headline">Welcome</h1>',
      data: { headline: 'Original' },
    };
    expect((await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: t }, payload: editablePage })).statusCode).toBe(200);

    // A second user granted access to this project as a member.
    const { userId: memberUserId } = await registerAccount(db, 'client@acme.test', 'Pw-secret-1');
    const memberT = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client@acme.test', password: 'Pw-secret-1' } }));
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberUserId, projectId, role: 'member', createdAt: new Date() });

    const edit = (mut: (p: typeof editablePage) => void) => {
      const next = JSON.parse(JSON.stringify(editablePage));
      mut(next);
      return app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: memberT }, payload: next });
    };

    // A member may now write all of these — the old constrained-write gate is gone.
    expect((await edit((p) => { p.data.headline = 'Client wrote this'; })).statusCode).toBe(200);
    expect((await edit((p) => { p.data.headline = 'Member edit'; })).statusCode).toBe(200);
    expect((await edit((p) => { delete (p as Record<string, unknown>).data; })).statusCode).toBe(200);
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

    // Missing required `path` field → Zod validation error → 400
    const bad = await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies: { sw_session: t },
      payload: { id: 'home', title: 'No path' },
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
          // Page references a collection dataset that doesn't exist → validateProject → 409
          { id: 'b', path: '[slug]', title: 'B', collection: { dataset: 'ghost', param: 'slug' } },
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

  it("isolates content across tenants (a non-member cannot touch another owner's project)", async () => {
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

describe('content API — validate-on-save (unsafe Handlebars source rejected at write)', () => {
  const put = (t: string, projectId: string, kind: string, id: string, payload: object) =>
    app.inject({ method: 'PUT', url: `/projects/${projectId}/content/${kind}/${id}`, cookies: { sw_session: t }, payload });

  it('rejects an unsafe page source at SAVE with a LOCATED 400 (not only at publish)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const res = await put(t, projectId, 'page', 'home', {
      ...page,
      source: '<section>\n  <a href="{{ page.link }}">x</a>\n</section>', // bad href on line 2
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; line?: number; column?: number };
    expect(body.error).toMatch(/sw-url/);
    expect(body.line).toBe(2);
    expect(body.column).toBeGreaterThan(0);
    expect(body.error).toContain('(line 2, column'); // position rides in the message too
  });

  it('accepts a safe page source and a template-based page (no own source to validate)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    expect(
      (await put(t, projectId, 'page', 'home', { ...page, source: '<section><a href="{{sw-url page.link}}">x</a></section>' })).statusCode,
    ).toBe(200);
    expect(
      (await put(t, projectId, 'page', 'p2', { id: 'p2', path: 'p2', title: 'P2', template: 'global:landing' })).statusCode,
    ).toBe(200);
  });

  it('rejects unsafe template and snippet source too (same save-time gate)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    expect((await put(t, projectId, 'template', 'land', { id: 'land', name: 'Landing', source: '<nav>x</nav>' })).statusCode).toBe(400);
    expect((await put(t, projectId, 'snippet', 'card', { id: 'card', name: 'card', source: '<div onclick="{{x}}">x</div>' })).statusCode).toBe(400);
  });

  it('LOUDLY rejects a skeleton landmark in a chrome slot (slot-named) but allows neutral slot content', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = { identity: { name: 'Acme', colors: {} }, settings: {} };
    const bad = await put(t, projectId, 'settings', 'settings', { ...base, website: { footer: '<footer><div>x</div></footer>' } });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toMatch(/Footer.*<footer>/); // names the slot + element
    expect((await put(t, projectId, 'settings', 'settings', { ...base, website: { mainNav: '<nav>x</nav>' } })).statusCode).toBe(400);
    // neutral content is fine (the platform wraps it in the landmark)
    expect((await put(t, projectId, 'settings', 'settings', { ...base, website: { footer: '<div class="footer">ok</div>' } })).statusCode).toBe(200);
  });
});
