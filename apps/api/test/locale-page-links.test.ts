import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

// A link to another page must stay in the reader's language on EVERY render surface. Translated pages
// inherit the main page's source, so the link is written once, in the main language — and the German
// contact page is slugged `kontakt`, which is exactly where slug-based linking used to fall apart.
// Three spellings must all land a German reader on /de/kontakt/: {{sw-page-url "<id>"}}, a slug chain
// through `pages.*`, and a dataset `page` field. Each surface builds its context by hand, so each is
// checked here against the real route — a surface that forgot the wiring renders "#" with no error.

const root = { id: 'r', type: 'Section' as const };
const SHARED =
  '<section>' +
  '<a class="pu" href="{{sw-page-url "contact"}}">id</a>' +
  '<a class="pg" href="{{sw-url pages.contact._attributes.path}}">slug</a>' +
  '{{#each dataset.promos}}<a class="ds" href="{{sw-url target.path}}">field</a>{{/each}}' +
  '</section>';

/** The href of the anchor carrying `cls`, or undefined when the anchor is missing. */
const hrefOf = (html: string, cls: string): string | undefined =>
  new RegExp(`class="${cls}" href="([^"]*)"`).exec(html)?.[1];

describe('links to another page follow the reader’s language', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-locale-links-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-locale-links-media-'));
    // The editor preview + code-editor render go through the isolated render worker.
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      // A site-wide slot shares the page's render context — it must follow the page's language too.
      website: { footer: '<div><a class="ft" href="{{sw-page-url "contact"}}">footer</a></div>' },
    });
    await proj.putContent('dataset', 'promos', { id: 'promos', name: 'Promos', slug: 'promos', fields: [{ name: 'target', type: 'page' }] });
    // The field stores the MAIN-language page id — what the editor's page picker offers.
    await proj.putContent('entry', 'promo_1', { id: 'promo_1', dataset: 'promos', status: 'published', values: { target: 'contact' } });
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: SHARED });
    await proj.putContent('page', 'contact', { id: 'contact', path: 'contact', parent: 'home', title: 'Contact', root, translationGroup: 'contact', source: '<p>Contact</p>' });
    // German variants INHERIT (no source) — and the contact page's slug is translated.
    await proj.putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root });
    await proj.putContent('page', 'contact-de', { id: 'contact-de', path: 'kontakt', parent: 'home-de', title: 'Kontakt', locale: 'de', translationGroup: 'contact', root });
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('publish: an inherited German page links to the German page by every spelling, the footer too', async () => {
    const proj = client.project(projectId);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // /de/ is one level deep, so internal links come out page-relative from there.
    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    for (const cls of ['pu', 'pg', 'ds', 'ft']) expect(hrefOf(de, cls), cls).toBe('../de/kontakt/');

    const en = (await client.get(`/sites/${slug}/index.html`)).body;
    for (const cls of ['pu', 'pg', 'ds', 'ft']) expect(hrefOf(en, cls), cls).toBe('contact/');
  });

  it('editor preview (and preview_page): the same German routes', async () => {
    const res = await client.post(`/projects/${projectId}/preview`, {
      id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root,
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    for (const cls of ['pu', 'pg', 'ds', 'ft']) expect(hrefOf(html, cls), cls).toContain('/de/kontakt/');
  });

  it('code-editor render (render_template): a stored German page resolves in German, an ad-hoc body in the main language', async () => {
    // render-template renders a page's OWN source, so give the German contact page a fork to render.
    const proj = client.project(projectId);
    await proj.putContent('page', 'contact-de', {
      id: 'contact-de', path: 'kontakt', parent: 'home-de', title: 'Kontakt', locale: 'de', translationGroup: 'contact', root,
      source: '<a class="pu" href="{{sw-page-url "home"}}">home</a>',
    });
    const stored = await client.post(`/projects/${projectId}/render-template`, { pageId: 'contact-de' });
    expect(stored.statusCode).toBe(200);
    expect(hrefOf((stored.json() as { html: string }).html, 'pu')).toBe('/de/');

    const adHoc = await client.post(`/projects/${projectId}/render-template`, { template: '<a class="pu" href="{{sw-page-url "contact"}}">c</a>' });
    expect(adHoc.statusCode).toBe(200);
    expect(hrefOf((adHoc.json() as { html: string }).html, 'pu')).toBe('/contact/');
  });

  it('an unknown id renders "#" rather than a broken route or the raw id', async () => {
    const res = await client.post(`/projects/${projectId}/render-template`, { template: '<a class="pu" href="{{sw-page-url "nope"}}">x</a>' });
    expect(res.statusCode).toBe(200);
    expect(hrefOf((res.json() as { html: string }).html, 'pu')).toBe('#');
  });
});
