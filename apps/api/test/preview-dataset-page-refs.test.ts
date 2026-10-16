import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

// A dataset `page` field must resolve against the SAME pages in the editor preview as on the live site.
//
// Publish resolves it against the pages the build ships — the published subset — so a reference to a
// DRAFT page reads as empty there, and a German reader whose German variant is still a draft lands on the
// main-language page. The preview resolved against every saved page, drafts included, so the editor
// showed a working link that the published site rendered empty (or pointed at a page that isn't there).
// The rest of that preview (nav, page.children, pages.*, sw-page-url) already used the published subset.
//
// Draft ENTRIES are a different, deliberate rule: they DO show in the preview (work in progress), and
// this does not change that — only which pages a reference can resolve to.

const root = { id: 'r', type: 'Section' as const };
const LOOP = '<section>{{#each dataset.promos}}<a class="{{label}}" href="{{sw-url target.path}}">{{target.title}}</a>{{/each}}</section>';

/** The `<a class="cls">` tag's href and text, or undefined when that anchor was not rendered at all. */
function anchor(html: string, cls: string): { href: string; text: string } | undefined {
  for (const [, attrs = '', text = ''] of html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)) {
    if (attrs.includes(` class="${cls}"`)) return { href: /\bhref="([^"]*)"/.exec(attrs)?.[1] ?? '', text };
  }
  return undefined;
}

describe('dataset page fields resolve against the published pages — in the preview as on publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'refs';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-page-refs-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-page-refs-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Refs', slug);
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    await proj.putContent('dataset', 'promos', {
      id: 'promos', name: 'Promos', slug: 'promos',
      fields: [{ name: 'label', type: 'text' }, { name: 'target', type: 'page' }],
    });
    const promo = (id: string, label: string, target: string, status: 'draft' | 'published' = 'published') =>
      proj.putContent('entry', id, { id, dataset: 'promos', status, values: { label, target } });
    await promo('p_live', 'live', 'about');
    await promo('p_draft_page', 'draftpage', 'secret');
    await promo('p_contact', 'contact', 'contact');
    await promo('p_wip', 'wip', 'about', 'draft'); // a DRAFT entry — still shown in the preview

    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: LOOP });
    await proj.putContent('page', 'about', { id: 'about', path: 'about', parent: 'home', title: 'About', root });
    await proj.putContent('page', 'secret', { id: 'secret', path: 'secret', parent: 'home', title: 'Secret', root, status: 'draft' });
    await proj.putContent('page', 'contact', { id: 'contact', path: 'contact', parent: 'home', title: 'Contact', root, translationGroup: 'contact' });
    // German: the home page is live (inheriting the loop); the contact page's translation is still a DRAFT.
    await proj.putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root });
    await proj.putContent('page', 'contact-de', {
      id: 'contact-de', path: 'kontakt', parent: 'home-de', title: 'Kontakt', locale: 'de', translationGroup: 'contact', root, status: 'draft',
    });
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function preview(page: Record<string, unknown>): Promise<string> {
    const res = await client.post(`/projects/${projectId}/preview`, page);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { html: string }).html;
  }

  it('preview: a reference to a DRAFT page renders empty, exactly as it publishes', async () => {
    const html = await preview({ id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: LOOP });
    // Presence first — the published reference resolves, so an empty one below is the rule, not a broken render.
    expect(anchor(html, 'live')).toEqual({ href: expect.stringMatching(/\/about\/$/), text: 'About' });
    expect(anchor(html, 'draftpage')).toEqual({ href: '#', text: '' });
    expect(html).not.toContain('Secret');
    // Draft ENTRIES still show in the preview (unchanged): the row renders, resolving its published target.
    expect(anchor(html, 'wip')).toEqual({ href: expect.stringMatching(/\/about\/$/), text: 'About' });

    expect((await client.post(`${client.project(projectId).base}/publish`)).statusCode).toBe(200);
    const live = (await client.get(`/sites/${slug}/index.html`)).body;
    expect(anchor(live, 'live')).toEqual({ href: 'about/', text: 'About' });
    expect(anchor(live, 'draftpage')).toEqual({ href: '#', text: '' });
    expect(anchor(live, 'wip')).toBeUndefined(); // …while publish ships published entries only
  });

  it('preview: a German reader whose German variant is a DRAFT lands on the main-language page, as on publish', async () => {
    const html = await preview({ id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root });
    const link = anchor(html, 'contact');
    expect(link).toEqual({ href: expect.stringMatching(/\/contact\/$/), text: 'Contact' });
    expect(html).not.toContain('kontakt');

    expect((await client.post(`${client.project(projectId).base}/publish`)).statusCode).toBe(200);
    const live = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(anchor(live, 'contact')).toEqual({ href: '../contact/', text: 'Contact' });
  });

  // The code editor's render (POST render-template — also MCP render_template) fed the raw entries to the
  // template: a page field was still its stored id, so `{{target.path}}` / `{{target.title}}` rendered
  // empty there even for a PUBLISHED page — the one surface where an author checks a loop as they write it.
  async function renderTemplate(body: Record<string, unknown>): Promise<string> {
    const res = await client.post(`/projects/${projectId}/render-template`, body);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { html: string }).html;
  }

  it('render-template (ad-hoc body): page fields resolve, against the published pages', async () => {
    const html = await renderTemplate({ template: LOOP });
    expect(anchor(html, 'live')).toEqual({ href: '/about/', text: 'About' });
    expect(anchor(html, 'draftpage')).toEqual({ href: '#', text: '' }); // a draft page is not on the site
    expect(anchor(html, 'wip')).toEqual({ href: '/about/', text: 'About' }); // draft entries still show, as in the preview
  });

  it('render-template (a stored page): its locale — dataset variant, page refs and translations, as the preview', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      website: { translations: { greet: { en: 'Hello', de: 'Hallo' } } },
    });
    // A published German About page, so a German reader has somewhere German to land.
    await proj.putContent('page', 'about', { id: 'about', path: 'about', parent: 'home', title: 'About', root, translationGroup: 'about' });
    await proj.putContent('page', 'about-de', { id: 'about-de', path: 'ueber', parent: 'home-de', title: 'Über uns', locale: 'de', translationGroup: 'about', root });
    // The German variant of the dataset, which a German page's `dataset.promos` reads instead.
    await proj.putContent('dataset', 'promos_de', {
      id: 'promos_de', name: 'Promos (de)', slug: 'promos_de',
      fields: [{ name: 'label', type: 'text' }, { name: 'target', type: 'page' }],
    });
    await proj.putContent('entry', 'pd_about', { id: 'pd_about', dataset: 'promos_de', status: 'published', values: { label: 'dabout', target: 'about' } });
    await proj.putContent('entry', 'pd_contact', { id: 'pd_contact', dataset: 'promos_de', status: 'published', values: { label: 'dcontact', target: 'contact' } });
    const source = `${LOOP}<p class="greet">{{sw-translate "greet"}}</p>`;
    const page = { id: 'links-de', path: 'links', parent: 'home-de', title: 'Links', locale: 'de', root, source };
    await proj.putContent('page', 'links-de', page);

    const html = await renderTemplate({ pageId: 'links-de' });
    expect(anchor(html, 'dabout')).toEqual({ href: '/de/ueber/', text: 'Über uns' }); // the reader's language
    expect(anchor(html, 'dcontact')).toEqual({ href: '/contact/', text: 'Contact' }); // its German page is a draft
    expect(anchor(html, 'live')).toBeUndefined(); // the base dataset is replaced by the German variant
    expect(html).toContain('<p class="greet">Hallo</p>');

    // …and exactly what the member preview shows for the same page.
    const preview = await client.post(`/projects/${projectId}/preview`, page);
    expect(preview.statusCode, preview.body).toBe(200);
    const previewHtml = (preview.json() as { html: string }).html;
    for (const cls of ['dabout', 'dcontact']) expect(anchor(previewHtml, cls), cls).toEqual(anchor(html, cls));
    expect(previewHtml).toContain('<p class="greet">Hallo</p>');
  });
});
