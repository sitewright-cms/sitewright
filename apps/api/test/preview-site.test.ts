import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { buildSite } from '../src/publish/build.js';

// ---------------------------------------------------------------------------
// buildSite preview-mode options (previewRuntime + progress), and the draft-page exclusion that
// applies to EVERY build, tested directly.
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

  it('a draft page is excluded from the PUBLISHED build', async () => {
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle(pages) });
    await expect(readFile(join(outDir, 'secret/index.html'), 'utf8')).rejects.toThrow();
    // The published home is still there.
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('Home');
  });

  it('…and from the DRAFT PREVIEW build too — the preview browses the site publish would produce', async () => {
    // ★ THE BUG THIS EXISTS FOR: the preview used to pass the unfiltered page list, so a draft got a
    // route here. That made the preview disagree with the site it previews — see the nav/sitemap/search
    // assertions below, which are the surfaces the leak actually showed up on.
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      previewRuntime: 'window.__SW_PREVIEW__=1;',
      bundle: bundle(pages),
    });
    await expect(readFile(join(outDir, 'secret/index.html'), 'utf8')).rejects.toThrow();
    // The preview itself is otherwise intact: the published page renders, with the bridge injected.
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('Home');
    expect(home).toContain('window.__SW_PREVIEW__=1;');
  });

  it('a draft never reaches the preview nav, its sitemap, or its search index', async () => {
    // The route is only the first surface. A draft that keeps a menu entry, a sitemap line (absolute,
    // at the PRODUCTION host) or a search hit is still advertising a page that will not be there.
    const navPages = [
      {
        id: 'home',
        path: '',
        title: 'Home',
        // `{{sw-url …}}`, not a bare `{{this.path}}` — a bare value in an href is rejected as unsafe,
        // and in PREVIEW mode that failure is not an exception but an error DOCUMENT served in the
        // page's place. Every "the draft is not in the menu" assertion below would then pass against a
        // page that has no menu at all, which is the false green this note exists to prevent (see the
        // no-failures assertion immediately after the build).
        source:
          '<h1>Home</h1>{{#each nav.header}}<a href="{{sw-url this.path}}">{{this.label}}</a>{{/each}}' +
          '<div data-sw-component="search"></div>',
        nav: { slots: ['header'] },
      },
      {
        id: 'sec',
        path: 'secret',
        title: 'Secret',
        status: 'draft',
        source: '<h1>Secret Draft</h1>',
        nav: { slots: ['header'] },
      },
    ] as unknown as ProjectBundle['pages'];
    const withUrl = bundle(navPages);
    (withUrl.project as { website?: unknown }).website = { siteUrl: 'https://acme.test' };

    const manifest = await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      previewRuntime: 'window.__SW_PREVIEW__=1;',
      bundle: withUrl,
    });
    // ★ The guard: a page served as an error document proves nothing about menus.
    expect(manifest.pageFailures).toBeUndefined();

    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    // The menu really was rendered — the draft's absence below is a filter, not an empty loop.
    expect(home).toContain('>Home<');
    expect(home).not.toContain('>Secret<'); // no menu entry
    expect(home).not.toContain('/secret/'); // …and no link to it anywhere in the chrome

    const sitemap = await readFile(join(outDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('https://acme.test/');
    expect(sitemap).not.toContain('secret');

    const index = await readFile(join(outDir, 'search-index.json'), 'utf8');
    expect(index).not.toContain('Secret');
    // The index is real (the published page IS in it), so the line above is not an empty-file pass.
    expect(index).toContain('Home');
  });

  it('a page that cannot render fails the PUBLISH, but only ITSELF in the preview', async () => {
    // ★ THE BUG THIS EXISTS FOR: one dangling reference used to abort the whole draft build, so every
    // page of the project kept serving its last good output — with a 200 and no signal anywhere. An
    // author edited and watched nothing change.
    const broken = [
      { id: 'home', path: '', title: 'Home', source: '<h1>Home</h1>' },
      { id: 'bad', path: 'bad', title: 'Bad', source: '{{sw-imagemap "does-not-exist"}}' },
      { id: 'last', path: 'last', title: 'Last', source: '<h1>Last</h1>' },
    ] as unknown as ProjectBundle['pages'];

    // PUBLISH: fatal, and the error names the page.
    await expect(
      buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle(broken) }),
    ).rejects.toThrow(/page "bad"/);

    // PREVIEW: every other page is CURRENT, and the broken one serves an error document in its place.
    const manifest = await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      previewRuntime: 'window.__SW_PREVIEW__=1;',
      bundle: bundle(broken),
    });
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('Home');
    // …including the pages AFTER the broken one — an abort stopped at the first failure.
    expect(await readFile(join(outDir, 'last/index.html'), 'utf8')).toContain('Last');
    const bad = await readFile(join(outDir, 'bad/index.html'), 'utf8');
    expect(bad).toContain('This page could not be rendered');
    expect(bad).toContain('does-not-exist');
    expect(manifest.pageFailures).toEqual([
      { page: 'bad', path: '/bad', message: expect.stringContaining('does-not-exist') },
    ]);
  }, 30_000);

  it('reports its PHASES to a waiting caller, in order, with a page count', async () => {
    // The draft preview blocks the shell for the whole build, so this is the only channel the shell
    // has for saying what the wait is. Order matters — the pill reads the latest phase.
    const seen: Array<{ phase: string; done?: number; total?: number }> = [];
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle(pages),
      onProgress: (p) => seen.push(p),
    });
    const phases = seen.map((p) => p.phase);
    expect(phases[0]).toBe('preparing');
    expect(phases).toContain('pages');
    expect(phases).toContain('finalizing');
    expect(phases.indexOf('pages')).toBeLessThan(phases.indexOf('finalizing'));
    // Every page announces itself before it renders, counting from 0 against a real total.
    const pageSteps = seen.filter((p) => p.phase === 'pages');
    expect(pageSteps.length).toBeGreaterThan(0);
    expect(pageSteps[0]).toMatchObject({ done: 0, total: pageSteps[0]!.total });
    expect(pageSteps[0]!.total).toBeGreaterThan(0);
  });

  it('a throwing progress reporter cannot fail the build', async () => {
    // Progress is a courtesy to a spinner. A build that is otherwise fine must not die because the
    // thing narrating it did.
    const manifest = await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle(pages),
      onProgress: () => {
        throw new Error('reporter exploded');
      },
    });
    expect(manifest.routes).toBeGreaterThan(0);
  });

  it('a clean build reports no page failures at all', async () => {
    const manifest = await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      previewRuntime: 'window.__SW_PREVIEW__=1;',
      bundle: bundle(pages),
    });
    expect(manifest.pageFailures).toBeUndefined();
  });

  it('escapes the error it reports — the message carries authored text', async () => {
    const evil = [
      { id: 'x', path: '', title: 'X', source: '{{sw-imagemap "</pre><script>alert(1)</script>"}}' },
    ] as unknown as ProjectBundle['pages'];
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      previewRuntime: 'window.__SW_PREVIEW__=1;',
      bundle: bundle(evil),
    });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
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

  it('an embed page bakes script-src with unsafe-inline so owner + preview-runtime inline JS runs (no hash)', async () => {
    // A cross-origin author <iframe> (e.g. a Maps embed) ships an inert `<meta name="sw-csp">`. Its script-src now
    // carries `'unsafe-inline'` so the OWNER's authored inline JS runs on the isolated published origins,
    // and the sandboxed preview runtime runs too. We deliberately DON'T add a per-runtime sha256 hash: a
    // hash makes `'unsafe-inline'` be IGNORED (blocking author scripts). So the meta is now IDENTICAL
    // between the preview and the published build.
    const embedPage = [
      { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1><iframe src="https://www.google.com/maps/embed?pb=1" title="map"></iframe>' },
    ] as unknown as ProjectBundle['pages'];
    // The meta `content` is attribute-escaped (`'` → `&#39;`); decode it back to inspect directives.
    const metaCsp = (html: string): string | null => {
      const m = html.match(/name="sw-csp" content="([^"]*)"/);
      return m ? m[1]!.replace(/&#39;/g, "'") : null;
    };
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, previewRuntime: PREVIEW_SITE_RUNTIME_JS, bundle: bundle(embedPage) });
    const preview = metaCsp(await readFile(join(outDir, 'index.html'), 'utf8'));
    expect(preview, 'preview page must bake a consent meta CSP for the embed').not.toBeNull();
    const scriptSrc = preview!.split('; ').find((d) => d.split(' ')[0] === 'script-src')!;
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'"); // author + runtime inline JS; no hash
    expect(preview!).not.toContain('sha256-');
    expect(preview!).toContain("frame-src 'self' https://www.google.com"); // embed origin preserved

    // Published build (no previewRuntime) → BYTE-IDENTICAL meta now (no preview-only hash to differ).
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle(embedPage) });
    const published = metaCsp(await readFile(join(outDir, 'index.html'), 'utf8'))!;
    expect(published).toBe(preview!);
  });

  it('the inlined preview runtime neutralizes a </script in its bytes (no early tag close)', async () => {
    // renderDocument neutralizes `</script` → `<\/script` when it inlines a script, so a runtime carrying
    // that sequence can't close its own <script> tag early. (No CSP hash is involved anymore — the runtime
    // runs via the meta's `'unsafe-inline'`.)
    const runtime = 'window.__x="</script>";';
    const embedPage = [
      { id: 'home', path: '', title: 'Home', source: '<iframe src="https://www.google.com/maps/embed?pb=1" title="map"></iframe>' },
    ] as unknown as ProjectBundle['pages'];
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, previewRuntime: runtime, bundle: bundle(embedPage) });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('window.__x="<\\/script>"'); // emitted bytes are neutralized
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

  it('serves the live preview at the signed path (sandboxed, runtime injected, NO cookie)', async () => {
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

    // A DRAFT page is NOT part of this site — the preview browses what publish would produce.
    const draft = await app.inject({ method: 'GET', url: `${pbase}wip/` });
    expect(draft.statusCode).toBe(404);
    expect(draft.body).not.toContain('Draft WIP');
  });

  it('a draft page answers with a NOTICE, not the blank 404 a missing file gets', async () => {
    // ★ A bare 404 here is indistinguishable from a broken build, a stale build, or a typo'd URL — and
    // the author reading it is looking at the preview pane of the very page they just marked draft. The
    // route says which of those it is, and where to go to see the page anyway.
    const { t, projectId } = await setup('n@acme.test', 'notice');
    const api = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(api, cookies, {
      id: 'home',
      path: '',
      title: 'Home',
      source: '<h1>Home</h1>{{#each nav.header}}<a href="{{sw-url this.path}}">{{this.label}}</a>{{/each}}',
      nav: { slots: ['header'] },
    });
    // In the header slot — the symptom this whole change is about: a draft that keeps its menu entry.
    await putPage(api, cookies, {
      id: 'wip',
      path: 'wip',
      title: 'Secret Launch',
      status: 'draft',
      source: '<h1>WIP</h1>',
      nav: { slots: ['header'] },
    });
    const pbase = await signedBase(projectId, t);

    // The SERVED menu lists the published page and nothing else — checked over HTTP, not just in the
    // build output, because that is where it was seen.
    const served = await app.inject({ method: 'GET', url: pbase });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain('>Home<');
    expect(served.body).not.toContain('Secret Launch');
    expect(served.body).not.toContain('wip/');

    const draft = await app.inject({ method: 'GET', url: `${pbase}wip/` });
    expect(draft.statusCode).toBe(404); // the page really is not here — the status stays honest
    expect(draft.headers['content-type']).toContain('text/html');
    expect(draft.body).toContain('is a draft');
    expect(draft.body).toContain('Secret Launch'); // names the page, so there is no guessing which one
    expect(draft.body).toContain('Preview'); // …and names the way to see it anyway
    // The notice is inert: it must not leak the draft's own markup, which is what publishing would ship.
    expect(draft.body).not.toContain('<h1>WIP</h1>');
    // Still sandboxed AND framed like any preview document — it has to render inside the editor's
    // preview pane, and must not be framable from anywhere else (it names a draft page).
    expect(draft.headers['content-security-policy']).toContain('sandbox');
    expect(draft.headers['x-frame-options']).toBe('SAMEORIGIN');

    // A path no page owns keeps the blank 404: there is nothing to explain.
    const gone = await app.inject({ method: 'GET', url: `${pbase}no-such-page/` });
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toBe('');
  });

  it('serves a platform RUNTIME from _assets/_sw/ — executable, not a download', async () => {
    // ★★ THE SAME REGRESSION A FOURTH TIME IF THIS IS MISSING. `site.webmanifest`, the search index and
    // the data files each shipped 404ing on the DRAFT PREVIEW alone — local hosting has no allowlist, so
    // each worked on a published site and was silently inert here. Moving the runtimes into `_assets/`
    // adds a second way to get it wrong: that tree's `.js` rule serves IMPORTED scripts download-only on
    // the app origin, and claiming ours under it would leave every component dead with a 200 response.
    const { t, projectId } = await setup('rt@acme.test');
    await putPage(`/projects/${projectId}`, { sw_session: t }, {
      id: 'home', path: '', title: 'Home',
      source: '<section data-bg="/media/hero.jpg" class="h-64">Hero</section>',
    });
    const pbase = await signedBase(projectId, t);
    const page = await app.inject({ method: 'GET', url: pbase });
    expect(page.statusCode).toBe(200);
    // The page links it from the reserved directory…
    expect(page.body).toContain('_assets/_sw/lazyload.js');
    // …and the preview actually serves it, as RUNNABLE javascript with no attachment disposition.
    const js = await app.inject({ method: 'GET', url: `${pbase}_assets/_sw/lazyload.js` });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.headers['content-disposition']).toBeUndefined();
    expect(js.body).toContain('IntersectionObserver');
  });

  it('a tampered or missing signature is a 404', async () => {
    const { t, projectId } = await setup('tm@acme.test');
    await putPage(`/projects/${projectId}`, { sw_session: t }, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    const bad = await app.inject({ method: 'GET', url: `/preview-site/${projectId}/not-the-real-sig/` });
    expect(bad.statusCode).toBe(404);
  });

  it('revocable share links: create → list → serve the draft to an UNAUTHENTICATED client → revoke (404)', async () => {
    const { t, projectId } = await setup('sh@acme.test');
    const cookies = { sw_session: t };
    await putPage(`/projects/${projectId}`, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Shared Draft</h1>' });

    // CREATE a stable share link (owner, content:write).
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview-shares`,
      cookies,
      payload: { label: 'Client review' },
    });
    expect(created.statusCode).toBe(200);
    const share = created.json() as { id: string; label: string; createdAt: number; url: string };
    expect(share.label).toBe('Client review');
    expect(share.url.startsWith(`/preview-site/${projectId}/`)).toBe(true);
    expect(share.url).toContain('~'); // signShare token shape: <shareId>~<hmac>

    // A SECOND share so the list has >1 row (exercises the newest-first sort comparator).
    const created2 = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview-shares`,
      cookies,
      payload: { label: 'Second reviewer' },
    });
    expect(created2.statusCode).toBe(200);
    const share2 = created2.json() as { id: string; url: string };

    // LIST reflects both.
    const listed = await app.inject({ method: 'GET', url: `/projects/${projectId}/preview-shares`, cookies });
    expect(listed.statusCode).toBe(200);
    const items = (listed.json() as { items: Array<{ id: string; label: string; url: string }> }).items;
    expect(items.map((i) => i.id).sort()).toEqual([share.id, share2.id].sort());

    // SERVE the draft at the share URL with NO session cookie — the (non-revoked) share token is the auth.
    const served = await app.inject({ method: 'GET', url: share.url });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain('Shared Draft');
    expect(served.headers['content-security-policy']).toContain('sandbox');

    // REVOKE is IDEMPOTENT: deleting an unknown id is a clean 200 (the remove NotFoundError is swallowed).
    const delMissing = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/preview-shares/does-not-exist`, cookies });
    expect(delMissing.statusCode).toBe(200);
    expect(delMissing.json()).toEqual({ ok: true });

    // REVOKE share #1 → its URL now fails closed (404); share #2 still serves.
    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/preview-shares/${share.id}`, cookies });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: share.url })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: share2.url })).statusCode).toBe(200);
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

    const css = await app.inject({ method: 'GET', url: `${pbase}_assets/_sw/styles.css` });
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

    // A DRAFT is routeless on this surface, so the shell must not navigate the iframe onto it — it
    // would land on the draft notice (a 404) instead of the page an agent just edited. `null` means
    // "reload where you are", which is the right move for a change the preview cannot show.
    await putPage(base, cookies, { id: 'wip', path: 'wip', title: 'WIP', status: 'draft', source: '<h1>W</h1>' });
    const wip = await app.inject({ method: 'GET', url: `${base}/preview-locate?entity=wip`, cookies });
    expect(wip.json()).toEqual({ path: null });
    // …and the published sibling still resolves, so this is a targeted exclusion.
    const still = await app.inject({ method: 'GET', url: `${base}/preview-locate?entity=about`, cookies });
    expect(still.json()).toEqual({ path: 'about' });
  });

  it('preview-progress answers WITHOUT blocking on the build, and reports nothing in flight once idle', async () => {
    const { t, projectId } = await setup('pg@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });

    // Before any build has been asked for, nothing is in flight — and crucially this returns rather
    // than waiting, which is the entire reason it is a separate endpoint from /preview-url.
    const idle = await app.inject({ method: 'GET', url: `${base}/preview-progress`, cookies });
    expect(idle.statusCode).toBe(200);
    expect(idle.json()).toEqual({ building: false });

    // After the build has been driven to completion, it is idle again — the entry is cleared when the
    // build settles, so a shell that keeps polling is told to stop narrating.
    await app.inject({ method: 'GET', url: `${base}/preview-url`, cookies });
    expect((await app.inject({ method: 'GET', url: `${base}/preview-progress`, cookies })).json()).toEqual({
      building: false,
    });
  });

  it('preview-progress is tenant-scoped like every other project read', async () => {
    const { projectId } = await setup('own@acme.test');
    const other = await setup('int@acme.test', 'intruder-site');
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/preview-progress`,
      cookies: { sw_session: other.t },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a broken page SERVES its error, and the pages around it stay current', async () => {
    // ★ This used to 404 the broken page and, worse, leave every OTHER page of the project on its
    // last good build — silently, with a 200. The build now isolates the failure to its own route.
    const { t, projectId } = await setup('bk@acme.test');
    const cookies = { sw_session: t };
    const base = `/projects/${projectId}`;
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Home v1</h1>' });
    await putPage(base, cookies, { id: 'bad', path: 'bad', title: 'Bad', source: '{{#each items}}' });
    const pbase = await signedBase(projectId, t);

    const broken = await app.inject({ method: 'GET', url: `${pbase}bad/` });
    expect(broken.statusCode).toBe(200);
    expect(broken.body).toContain('This page could not be rendered');

    // The healthy page rebuilds — the whole point. Edit it and the preview shows the edit.
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>Home v2</h1>' });
    const home = await app.inject({ method: 'GET', url: pbase });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Home v2');
  });

  it('a DELETED page leaves the preview — a delete moves the build version too', async () => {
    // ★ The draft rebuilt on "newest content updatedAt", which a DELETE cannot move: the row is gone,
    // so the maximum stays wherever it already was and no rebuild is triggered. Measured on a live
    // instance: a page deleted a minute earlier still served 200 with its old content.
    const { t, projectId } = await setup('del@acme.test');
    const cookies = { sw_session: t };
    const base = `/projects/${projectId}`;
    await putPage(base, cookies, { id: 'gone', path: 'gone', title: 'Gone', source: '<h1>Delete me</h1>' });
    // …then touch ANOTHER page, so the doomed one is no longer the newest row. That is the case the
    // old version string could not see: deleting it leaves `max(updated_at)` exactly where it is.
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    const pbase = await signedBase(projectId, t);
    expect((await app.inject({ method: 'GET', url: `${pbase}gone/` })).statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `${base}/content/page/gone`, cookies });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `${pbase}gone/` })).statusCode).toBe(404);
    // …and the rest of the site is still there.
    expect((await app.inject({ method: 'GET', url: pbase })).body).toContain('H');
  });

  it('preview-url reports which pages failed, so the editor can say so off the broken page', async () => {
    const { t, projectId } = await setup('bkr@acme.test');
    const cookies = { sw_session: t };
    const base = `/projects/${projectId}`;
    await putPage(base, cookies, { id: 'home', path: '', title: 'Home', source: '<h1>H</h1>' });
    await putPage(base, cookies, { id: 'bad', path: 'bad', title: 'Bad', source: '{{#each items}}' });

    const res = await app.inject({ method: 'GET', url: `${base}/preview-url`, cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { base: string; pageFailures: Array<{ page: string; path: string }> };
    expect(body.base).toContain('/preview-site/');
    expect(body.pageFailures.map((f) => f.page)).toEqual(['bad']);
    expect(body.pageFailures[0]!.path).toBe('/bad');

    // …and it CLEARS once the page renders again, or the banner would outlive the problem.
    await putPage(base, cookies, { id: 'bad', path: 'bad', title: 'Bad', source: '<h1>Fixed</h1>' });
    const after = await app.inject({ method: 'GET', url: `${base}/preview-url`, cookies });
    expect((after.json() as { pageFailures: unknown[] }).pageFailures).toEqual([]);
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
