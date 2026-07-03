import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ProjectBundle } from '@sitewright/core';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { PREVIEW_SITE_RUNTIME_JS } from '../src/http/preview-site-runtime.js';
import { neutralizeInlineScript } from '@sitewright/blocks';
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

  it('preview runtime hash is added to a page that bakes a consent meta CSP (so the inline runtime is not CSP-blocked)', async () => {
    // A cross-origin author <iframe> (e.g. a Maps embed) bakes a `<meta http-equiv=CSP>` with
    // `script-src 'self'`. The whole-site preview is served sandboxed and the browser intersects header ∩
    // meta, so a bare `'self'` silently blocks the inline runtime. The build must feed the runtime's own
    // sha256 into that meta's script-src. (Regression: droombos' Maps embed → dead preview.)
    const embedPage = [
      { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1><iframe src="https://www.google.com/maps/embed?pb=1" title="map"></iframe>' },
    ] as unknown as ProjectBundle['pages'];
    const hash = createHash('sha256').update(PREVIEW_SITE_RUNTIME_JS, 'utf8').digest('base64');

    // The meta `content` is attribute-escaped (`'` → `&#39;`); decode it back to inspect directives.
    const metaCsp = (html: string): string | null => {
      const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/);
      return m ? m[1]!.replace(/&#39;/g, "'") : null;
    };

    // Preview build → meta CSP carries the runtime hash on script-src.
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, previewRuntime: PREVIEW_SITE_RUNTIME_JS, bundle: bundle(embedPage) });
    const preview = metaCsp(await readFile(join(outDir, 'index.html'), 'utf8'));
    expect(preview, 'preview page must bake a consent meta CSP for the embed').not.toBeNull();
    const scriptSrc = preview!.split('; ').find((d) => d.split(' ')[0] === 'script-src')!;
    expect(scriptSrc).toBe(`script-src 'self' 'sha256-${hash}'`); // hash appended, nothing else touched
    expect(preview!).toContain("frame-src 'self' https://www.google.com"); // embed origin preserved

    // Published build (no previewRuntime) → identical meta MINUS the hash: no leak into shipped HTML.
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle(embedPage) });
    const published = metaCsp(await readFile(join(outDir, 'index.html'), 'utf8'))!;
    expect(published).not.toContain('sha256-');
    expect(published).toBe(preview!.replace(` 'sha256-${hash}'`, '')); // byte-identical apart from the hash
  });

  it('the runtime CSP hash tracks the NEUTRALIZED inlined bytes (safe if the runtime ever holds </script)', async () => {
    // renderDocument neutralizes `</script` → `<\/script` when it inlines a script. A runtime carrying that
    // sequence would otherwise hash differently from the bytes the browser sees. The build must hash the
    // post-neutralization form (via the SHARED neutralizeInlineScript helper), so the two never drift.
    const runtime = 'window.__x="</script>";';
    const embedPage = [
      { id: 'home', path: '', title: 'Home', source: '<iframe src="https://www.google.com/maps/embed?pb=1" title="map"></iframe>' },
    ] as unknown as ProjectBundle['pages'];
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, previewRuntime: runtime, bundle: bundle(embedPage) });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('window.__x="<\\/script>"'); // emitted bytes are neutralized
    const expected = createHash('sha256').update(neutralizeInlineScript(runtime), 'utf8').digest('base64');
    const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)![1]!.replace(/&#39;/g, "'");
    expect(meta).toContain(`sha256-${expected}`);
  });

  it('a preview build scrolls on <body> (real sub-frame scrollbar); a published build scrolls the viewport', async () => {
    const onePage = [{ id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' }] as unknown as ProjectBundle['pages'];
    // Published → viewport scroll, no body-scroll override.
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle(onePage) });
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).not.toContain('overflow-y:auto');
    // Preview → <html> clipped, <body> the scroll container; the runtime bridges window scroll to it.
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, previewRuntime: PREVIEW_SITE_RUNTIME_JS, bundle: bundle(onePage) });
    const preview = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(preview).toContain('body{height:100%;min-height:0;overflow-y:auto;scrollbar-width:thin;');
    expect(preview).toContain('scrollbar-color:var(--sw-color-primary,#4f46e5) var(--sw-color-base-100,#ffffff)}');
    expect(preview).toContain('bridgeScroll'); // the window→body scroll bridge ships with the preview runtime
  });

  it('includes the preloader overlay in BOTH the published and the preview build', async () => {
    const onePage = [{ id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' }] as unknown as ProjectBundle['pages'];
    const withPreloader = (): ProjectBundle => {
      const b = bundle(onePage);
      return { ...b, project: { ...b.project, website: { effects: { preloaderEffect: 'logo-pulse' } } } } as ProjectBundle;
    };
    // Published build → the loading overlay is present.
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: withPreloader() });
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('data-sw-preloader');
    // Preview build (previewRuntime set) → the overlay is NOW shown too (WYSIWYG); it clears on the
    // iframe's own window.load + an 8s failsafe, so it can never stay stuck covering the page.
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, previewRuntime: '/*x*/', bundle: withPreloader() });
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('data-sw-preloader');
  });
});

// ---------------------------------------------------------------------------
// The live preview-site API routes: a member mints a SIGNED base, then the draft is served at that
// signed path WITHOUT a cookie (so the sandboxed, cookieless preview can navigate).
// ---------------------------------------------------------------------------
describe('preview-site API (signed path)', () => {
  let app: FastifyInstance;
  let db: Database;
  let previewRoot: string;

  beforeEach(async () => {
    previewRoot = await mkdtemp(join(tmpdir(), 'sw-preview-'));
    db = await makeTestDb();
    app = await createApp({ db, previewRoot, cookieSecret: 'preview-test-secret' });
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
    // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
    // register route is invite-only, so seed via the repo, then log in for a session cookie.
    await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
    const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
    const proj = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    return { t, projectId, slug };
  }
  const putPage = (base: string, cookies: Record<string, string>, page: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `${base}/content/page/${page.id}`, cookies, payload: page });
  // Mint the signed preview base (member-only) → `/preview-site/<id>/<sig>/`.
  async function signedBase(projectId: string, t: string): Promise<string> {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/preview-url`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { base: string }).base;
  }

  it('serves the live preview at the signed path (sandboxed, runtime injected, NO cookie), drafts included', async () => {
    const { t, projectId } = await setup('p@acme.test');
    const api = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(api, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Home Live</h1>' });
    await putPage(api, cookies, { id: 'wip', path: 'wip', title: 'WIP', status: 'draft', source: '<h1>Draft WIP</h1>' });
    const pbase = await signedBase(projectId, t);
    expect(pbase.startsWith(`/preview-site/${projectId}/`)).toBe(true);
    expect(pbase).toMatch(/^\/preview-site\/[^/]+\/[A-Za-z0-9_-]+\/$/);

    // The draft is served at the signed path with NO session cookie (the sig is the auth).
    const res = await app.inject({ method: 'GET', url: pbase });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cache-control']).toContain('no-store');
    // The signed (bearer) URL must not leak via the Referer header to third-party outbound links.
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.body).toContain('Home Live');
    expect(res.body).toContain('sitewright-preview-site');

    // A DRAFT page is browsable (a published build would 404 it) — relative nav carries the sig.
    const draft = await app.inject({ method: 'GET', url: `${pbase}wip/` });
    expect(draft.statusCode).toBe(200);
    expect(draft.body).toContain('Draft WIP');
  });

  it('a tampered or missing signature is a 404', async () => {
    const { t, projectId } = await setup('tm@acme.test');
    await putPage(`/projects/${projectId}`, { sw_session: t }, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    const bad = await app.inject({ method: 'GET', url: `/preview-site/${projectId}/not-the-real-sig/` });
    expect(bad.statusCode).toBe(404);
  });

  it('rebuilds on the next request after content changes', async () => {
    const { t, projectId } = await setup('rb@acme.test');
    const api = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(api, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Version ONE</h1>' });
    const pbase = await signedBase(projectId, t);
    const v1 = await app.inject({ method: 'GET', url: pbase });
    expect(v1.body).toContain('Version ONE');

    await new Promise((r) => setTimeout(r, 10));
    await putPage(api, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Version TWO</h1>' });
    const v2 = await app.inject({ method: 'GET', url: pbase });
    expect(v2.body).toContain('Version TWO');
    expect(v2.body).not.toContain('Version ONE');
  });

  it('canonicalizes an extensionless, slash-less page URL with a 301 (under the signed base)', async () => {
    const { t, projectId } = await setup('rd@acme.test');
    const api = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(api, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    await putPage(api, cookies, { id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>' });
    const pbase = await signedBase(projectId, t);
    const res = await app.inject({ method: 'GET', url: `${pbase}about` });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe(`${pbase}about/`);
  });

  it('serves static assets cross-origin under the signed base', async () => {
    const { t, projectId } = await setup('as@acme.test');
    const api = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(api, cookies, { id: 'home', path: '', title: 'Home', source: '<div class="grid"><h1>Hi</h1></div>' });
    const pbase = await signedBase(projectId, t);
    await app.inject({ method: 'GET', url: pbase }); // build it (styles.css now on disk)

    const css = await app.inject({ method: 'GET', url: `${pbase}styles.css` });
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toContain('text/css');
    expect(css.headers['access-control-allow-origin']).toBe('*');
    expect(css.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('runs an imported .js for the sandboxed (cross-site) frame, but keeps it download-only same-origin', async () => {
    const { t, projectId, slug } = await setup('js@acme.test');
    const api = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(api, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    const pbase = await signedBase(projectId, t);
    await app.inject({ method: 'GET', url: pbase }); // build the site so its dir exists on disk
    // Drop a bundled (imported) script into the built tree — mirrors `_assets/<id>/file/<name>.js`.
    const jsDir = join(previewRoot, slug, '_assets', 'imp', 'file');
    await mkdir(jsDir, { recursive: true });
    await writeFile(join(jsDir, 'app.js'), 'window.__SW_IMPORTED__=1;');
    const url = `${pbase}_assets/imp/file/app.js`;

    // The opaque-origin sandbox loads it as a cross-site script subresource → runnable text/javascript.
    const exec = await app.inject({
      method: 'GET',
      url,
      headers: { 'sec-fetch-dest': 'script', 'sec-fetch-site': 'cross-site' },
    });
    expect(exec.statusCode).toBe(200);
    expect(exec.headers['content-type']).toContain('text/javascript');
    expect(exec.headers['content-disposition']).toBeUndefined();
    expect(exec.headers['access-control-allow-origin']).toBe('*');

    // A same-origin loader — a `/sites/<slug>/` page on this host embedding the signed URL — must NOT
    // get an executable script (CSP there allows `script-src 'self'`): it stays download-only + inert.
    const sameOrigin = await app.inject({
      method: 'GET',
      url,
      headers: { 'sec-fetch-dest': 'script', 'sec-fetch-site': 'same-origin' },
    });
    expect(sameOrigin.statusCode).toBe(200);
    expect(sameOrigin.headers['content-type']).toContain('application/octet-stream');
    expect(sameOrigin.headers['content-disposition']).toContain('attachment');

    // A same-SITE loader — a locally-hosted site at `<slug>.<sitesDomain>` (same registrable domain,
    // different origin) — is also blocked. The gate is a whitelist (=== 'cross-site'), so this pins
    // that `same-site` keeps the download-only default and a future refactor can't regress it.
    const sameSite = await app.inject({
      method: 'GET',
      url,
      headers: { 'sec-fetch-dest': 'script', 'sec-fetch-site': 'same-site' },
    });
    expect(sameSite.statusCode).toBe(200);
    expect(sameSite.headers['content-type']).toContain('application/octet-stream');
    expect(sameSite.headers['content-disposition']).toContain('attachment');

    // No Fetch-Metadata headers (old/non-browser client) → download-only (default-deny).
    const bare = await app.inject({ method: 'GET', url });
    expect(bare.statusCode).toBe(200);
    expect(bare.headers['content-type']).toContain('application/octet-stream');
    expect(bare.headers['content-disposition']).toContain('attachment');

    // A non-script destination, even cross-site, stays download-only (only <script> loads execute).
    const notScript = await app.inject({
      method: 'GET',
      url,
      headers: { 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'cross-site' },
    });
    expect(notScript.statusCode).toBe(200);
    expect(notScript.headers['content-type']).toContain('application/octet-stream');
    expect(notScript.headers['content-disposition']).toContain('attachment');
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
    const cookies = { sw_session: t };
    await putPage(`/projects/${projectId}`, cookies, { id: 'home', path: '', title: 'Home', source: '{{#each items}}' });
    const pbase = await signedBase(projectId, t);
    const res = await app.inject({ method: 'GET', url: pbase });
    expect(res.statusCode).toBe(404);
    const retry = await app.inject({ method: 'GET', url: pbase });
    expect(retry.statusCode).toBe(404);
  });

  it('agent-presence returns a connected count (0 with no agents)', async () => {
    const { t, projectId } = await setup('ap@acme.test');
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/agent-presence`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: 0 });
  });

  it('minting the signed base requires authentication + tenant membership', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    const unauth = await app.inject({ method: 'GET', url: `/projects/${a.projectId}/preview-url` });
    expect(unauth.statusCode).toBe(401);
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/preview-url`,
      cookies: { sw_session: b.t },
    });
    expect(crossTenant.statusCode).toBe(403);
    // ...and another member CANNOT forge a valid signature for a's project.
    const aBase = await signedBase(a.projectId, a.t);
    const sig = aBase.split('/')[3];
    const forged = await app.inject({ method: 'GET', url: `/preview-site/${b.projectId}/${sig}/` });
    expect(forged.statusCode).toBe(404);
  });
});
