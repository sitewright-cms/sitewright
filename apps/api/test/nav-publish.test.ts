import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: page-tree-driven auto-nav. Pages declare nav placement; a code-first
// SKELETON SLOT renders the slot's menu (page-relative links) into the published site.
// The platform wraps the mainNav slot in <nav id="main-nav"> and the footer slot in
// <footer id="footer">; the slot iterates `nav.header` / `nav.footer` (the page-tree-
// derived menus). Internal links emitted via {{sw-url path}} are rebased page-relative.

// A header skeleton slot: iterates the auto-nav header menu (built from each page's
// nav settings). External placeholders open in a new tab; the rest are page links.
const HEADER_SLOT =
  '{{#each nav.header}}<a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a>{{/each}}';
const FOOTER_SLOT =
  '<div data-slot="footer">{{#each nav.footer}}<a href="{{sw-url path}}">{{sw-label}}</a>{{/each}}</div>';

// A code-first page: a neutral block-tree stub (no children) + a Handlebars source.
// The page body renders from `source`; the nav comes from the project skeleton slot.
const navPage = (id: string, path: string, title: string, nav?: unknown) => ({
  id,
  path,
  title,
  ...(nav ? { nav } : {}),
  root: { id: `${id}-r`, type: 'Section' },
  source: '<section><h1>{{page.title}}</h1></section>',
});

describe('auto-nav → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-nav-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-nav-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  /** PUT the project settings singleton with the given website skeleton slots. */
  async function putSlots(website: Record<string, unknown>) {
    const res = await client.project(projectId).putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      website,
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    expect(res.statusCode).toBe(200);
  }

  async function fetchSite(path: string): Promise<string> {
    const res = await client.get(`/sites/${slug}/${path}`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('renders the header menu from the page tree, with page-relative links', async () => {
    const proj = client.project(projectId);
    await putSlots({ mainNav: HEADER_SLOT });
    expect((await proj.putContent('page', 'home', navPage('home', '', 'Home', { slots: ['header'], order: 0 }))).statusCode).toBe(200);
    expect(
      (await proj.putContent('page', 'about', navPage('about', 'about', 'About Page', { title: 'About', slots: ['header'], order: 1 }))).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // Home page (site root): the nav lives in the platform's <nav id="main-nav"> landmark;
    // links are root-relative-from-home.
    const home = await fetchSite('index.html');
    expect(home).toContain('<nav id="main-nav">');
    expect(home).toContain('href="./"'); // Home link
    expect(home).toContain('href="about"'); // About link, label from nav.title
    expect(home).toContain('>About<');

    // About subpage: the SAME menu, rebased one level up.
    const about = await fetchSite('about/index.html');
    expect(about).toContain('href="../"'); // Home
    expect(about).toContain('href="../about"'); // About
  });

  it('renders footer-slot menus and excludes collection pages', async () => {
    const proj = client.project(projectId);
    // The footer skeleton slot iterates nav.footer; two pages are placed in the footer slot;
    // a collection page also flagged for the footer (must NOT appear).
    await putSlots({ footer: FOOTER_SLOT });
    expect((await proj.putContent('page', 'home', navPage('home', '', 'Home', { slots: ['footer'], order: 0 }))).statusCode).toBe(200);
    expect((await proj.putContent('page', 'terms', navPage('terms', 'terms', 'Terms', { slots: ['footer'], order: 1 }))).statusCode).toBe(200);
    // dataset + collection page flagged for the footer slot — excluded from nav.
    expect((await proj.putContent('dataset', 'posts', { id: 'posts', slug: 'posts', name: 'Posts', fields: [] })).statusCode).toBe(200);
    expect(
      (await proj.putContent('page', 'post', { id: 'post', path: '[slug]', title: 'Post', collection: { dataset: 'posts', param: 'slug' }, nav: { slots: ['footer'] }, root: { id: 'pr', type: 'Section' }, source: '<section><h1>{{page.title}}</h1></section>' })).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    // The footer slot lives inside the platform's <footer id="footer"> landmark.
    expect(home).toContain('<footer id="footer">');
    expect(home).toContain('data-slot="footer"');
    expect(home).toContain('href="./"'); // Home
    expect(home).toContain('href="terms"'); // Terms
    expect(home).toContain('>Terms<');
    expect(home).not.toContain('posts/'); // collection page excluded from nav
  });

  it('excludes draft pages from the published site, its routes, and the nav', async () => {
    const proj = client.project(projectId);
    await putSlots({ mainNav: HEADER_SLOT });
    expect((await proj.putContent('page', 'home', navPage('home', '', 'Home', { slots: ['header'], order: 0 }))).statusCode).toBe(200);
    // A draft page placed in the header nav — must NOT publish, route, or appear in the menu.
    expect(
      (await proj.putContent('page', 'secret', { ...navPage('secret', 'secret', 'Secret', { slots: ['header'], order: 1 }), status: 'draft' })).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    expect(home).toContain('href="./"'); // Home is published
    expect(home).not.toContain('>Secret<'); // draft excluded from the menu
    expect(home).not.toContain('href="secret"');
    // No route is generated for the draft page → a bare HTTP 404 with an empty body (no styled error page).
    const draft = await client.get(`/sites/${slug}/secret/index.html`);
    expect(draft.statusCode).toBe(404);
    expect(draft.body).toBe('');
  });

  it('publishes link placeholders into the nav (external new-tab + #modal), ships nav-link.js, emits no page for them', async () => {
    const proj = client.project(projectId);
    await putSlots({ mainNav: HEADER_SLOT });
    expect((await proj.putContent('page', 'home', navPage('home', '', 'Home', { slots: ['header'], order: 0 }))).statusCode).toBe(200);
    // A "global modal" placeholder (opens a #contact <dialog>) — kind:'link', no own route.
    expect(
      (await proj.putContent('page', 'nav-contact', {
        id: 'nav-contact', path: '', title: 'Contact', kind: 'link',
        link: { target: '#contact' }, nav: { slots: ['header'], order: 1 },
        root: { id: 'ncr', type: 'Section' },
      })).statusCode,
    ).toBe(200);
    // An external placeholder that opens in a new tab.
    expect(
      (await proj.putContent('page', 'nav-docs', {
        id: 'nav-docs', path: '', title: 'Docs', kind: 'link',
        link: { target: 'https://docs.example.com', newTab: true }, nav: { slots: ['header'], order: 2 },
        root: { id: 'ndr', type: 'Section' },
      })).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    expect(home).toContain('href="#contact"'); // fragment target passes through
    expect(home).toContain('>Contact<');
    expect(home).toContain('href="https://docs.example.com"'); // external target
    expect(home).toContain('target="_blank"'); // newTab
    expect(home).toContain('nav-link.js'); // runtime shipped (a placeholder targets a #fragment)
    expect((await client.get(`/sites/${slug}/nav-link.js`)).statusCode).toBe(200);
    // The slugless link placeholders produce NO HTML page of their own.
    expect((await client.get(`/sites/${slug}/nav-contact/index.html`)).statusCode).toBe(404);
  });

  it('omits pages without nav placement from the menu', async () => {
    const proj = client.project(projectId);
    await putSlots({ mainNav: HEADER_SLOT });
    expect((await proj.putContent('page', 'home', navPage('home', '', 'Home', { slots: ['header'] }))).statusCode).toBe(200);
    // 'secret' has no nav → not in the menu.
    expect((await proj.putContent('page', 'secret', navPage('secret', 'secret', 'Secret'))).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    expect(home).toContain('href="./"');
    expect(home).not.toContain('href="secret"');
  });
});
