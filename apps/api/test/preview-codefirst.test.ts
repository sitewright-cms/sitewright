import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';
import { formApiBlob } from './helpers.js';

// Code-first preview (POST /projects/:id/preview) renders the page `source` in the worker pool and
// wraps it in the sandboxed document shell. These cover the branches the deleted block-tree preview
// tests used to hit: a template-referencing page, a page that loops `page.children`, a source-less
// page (empty body), and a render error → 400.
const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

describe('code-first preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-pcf-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-pcf-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const previewHtml = async (page: unknown): Promise<string> => {
    const res = await client.post(`/projects/${projectId}/preview`, page);
    expect(res.statusCode).toBe(200);
    return (res.json() as { html: string }).html;
  };

  it('renders a code-first page source into the sandboxed shell, substituting {{ company.* }}', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1>{{ company.name }}</h1></section>',
    });
    expect(html).toContain('<main id="page-content"><section><h1>Site</h1></section></main>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('renders a page from its referenced TEMPLATE source (the page contributes only its data)', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('template', 'base', {
      id: 'base', name: 'Base', source: '<section><h1>{{ page.title }} — templated</h1></section>',
    })).statusCode).toBe(200);
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, template: 'base',
    });
    expect(html).toContain('Home — templated');
  });

  it('loops the previewed page’s child pages via {{#each page.children}}', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1>Home</h1></section>',
    })).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', {
      id: 'about', path: 'about', parent: 'home', title: 'About', root: { id: 'r2', type: 'Section' },
      source: '<section>About</section>', nav: { slots: ['header'] },
    })).statusCode).toBe(200);
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><ul>{{#each page.children}}<li>{{this.title}}</li>{{/each}}</ul></section>',
    });
    expect(html).toContain('<li>About</li>');
  });

  it('renders a source-less page as an empty body (no crash)', async () => {
    const html = await previewHtml({ id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } });
    expect(html).toContain('<main id="page-content"></main>');
  });

  it('inlines the animation / lazyload / ripple runtimes (and cart CSS) for their code-first markers', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><div data-sw-animation="fade-up" class="waves-effect" data-bg="/hero.jpg" data-sw-cart>x</div></section>',
    });
    expect(html).toContain('sw-animation-init'); // ANIMATION_CSS inlined
    expect(html).toContain('IntersectionObserver'); // ANIMATION_JS inlined
    expect(html).toContain('waves'); // RIPPLE runtime inlined
  });

  it('inlines the parallax runtime CSS + JS for its code-first marker', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1 data-sw-parallax-translate="40,-40">Drift</h1></section>',
    });
    expect(html).toContain('[data-sw-parallax-scene]{position:relative;overflow:hidden}'); // PARALLAX_CSS inlined
    expect(html).toContain('data-sw-parallax-blur'); // PARALLAX_JS inlined (the runtime selector list)
  });

  it('returns a 400 error envelope (never a raw 500) when the source fails to render', async () => {
    const res = await client.post(`/projects/${projectId}/preview`, {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section>{{#each page.children}}<li>{{this.title}}</li></section>', // missing {{/each}}
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error?: string }).error).toBeTruthy();
  });

  it('renders a {{sw-form}} embed with the same-origin endpoint, keeps the marker, and inlines FORM_JS', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('form', 'contact', {
      id: 'contact', name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
      submitLabel: 'Send', successMessage: 'Thanks!', errorMessage: 'Oops.',
      recipient: 'leads@site.test', mode: 'globalSmtp', captcha: false, pow: false,
    })).statusCode).toBe(200);
    const html = await previewHtml({
      id: 'contact-page', path: 'contact', title: 'Contact', root: { id: 'r', type: 'Section' },
      source: '<section>{{sw-form "contact"}}</section>',
    });
    // a PREVIEW posts to the dry run: same validation, nothing stored, nothing mailed
    // A preview form carries the same id-only marker as a published one; the `/preview` suffix lives
    // in the runtime blob (`v: true`), so the dry-run address is no more scrapeable than the real one.
    expect(html).toContain('data-sw-routed="contact"');
    // Note the `="`: the preview INLINES FORM_JS, whose source mentions the attribute name when it
    // reads a contactPhp endpoint. What must be absent is the ATTRIBUTE, not the string.
    expect(html).not.toContain('data-sw-endpoint="');
    expect(formApiBlob(html)).toMatchObject({ p: projectId, v: 1 }); // v=1 → the assembler appends /preview
    expect(html).toContain('data-sw-form="contact"'); // preview keeps the reference marker
    expect(html).toContain('<span data-sw-part="label">Email</span>');
    expect(html).toContain('name="_hpt"');
    expect(html).not.toContain('leads@site.test'); // recipient never reaches the preview document
    expect(html).toContain('_elapsed'); // FORM_JS inlined (component scan on the rendered output)
  });

  it('returns a 400 naming the unknown form id for a dangling reference', async () => {
    const res = await client.post(`/projects/${projectId}/preview`, {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<form data-sw-form="missing"></form>',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error?: string }).error).toMatch(/unknown form "missing"/);
  });

  // A RAW-HTML page (the explicit `page.rawHtml` setting) renders free-form: the editor canvas must NOT
  // compile a per-page Tailwind utility sheet (foreign classes like Bootstrap `w-100` collide with Tailwind
  // utility NAMES — Tailwind would emit `.w-100{width:calc(var(--spacing)*100)}` (=400px) and clobber the
  // markup) and must inject NO platform CSS/JS. A normal page — INCLUDING a foundation-imported one — gets it.
  it('does NOT inline a Tailwind utility sheet for a RAW-HTML page — foreign classes survive', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><div class="w-100 m-0">hi</div></section>',
      rawHtml: true,
    });
    expect(html).not.toContain('.w-100{width:calc'); // the colliding compiled utility is absent
    expect(html).not.toContain('--tw-'); // no Tailwind utility/preflight layer at all
    expect(html).toContain('class="w-100 m-0"'); // the raw markup is preserved literally
  });

  it('DOES inline the Tailwind utility sheet for a normal (non-raw) page using the same class', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><div class="w-100 m-0">hi</div></section>',
    });
    expect(html).toContain('.w-100{width:calc'); // Tailwind compiled the utility for a platform page
  });

  it('renders an IMPORTED page NATIVE (utility sheet present) even before nativization — rawHtml is the only render switch, NOT swImport', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><div class="w-100 m-0">hi</div></section>',
      data: { swImport: { sourceUrl: 'https://example.com/', rewritten: false } },
    });
    // Foundation imports discard foreign CSS → the page is styled by the platform sheet from the start, so an
    // agent's native classes are visible immediately (no raw-fidelity deadlock). swImport no longer suppresses CSS.
    expect(html).toContain('.w-100{width:calc');
  });

  it('a RAW-HTML page skips ALL platform CSS/JS — even the animation runtime (the page brings its own)', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><div data-sw-animation="fade-up" class="w-100">hi</div></section>',
      rawHtml: true,
    });
    expect(html).not.toContain('sw-animation-init'); // ANIMATION_CSS NOT inlined under rawHtml
    expect(html).not.toContain('IntersectionObserver'); // ANIMATION_JS NOT inlined
    expect(html).not.toContain('--tw-'); // and no utility sheet
  });

  // ★ THE EDITOR CANVAS AND THE BUILT SITE MUST RESOLVE A CASCADE TIE THE SAME WAY.
  //
  // The canvas INLINES the compiled Tailwind sheet (it is served under an opaque-origin `sandbox` CSP,
  // so it cannot link one); the build LINKS it. Both must sit AFTER the author's criticalCss, because
  // a class on the element is the most local declaration and is expected to win — the contract the
  // authoring guide states. The inlined sheet used to travel as a trailing `inlineStyles` entry, which
  // renderDocument emits BEFORE criticalCss, so this ONE surface inverted the rule: a nav classed
  // `hidden lg:flex` over an author `.tie-tabs{display:flex}` collapsed on mobile everywhere except in
  // the page editor, where the author's rule — identical specificity (0,1,0), later in source order —
  // silently won. Nothing reported it; the sheet was present and simply outranked.
  describe('cascade parity — the compiled utilities vs the author’s criticalCss', () => {
    // A tie BY CONSTRUCTION: `.tie-tabs` and `.hidden` are both (0,1,0) with opposite declarations,
    // so ONLY source order decides — which is exactly what drifted between the two surfaces.
    const AUTHOR_RULE = '.tie-tabs{display:flex}';
    const homePage = {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><ul class="tie-tabs hidden lg:flex"><li>Nav</li></ul></section>',
    };

    beforeEach(async () => {
      const proj = client.project(projectId);
      expect((await proj.putContent('settings', 'settings', {
        brand: { name: 'Site' },
        website: { criticalCss: AUTHOR_RULE },
        settings: { defaultLocale: 'en', locales: ['en'] },
      })).statusCode).toBe(200);
      expect((await proj.putContent('page', 'home', homePage)).statusCode).toBe(200);
    });

    it('★ the EDITOR CANVAS emits the inlined utility sheet AFTER criticalCss', async () => {
      const html = await previewHtml(homePage);
      const author = html.indexOf(AUTHOR_RULE);
      const utility = html.indexOf('.hidden{display:none}'); // the compiled sheet, Tailwind-minified
      expect(author).toBeGreaterThan(-1); // the author's sheet is inlined…
      expect(utility).toBeGreaterThan(-1); // …and so are the utilities the markup actually uses
      expect(author).toBeLessThan(utility); // ← `hidden` wins the tie, as it does on the built site
    });

    it('★ the BUILT SITE agrees — its linked utility sheet also follows criticalCss', async () => {
      expect((await client.post(`${client.project(projectId).base}/publish`)).statusCode).toBe(200);
      const res = await client.get('/sites/site/index.html');
      expect(res.statusCode).toBe(200);
      const author = res.body.indexOf(AUTHOR_RULE);
      const utility = res.body.indexOf('styles.css'); // the build LINKS the sheet instead of inlining it
      expect(author).toBeGreaterThan(-1);
      expect(utility).toBeGreaterThan(-1);
      expect(author).toBeLessThan(utility);
    });
  });
});
