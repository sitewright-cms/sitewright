import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ProjectBundle } from '@sitewright/core';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { buildSite } from '../src/publish/build.js';

// ---------------------------------------------------------------------------
// buildSite preview-mode options (includeDrafts + previewRuntime), tested directly.
// ---------------------------------------------------------------------------
describe('buildSite preview options', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'sw-preview-build-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  function bundle(pages: ProjectBundle['pages']): ProjectBundle {
    return {
      project: {
        formatVersion: 2 as const,
        id: 'p',
        name: 'Acme',
        slug: 'acme',
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
      },
      pages,
      datasets: [],
      entries: [],
    } as ProjectBundle;
  }

  const pages = [
    { id: 'home', path: '', title: 'Home', source: '<h1>Home</h1>' },
    { id: 'sec', path: 'secret', title: 'Secret', status: 'draft', source: '<h1>Secret Draft</h1>' },
  ] as unknown as ProjectBundle['pages'];

  it('includeDrafts: draft pages get a route (the published build omits them)', async () => {
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, includeDrafts: true, bundle: bundle(pages) });
    expect(await readFile(join(outDir, 'secret/index.html'), 'utf8')).toContain('Secret Draft');
  });

  it('without includeDrafts, a draft page is excluded', async () => {
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle(pages) });
    await expect(readFile(join(outDir, 'secret/index.html'), 'utf8')).rejects.toThrow();
    // The published home is still there.
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('Home');
  });

  it('previewRuntime is injected inline into every rendered page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      previewRuntime: 'window.__SW_PREVIEW_MARKER__=1;',
      bundle: bundle([{ id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' }] as unknown as ProjectBundle['pages']),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('window.__SW_PREVIEW_MARKER__=1;');
  });
});

// ---------------------------------------------------------------------------
// The live preview-site API routes (serve / locate / agent-presence).
// ---------------------------------------------------------------------------
describe('preview-site API', () => {
  let app: FastifyInstance;
  let previewRoot: string;

  beforeEach(async () => {
    previewRoot = await mkdtemp(join(tmpdir(), 'sw-preview-'));
    app = await createApp({ db: await makeTestDb(), previewRoot });
    await app.ready();
  });
  afterEach(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });

  function token(res: { cookies: Array<{ name: string; value: string }> }): string {
    const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
    if (!t) throw new Error('no session cookie');
    return t;
  }
  async function setup(email: string, slug = 'site') {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'Pw-secret-1' } });
    const t = token(reg);
    const proj = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    return { t, projectId, slug };
  }
  const putPage = (base: string, cookies: Record<string, string>, page: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `${base}/content/page/${page.id}`, cookies, payload: page });

  it('serves the live preview of saved content (sandboxed, runtime injected), drafts included', async () => {
    const { t, projectId } = await setup('p@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Home Live</h1>' });
    await putPage(base, cookies, { id: 'wip', path: 'wip', title: 'WIP', status: 'draft', source: '<h1>Draft WIP</h1>' });

    const res = await app.inject({ method: 'GET', url: `${base}/preview-site/`, cookies });
    expect(res.statusCode).toBe(200);
    // The doc is sandboxed (opaque origin) + same-origin-frameable + no-store.
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body).toContain('Home Live');
    // The parent-bridge runtime is present.
    expect(res.body).toContain('sitewright-preview-site');

    // A DRAFT page is browsable in the preview (a published build would 404 it).
    const draft = await app.inject({ method: 'GET', url: `${base}/preview-site/wip/`, cookies });
    expect(draft.statusCode).toBe(200);
    expect(draft.body).toContain('Draft WIP');
  });

  it('rebuilds on the next request after content changes', async () => {
    const { t, projectId } = await setup('rb@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Version ONE</h1>' });
    const v1 = await app.inject({ method: 'GET', url: `${base}/preview-site/`, cookies });
    expect(v1.body).toContain('Version ONE');

    // updatedAt is ms-precision; a small gap guarantees the version (and thus the build) advances.
    await new Promise((r) => setTimeout(r, 10));
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Version TWO</h1>' });
    const v2 = await app.inject({ method: 'GET', url: `${base}/preview-site/`, cookies });
    expect(v2.body).toContain('Version TWO');
    expect(v2.body).not.toContain('Version ONE');
  });

  it('canonicalizes an extensionless, slash-less page URL with a 301', async () => {
    const { t, projectId } = await setup('rd@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    await putPage(base, cookies, { id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>' });
    const res = await app.inject({ method: 'GET', url: `${base}/preview-site/about`, cookies });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe(`${base}/preview-site/about/`);
  });

  it('preview-locate resolves a page id to its route; null for non-pages', async () => {
    const { t, projectId } = await setup('lc@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    await putPage(base, cookies, { id: 'about', path: 'about', title: 'About', source: '<h1>A</h1>' });

    const about = await app.inject({ method: 'GET', url: `${base}/preview-locate?entity=about`, cookies });
    expect(about.json()).toEqual({ path: 'about' });
    const home = await app.inject({ method: 'GET', url: `${base}/preview-locate?entity=home`, cookies });
    expect(home.json()).toEqual({ path: '' });
    const none = await app.inject({ method: 'GET', url: `${base}/preview-locate?entity=does-not-exist`, cookies });
    expect(none.json()).toEqual({ path: null });
  });

  it('a broken page source fails the build gracefully (404, no crash) and arms a cooldown', async () => {
    const { t, projectId } = await setup('bk@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    // An unclosed Handlebars block → renderTemplate throws → buildSite throws → the build fails.
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '{{#each items}}' });
    const res = await app.inject({ method: 'GET', url: `${base}/preview-site/`, cookies });
    expect(res.statusCode).toBe(404);
    // An immediate retry is gated by the cooldown — still a clean 404, no crash/spin.
    const retry = await app.inject({ method: 'GET', url: `${base}/preview-site/`, cookies });
    expect(retry.statusCode).toBe(404);
  });

  it('agent-presence returns a connected count (0 with no agents)', async () => {
    const { t, projectId } = await setup('ap@acme.test');
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/agent-presence`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: 0 });
  });

  it('requires authentication and tenant membership', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    const unauth = await app.inject({ method: 'GET', url: `/projects/${a.projectId}/preview-site/` });
    expect(unauth.statusCode).toBe(401);
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/preview-site/`,
      cookies: { sw_session: b.t },
    });
    expect(crossTenant.statusCode).toBe(403);
  });
});
