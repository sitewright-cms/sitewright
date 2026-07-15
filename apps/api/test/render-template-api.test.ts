import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { RenderPool } from '../src/render/render-pool.js';
import { content, projectMembers } from '../src/db/schema.js';
import { registerAccount } from '../src/repo/accounts.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db, renderPool: new RenderPool({ size: 1, workerPath }) });
  await app.ready();
});
afterEach(async () => {
  await app.close(); // onClose drains + terminates the render workers
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup() {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, 'owner@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@acme.test', password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

describe('render-template API (isolated worker)', () => {
  it('renders a Handlebars template against the project context (owner)', async () => {
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<h1>{{ company.name }}</h1><p>{{ page.title }}</p>' },
    });
    expect(res.statusCode).toBe(200);
    // company.name falls back to the project name; page.title defaults to it too.
    expect((res.json() as { html: string }).html).toBe('<h1>Site</h1><p>Site</p>');
  });

  it('renders a template that includes a saved snippet (Handlebars partial)', async () => {
    const { t, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/snippet/card`,
      cookies: { sw_session: t },
      payload: { id: 'card', name: 'card', source: '<li>{{ company.name }}</li>' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<ul>{{> card}}</ul>' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { html: string }).html).toBe('<ul><li>Site</li></ul>');
  });

  it('wraps the render in a full styled document when document:true (the editor preview)', async () => {
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<div class="grid"><h1>{{ company.name }}</h1></div>', document: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    const html = body.html;
    // A complete document shell wrapping the rendered source body…
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // …the source body sits inside the skeleton's <main id="page-content"> landmark.
    expect(html).toContain('<main id="page-content"><div class="grid"><h1>Site</h1></div></main>');
    // …with the source's literal Tailwind class compiled + inlined so the preview is STYLED.
    expect(html).toContain('display:grid');

    // It also mints a previewStore token so the editor can load the doc via an iframe `src`
    // (served under an opaque-origin sandbox CSP) instead of `srcDoc` (which inherits the editor CSP).
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
    const served = await app.inject({
      method: 'GET',
      url: `/preview/site/${body.token}`, // preview docs are addressed by the project slug ('site')
      cookies: { sw_session: t },
    });
    expect(served.statusCode).toBe(200);
    // Exact value (not just "contains sandbox") so a future broadening to allow-same-origin fails here.
    expect(served.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(served.body).toBe(html); // the token serves the exact same document
  });

  it('does NOT mint a token for a bare (document:false) render', async () => {
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<p>{{ company.name }}</p>' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { token?: string }).token).toBeUndefined();
  });

  it('rejects rendering when a SAVED snippet is unsafe (partials are validated too)', async () => {
    const { t, projectId } = await setup();
    // Seed the unsafe snippet DIRECTLY (bypassing the route's validate-on-save, which would now
    // reject it) — simulating a snippet that reached storage via a non-validated path (seed/import/
    // legacy). Rendering must STILL reject it: render-time partial validation is the backstop.
    await db.insert(content).values({
      id: randomUUID(),
      projectId,
      kind: 'snippet',
      entityId: 'evil',
      data: { id: 'evil', name: 'evil', source: '<div onclick="steal()">x</div>' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<div>{{> evil}}</div>' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/handler|onclick/i);
  });

  it('renders a STORED source-page by pageId (the page = template model)', async () => {
    const { t, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/page/home`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Welcome',
        root: { id: 'root', type: 'Section' },
        source: '<h1>{{ company.name }}</h1><p>{{ page.title }}</p>',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { pageId: 'home' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { html: string }).html).toBe('<h1>Site</h1><p>Welcome</p>');
  });

  it('rejects rendering a page that has no template source (400)', async () => {
    const { t, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/page/blocky`,
      cookies: { sw_session: t },
      payload: { id: 'blocky', path: 'blocky', title: 'Block', root: { id: 'root', type: 'Section' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { pageId: 'blocky' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/no template source/i);
  });

  it('rejects an unsafe template with 400 (the validator runs in the worker)', async () => {
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<div class={{ company.name }}>x</div>' }, // unquoted attribute
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/unsafe|unquoted/i);
  });

  it('lets a project member render a template (constrained client-write removed)', async () => {
    const { projectId } = await setup();
    const { userId: memberId } = await registerAccount(db, 'client@acme.test', 'Pw-secret-1');
    const memberT = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client@acme.test', password: 'Pw-secret-1' } }));
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberId, projectId, role: 'member', createdAt: new Date() });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-template`,
      cookies: { sw_session: memberT },
      payload: { template: '<p>{{ company.name }}</p>' },
    });
    // A member is now a writer, so rendering is permitted.
    expect(res.statusCode).toBe(200);
    expect((res.json() as { html: string }).html).toBe('<p>Site</p>');
  });

  it('returns 503 when no render pool is configured', async () => {
    const noPoolDb = await makeTestDb();
    const noPool = await createApp({ db: noPoolDb });
    await noPool.ready();
    await registerAccount(noPoolDb, 'o@a.test', 'Pw-secret-1', { platformRole: 'developer' });
    const t = token(await noPool.inject({ method: 'POST', url: '/auth/login', payload: { email: 'o@a.test', password: 'Pw-secret-1' } }));
    const proj = await noPool.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'S', slug: 's' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const res = await noPool.inject({ method: 'POST', url: `/projects/${projectId}/render-template`, cookies: { sw_session: t }, payload: { template: '<p>x</p>' } });
    expect(res.statusCode).toBe(503);
    await noPool.close();
  });
});
