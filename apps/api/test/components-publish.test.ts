import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

// Code-first preview renders the source in an isolated worker pool — give the harness one (the
// publish path renders synchronously and ignores it). The worker is the test blocks-render fixture.
const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

// Regression: interactive component JS (modal / tabs / carousel / lightbox / cookie-consent / form)
// and the <dialog>/anchor runtime must ship for CODE-FIRST pages. Code-first pages render from a
// Handlebars `source` and have an EMPTY block tree, so detection that only walks the tree never saw
// their `data-sw-component="…"` markers or authored `<dialog>` — the runtime was silently missing and
// modals/triggers did nothing. Detection now also scans the rendered source / slots / snippets, the
// same only-used-ships discipline as animations/lazyload/ripple. `data-sw-component`/`data-sw-part`
// survive the publish directive-strip (only data-sw-text/html/href/src/bg are removed).

describe('interactive component + dialog runtimes → code-first publish + preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-comp-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-comp-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  // A code-first page authoring the modal component (its trigger button + native <dialog>).
  const modalSource =
    '<section>' +
    '<div data-sw-component="modal">' +
    '<button data-sw-part="open" class="btn">Open</button>' +
    '<dialog data-sw-part="dialog" class="modal"><p>Hello</p>' +
    '<button data-sw-part="close" class="btn">x</button></dialog>' +
    '</div></section>';

  it('ships the component runtime AND the dialog runtime for a code-first modal (empty block tree)', async () => {
    const proj = client.project(projectId);
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: modalSource };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    // The component markers survive the directive-strip, so the shipped JS selectors match.
    expect(index.body).toContain('data-sw-component="modal"');
    expect(index.body).toContain('data-sw-part="open"');
    // Both runtimes are linked.
    expect(index.body).toContain('<script defer src="components.js"></script>');
    expect(index.body).toContain('<script defer src="nav-link.js"></script>');

    // components.js carries the modal behavior; nav-link.js carries the general dialog/anchor handler.
    const comp = await client.get(`/sites/${slug}/components.js`);
    expect(comp.statusCode).toBe(200);
    expect(comp.body).toContain('[data-sw-component="modal"]');
    expect(comp.body).toContain('showModal');
    const navLink = await client.get(`/sites/${slug}/nav-link.js`);
    expect(navLink.statusCode).toBe(200);
    expect(navLink.body).toContain('scrollIntoView'); // unique to NAV_LINK_JS
  });

  it('ships the Notice runtime for a code-first page that authors a dismissible notice', async () => {
    const proj = client.project(projectId);
    const source =
      '<section><div data-sw-component="notice" data-sw-notice-id="promo" data-frequency="once" data-position="bottom-right" hidden>' +
      '<p>Latest product</p>' +
      '<button data-sw-part="dismiss-forever" class="btn btn-sm">No thanks</button>' +
      '</div></section>';
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    // The notice markers survive the directive-strip + the notice ships hidden (PE-safe).
    expect(index.body).toContain('data-sw-component="notice"');
    expect(index.body).toContain('data-sw-part="dismiss-forever"');
    expect(index.body).toContain('hidden');
    expect(index.body).toContain('<script defer src="components.js"></script>');

    // components.js carries the Notice runtime (its per-notice storage namespace) + CSS.
    const comp = await client.get(`/sites/${slug}/components.js`);
    expect(comp.statusCode).toBe(200);
    expect(comp.body).toContain("'sw-notice:'");
    expect(comp.body).toContain('data-sw-component="notice"');
  });

  it('ships the Consent Manager runtime for a site with {{sw-consent}} in the bottom slot (enabled)', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { consent: { enabled: true }, bottom: '{{sw-consent}}{{sw-consent-settings}}' },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Home</h1></section>' };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    // The helper rendered the mount + the escaped config; the re-open button carries the open marker.
    expect(index.body).toContain('data-sw-consent');
    expect(index.body).toContain('data-sw-consent-config');
    expect(index.body).toContain('data-sw-consent-open');
    expect(index.body).toContain('<script defer src="consent.js"></script>');

    const js = await client.get(`/sites/${slug}/consent.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('sw:consentchange');
    expect(js.body).toContain('window.swConsent');
  });

  it('ships NO consent runtime for a site that uses no consent banner', async () => {
    const proj = client.project(projectId);
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Plain</h1></section>' };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).not.toContain('consent.js');
    expect((await client.get(`/sites/${slug}/consent.js`)).statusCode).toBe(404);
  });

  it('widens the per-site CSP (response header + baked meta) for a consent site with a GA integration', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: {
            consent: { enabled: true, integrations: [{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-ABC123' }] },
            bottom: '{{sw-consent}}',
          },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Home</h1></section>' };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    // (a) the RESPONSE-HEADER CSP is widened to EXACTLY the GA origins (script + connect), strict elsewhere.
    const csp = index.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com");
    expect(csp).toContain('https://www.google-analytics.com'); // connect-src
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.split('; ').find((d) => d.startsWith('script-src'))).not.toContain("'unsafe-inline'");
    // (b) the baked <meta> CSP gives static-export parity (same allow-list, minus frame-ancestors).
    expect(index.body).toContain('http-equiv="Content-Security-Policy"');
    expect(index.body).toContain('https://www.googletagmanager.com');
    // (c) the consent config bakes the ga4 runtime descriptor for the runtime to inject on consent.
    expect(index.body).toContain('data-sw-consent-config');
    expect(index.body).toContain('ga4');
  });

  it('does NOT widen the CSP for a consent site with NO integrations (strict default stays)', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { consent: { enabled: true }, bottom: '{{sw-consent}}' },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Home</h1></section>' };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    const csp = index.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'"); // the strict onSend default
    expect(csp).not.toContain('googletagmanager'); // no widening
    expect(index.body).not.toContain('http-equiv="Content-Security-Policy"'); // no baked meta
  });

  it('ships ONLY the dialog runtime when a code-first page authors a bare <dialog> (no component, no placeholder)', async () => {
    const proj = client.project(projectId);
    // A global modal opened from an in-content anchor — no nav placeholder, no component wrapper.
    const source = '<section><a href="#promo" class="btn">See offer</a>' +
      '<dialog id="promo" class="modal"><div class="modal-box"><p>50% off</p>' +
      '<form method="dialog"><button class="btn">Close</button></form></div></dialog></section>';
    const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('<script defer src="nav-link.js"></script>');
    expect((await client.get(`/sites/${slug}/nav-link.js`)).statusCode).toBe(200);
    // No component marker → components.js is NOT shipped.
    expect(index.body).not.toContain('components.js');
    expect((await client.get(`/sites/${slug}/components.js`)).statusCode).toBe(404);
  });

  it('ships the dialog runtime when a GLOBAL modal lives in the bottom skeleton slot', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { bottom: '<dialog id="newsletter" class="modal"><p>Subscribe</p></dialog>' },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><a href="#newsletter">Subscribe</a></section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('<dialog id="newsletter"');
    expect(index.body).toContain('<script defer src="nav-link.js"></script>');
  });

  it('ships NOTHING extra for a plain code-first page (no component, no dialog)', async () => {
    const proj = client.project(projectId);
    const home = {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1>Plain</h1></section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).not.toContain('components.js');
    expect(index.body).not.toContain('nav-link.js');
    expect((await client.get(`/sites/${slug}/components.js`)).statusCode).toBe(404);
    expect((await client.get(`/sites/${slug}/nav-link.js`)).statusCode).toBe(404);
  });

  it('inlines the component + dialog runtimes into the sandboxed CODE-FIRST preview (WYSIWYG parity)', async () => {
    const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: modalSource };
    const res = await client.post(`/projects/${projectId}/preview`, page);
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    // Self-contained preview: component assets + dialog runtime are INLINED (no external <script src>).
    expect(html).toContain('dialog[data-sw-component="modal"]'); // MODAL component CSS inlined (keys on the marker)
    expect(html).toContain('[data-sw-component="modal"]'); // MODAL component JS selector inlined
    expect(html).toContain('showModal'); // NAV_LINK_JS inlined (a <dialog> is present) — unique to it
    expect(html).not.toContain('src="components.js"');
    expect(html).not.toContain('src="nav-link.js"');
  });

  it('keeps the code-first preview clean for a page with no component or dialog', async () => {
    const page = {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1>Plain</h1></section>',
    };
    const res = await client.post(`/projects/${projectId}/preview`, page);
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).not.toContain('[data-sw-component="modal"]');
    // NAV_LINK_JS marker (its showModal) — NOT the bridge's own scrollIntoView, which is always present.
    expect(html).not.toContain('showModal');
  });
});
