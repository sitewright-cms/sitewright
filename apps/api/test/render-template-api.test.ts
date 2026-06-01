import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { RenderPool } from '../src/render/render-pool.js';
import { memberships } from '../src/db/schema.js';

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
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'owner@acme.test', password: 'pw-secret-1', orgName: 'Acme' } });
  const t = token(reg);
  const orgId = (reg.json() as { orgId: string }).orgId;
  const proj = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, orgId, projectId };
}

describe('render-template API (isolated worker)', () => {
  it('renders a Handlebars template against the project context (owner)', async () => {
    const { t, orgId, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<h1>{{ company.name }}</h1><p>{{ page.title }}</p>' },
    });
    expect(res.statusCode).toBe(200);
    // company.name falls back to the project name; page.title defaults to it too.
    expect((res.json() as { html: string }).html).toBe('<h1>Site</h1><p>Site</p>');
  });

  it('renders a template that includes a saved snippet (Handlebars partial)', async () => {
    const { t, orgId, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/orgs/${orgId}/projects/${projectId}/content/snippet/card`,
      cookies: { sw_session: t },
      payload: { id: 'card', name: 'card', source: '<li>{{ company.name }}</li>' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<ul>{{> card}}</ul>' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { html: string }).html).toBe('<ul><li>Site</li></ul>');
  });

  it('rejects rendering when a SAVED snippet is unsafe (partials are validated too)', async () => {
    const { t, orgId, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/orgs/${orgId}/projects/${projectId}/content/snippet/evil`,
      cookies: { sw_session: t },
      payload: { id: 'evil', name: 'evil', source: '<script>steal()</script>' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<div>{{> evil}}</div>' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/script/i);
  });

  it('renders a STORED source-page by pageId (the page = template model)', async () => {
    const { t, orgId, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/orgs/${orgId}/projects/${projectId}/content/page/home`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '/', title: 'Welcome',
        root: { id: 'root', type: 'Section' },
        source: '<h1>{{ company.name }}</h1><p>{{ page.title }}</p>',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { pageId: 'home' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { html: string }).html).toBe('<h1>Site</h1><p>Welcome</p>');
  });

  it('rejects rendering a page that has no template source (400)', async () => {
    const { t, orgId, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/orgs/${orgId}/projects/${projectId}/content/page/blocky`,
      cookies: { sw_session: t },
      payload: { id: 'blocky', path: '/blocky', title: 'Block', root: { id: 'root', type: 'Section' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { pageId: 'blocky' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/no template source/i);
  });

  it('rejects an unsafe template with 400 (the validator runs in the worker)', async () => {
    const { t, orgId, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: t },
      payload: { template: '<div class={{ company.name }}>x</div>' }, // unquoted attribute
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/unsafe|unquoted/i);
  });

  it('forbids a non-owner/admin (client member) from rendering', async () => {
    const { orgId, projectId } = await setup();
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'client@acme.test', password: 'pw-secret-1', orgName: 'Client' } });
    const memberT = token(reg);
    const memberId = (reg.json() as { userId: string }).userId;
    await db.insert(memberships).values({ id: randomUUID(), userId: memberId, orgId, role: 'member', createdAt: new Date() });
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/render-template`,
      cookies: { sw_session: memberT },
      payload: { template: '<p>{{ company.name }}</p>' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 503 when no render pool is configured', async () => {
    const noPool = await createApp({ db: await makeTestDb() });
    await noPool.ready();
    const reg = await noPool.inject({ method: 'POST', url: '/auth/register', payload: { email: 'o@a.test', password: 'pw-secret-1', orgName: 'A' } });
    const t = token(reg);
    const orgId = (reg.json() as { orgId: string }).orgId;
    const proj = await noPool.inject({ method: 'POST', url: `/orgs/${orgId}/projects`, cookies: { sw_session: t }, payload: { name: 'S', slug: 's' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const res = await noPool.inject({ method: 'POST', url: `/orgs/${orgId}/projects/${projectId}/render-template`, cookies: { sw_session: t }, payload: { template: '<p>x</p>' } });
    expect(res.statusCode).toBe(503);
    await noPool.close();
  });
});
