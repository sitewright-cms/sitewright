import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;
let publishRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-sites-'));
  app = createApp({ db: await makeTestDb(), publishRoot });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, orgName: string) {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'pw-secret-1', orgName } });
  const t = token(reg);
  const orgId = (reg.json() as { orgId: string }).orgId;
  const proj = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, orgId, projectId };
}

const homePage = {
  id: 'home',
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Live Site' } }] },
};

describe('publish API', () => {
  it('publishes a project and serves the built site', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const base = `/orgs/${orgId}/projects/${projectId}`;
    const cookies = { sw_session: t };

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });

    const pub = await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as { release: { routes: number }; url: string };
    expect(body.release.routes).toBe(1);
    expect(body.url).toBe(`/sites/${projectId}/`);

    // The published home page is publicly servable and contains the rendered content.
    const served = await app.inject({ method: 'GET', url: `/sites/${projectId}/` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toContain('text/html');
    expect(served.body).toContain('Live Site');
    expect(served.body.startsWith('<!doctype html>')).toBe(true);

    // Status endpoint reports the release.
    const status = await app.inject({ method: 'GET', url: `${base}/publish`, cookies });
    expect((status.json() as { release: { routes: number } }).release.routes).toBe(1);
  });

  it('exports the published site as a zip (409 before publishing)', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const base = `/orgs/${orgId}/projects/${projectId}`;
    const cookies = { sw_session: t };

    const early = await app.inject({ method: 'GET', url: `${base}/publish/archive`, cookies });
    expect(early.statusCode).toBe(409);

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });

    const zip = await app.inject({ method: 'GET', url: `${base}/publish/archive`, cookies });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toContain('.zip');
    // PK zip magic bytes.
    expect(zip.rawPayload[0]).toBe(0x50);
    expect(zip.rawPayload[1]).toBe(0x4b);
  });

  it('validates deploy config and requires a prior publish', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const base = `/orgs/${orgId}/projects/${projectId}`;
    const cookies = { sw_session: t };

    // Not published yet → 409 regardless of body.
    const notPublished = await app.inject({
      method: 'POST',
      url: `${base}/publish/deploy`,
      cookies,
      payload: { protocol: 'ftp', host: 'h', user: 'u', password: 'p' },
    });
    expect(notPublished.statusCode).toBe(409);

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });

    // Published, but an unknown protocol is a 400.
    const bad = await app.inject({
      method: 'POST',
      url: `${base}/publish/deploy`,
      cookies,
      payload: { protocol: 'telnet', host: 'h', user: 'u', password: 'p' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('forbids exporting another tenant’s archive', async () => {
    const a = await setup('a@acme.test', 'Acme');
    const b = await setup('b@globex.test', 'Globex');
    const res = await app.inject({
      method: 'GET',
      url: `/orgs/${a.orgId}/projects/${a.projectId}/publish/archive`,
      cookies: { sw_session: b.t },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids deploying another tenant’s project', async () => {
    const a = await setup('a@acme.test', 'Acme');
    const b = await setup('b@globex.test', 'Globex');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${a.orgId}/projects/${a.projectId}/publish/deploy`,
      cookies: { sw_session: b.t },
      payload: { protocol: 'ftp', host: 'h', user: 'u', password: 'p' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication and write role / tenant membership', async () => {
    const a = await setup('a@acme.test', 'Acme');
    const b = await setup('b@globex.test', 'Globex');

    const unauth = await app.inject({ method: 'POST', url: `/orgs/${a.orgId}/projects/${a.projectId}/publish` });
    expect(unauth.statusCode).toBe(401);

    const crossTenant = await app.inject({
      method: 'POST',
      url: `/orgs/${a.orgId}/projects/${a.projectId}/publish`,
      cookies: { sw_session: b.t },
    });
    expect(crossTenant.statusCode).toBe(403);
  });

  it('404s for an unpublished site and rejects path traversal in the serve route', async () => {
    const { projectId } = await setup('a@acme.test', 'Acme');
    const notPublished = await app.inject({ method: 'GET', url: `/sites/${projectId}/` });
    expect(notPublished.statusCode).toBe(404);

    // A traversal attempt resolves outside the site dir → 404 (never escapes).
    const traversal = await app.inject({ method: 'GET', url: `/sites/${projectId}/..%2f..%2frelease` });
    expect([404]).toContain(traversal.statusCode);
  });
});
