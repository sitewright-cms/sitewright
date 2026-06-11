import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { RenderPool } from '../src/render/render-pool.js';
import { projectMembers } from '../src/db/schema.js';

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
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'owner@acme.test', password: 'Pw-secret-1' } });
  const t = token(reg);
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
const putSnippet = (t: string, projectId: string, id: string, source: string) =>
  app.inject({ method: 'PUT', url: `/projects/${projectId}/content/snippet/${id}`, cookies: { sw_session: t }, payload: { id, name: id, source } });
const preview = (t: string, projectId: string, id: string, scope?: string) =>
  app.inject({ method: 'GET', url: `/projects/${projectId}/snippets/${id}/preview${scope ? `?scope=${scope}` : ''}`, cookies: { sw_session: t } });

describe('snippet preview API (server-rendered, sandboxed)', () => {
  it('renders a stored project snippet to a styled document under the opaque sandbox CSP', async () => {
    const { t, projectId } = await setup();
    await putSnippet(t, projectId, 'hero', '<section class="grid"><h1>{{ company.name }}</h1></section>');
    const res = await preview(t, projectId, 'hero');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    // Exact value (not just "contains sandbox") so a future broadening to allow-same-origin fails here.
    expect(res.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.body.startsWith('<!doctype html>')).toBe(true);
    expect(res.body).toContain('<h1>Site</h1>'); // {{ company.name }} → the project name
    expect(res.body).toContain('display:grid'); // the snippet's `grid` class compiled + inlined → STYLED
  });

  it('resolves {{> other}} partials inside the previewed snippet', async () => {
    const { t, projectId } = await setup();
    await putSnippet(t, projectId, 'badge', '<span>{{ company.name }}</span>');
    await putSnippet(t, projectId, 'card', '<div>{{> badge}}</div>');
    const res = await preview(t, projectId, 'card');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div><span>Site</span></div>');
  });

  it('returns a sandboxed notice (not a styled doc) for an unknown snippet', async () => {
    const { t, projectId } = await setup();
    const res = await preview(t, projectId, 'nope');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.body).toMatch(/no longer exists/i);
    expect(res.body.startsWith('<!doctype html>')).toBe(true);
  });

  it('shows an error notice (200, sandboxed) — never a raw error — when the snippet errors at render', async () => {
    const { t, projectId } = await setup();
    // Saves cleanly (valid template) but references a partial that doesn't exist, so the worker
    // throws at RENDER — the route must catch it and return the sandboxed notice, not a 500/JSON.
    await putSnippet(t, projectId, 'broken', '<div>{{> no_such_partial_xyz}}</div>');
    const res = await preview(t, projectId, 'broken');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.body).toMatch(/previewed/i);
  });

  it('lets a project MEMBER preview (content:read gate, not owner-only like render-template)', async () => {
    const { t, projectId } = await setup();
    await putSnippet(t, projectId, 'm', '<p>{{ company.name }}</p>');
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'member@acme.test', password: 'Pw-secret-1' } });
    const memberT = token(reg);
    const memberId = (reg.json() as { userId: string }).userId;
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberId, projectId, role: 'member', createdAt: new Date() });
    const res = await preview(memberT, projectId, 'm');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<p>Site</p>');
  });

  it('404s a non-member (cross-tenant) and an unauthenticated request', async () => {
    const { t, projectId } = await setup();
    await putSnippet(t, projectId, 'x', '<p>x</p>');
    const anon = await app.inject({ method: 'GET', url: `/projects/${projectId}/snippets/x/preview` });
    expect(anon.statusCode).toBe(401);
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'outsider@acme.test', password: 'Pw-secret-1' } });
    const cross = await preview(token(reg), projectId, 'x');
    expect(cross.statusCode).toBe(403);
  });

  it('returns a 503 notice when no render pool is configured', async () => {
    const noPool = await createApp({ db: await makeTestDb() });
    await noPool.ready();
    const reg = await noPool.inject({ method: 'POST', url: '/auth/register', payload: { email: 'o@a.test', password: 'Pw-secret-1' } });
    const t = token(reg);
    const proj = await noPool.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'S', slug: 's' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const res = await noPool.inject({ method: 'GET', url: `/projects/${projectId}/snippets/x/preview`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(503);
    await noPool.close();
  });
});
