import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import type { PlatformRole } from '../src/db/schema.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db, renderPool: new RenderPool({ size: 1, workerPath }) });
});
afterEach(async () => {
  await app.close(); // drains + terminates the render worker
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
/**
 * Seed an account via the repo (the /auth/register route is invite-only now) and log in for a session
 * cookie. Pass a `platformRole` for agency staff: `developer` for a user that creates a project,
 * `admin` for an instance admin. A plain client passes none.
 */
async function register(email: string, platformRole?: PlatformRole): Promise<string> {
  await registerAccount(db, email, 'Pw-secret-1', platformRole ? { platformRole } : {});
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  return token(login);
}
/** Seed an instance admin (the persisted-role mechanism) and log in. */
async function registerAdmin(email: string): Promise<string> {
  return register(email, 'admin');
}
async function project(t: string, slug: string): Promise<string> {
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return (proj.json() as { project: { id: string } }).project.id;
}

describe('global snippet/template library', () => {
  it('seeds the built-in globals (templates stored with bare ids), readable by any authenticated user', async () => {
    const t = await register('reader@e2e.test');
    const snips = await app.inject({ method: 'GET', url: '/global/snippet', cookies: { sw_session: t } });
    expect(snips.statusCode).toBe(200);
    expect((snips.json().items as { name: string }[]).map((s) => s.name)).toContain('navbar');
    const tmpls = await app.inject({ method: 'GET', url: '/global/template', cookies: { sw_session: t } });
    const ids = (tmpls.json().items as { id: string }[]).map((x) => x.id);
    expect(ids).toContain('landing'); // bare id — the `global:` prefix is the reference convention, not the stored id
    expect(ids).not.toContain('global:landing');
  });

  it('only an instance admin may write a global — a project user is forbidden', async () => {
    const member = await register('member@e2e.test');
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/global/snippet/navbar',
      cookies: { sw_session: member },
      payload: { id: 'navbar', name: 'navbar', source: '<nav>nope</nav>' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('an admin-edited global snippet drives the render (the runtime store, not the built-in constant)', async () => {
    const memberT = await register('author@e2e.test', 'developer'); // creates a project → agency staff
    const projectId = await project(memberT, 'site');
    // A page that composes the GLOBAL `navbar` snippet.
    const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section>{{> navbar}}</section>' };
    expect((await app.inject({ method: 'PUT', url: `/projects/${projectId}/content/page/home`, cookies: { sw_session: memberT }, payload: page })).statusCode).toBe(200);

    const previewHtml = async () =>
      ((await app.inject({ method: 'POST', url: `/projects/${projectId}/preview`, cookies: { sw_session: memberT }, payload: page })).json() as { html: string }).html;

    // Before: the built-in navbar (a data-driven `menu menu-horizontal` bar).
    expect(await previewHtml()).toContain('menu-horizontal');

    // An admin rewrites the global navbar in the store.
    const admin = await registerAdmin('admin@e2e.test');
    const edit = await app.inject({
      method: 'PUT',
      url: '/admin/global/snippet/navbar',
      cookies: { sw_session: admin },
      payload: { id: 'navbar', name: 'navbar', source: '<div id="edited-global-nav">EDITED</div>' },
    });
    expect(edit.statusCode).toBe(200);

    // After: the SAME project page now renders the admin-edited global — proving the store drives render.
    const after = await previewHtml();
    expect(after).toContain('edited-global-nav');
    expect(after).not.toContain('menu-horizontal');
  });

  it('the reserved global scope is hidden from the admin project list and is not deletable', async () => {
    const admin = await registerAdmin('admin@e2e.test');
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: admin } });
    const slugs = ((me.json() as { projects: { slug: string }[] }).projects).map((p) => p.slug);
    expect(slugs).not.toContain('__global__');
    expect((await app.inject({ method: 'DELETE', url: '/projects/__global__', cookies: { sw_session: admin } })).statusCode).toBe(404);
  });

  it('the reserved scope is unreachable through the per-project content routes (no requireInstanceAdmin bypass)', async () => {
    // A platform admin resolves to `owner` on every project — but the per-project content routes must
    // 404 on `__global__` so the only write path to the library stays the admin-gated /admin/global/*.
    const admin = await registerAdmin('admin@e2e.test');
    const write = await app.inject({
      method: 'PUT',
      url: '/projects/__global__/content/snippet/navbar',
      cookies: { sw_session: admin },
      payload: { id: 'navbar', name: 'navbar', source: '<nav id="smuggled">x</nav>' },
    });
    expect(write.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: '/projects/__global__/content/snippet/navbar', cookies: { sw_session: admin } });
    expect(del.statusCode).toBe(404);
    // The library is untouched: the built-in navbar still resolves (its data-driven `nav.header` loop present).
    const snips = await app.inject({ method: 'GET', url: '/global/snippet', cookies: { sw_session: admin } });
    const navbar = (snips.json().items as { name: string; source: string }[]).find((s) => s.name === 'navbar');
    expect(navbar?.source).toContain('nav.header');
    expect(navbar?.source).not.toContain('smuggled');
  });
});
