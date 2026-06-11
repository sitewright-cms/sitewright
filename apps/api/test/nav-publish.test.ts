import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: page-tree-driven auto-nav. Pages declare nav placement; a Nav
// block renders the slot's menu (page-relative links) in the published site.

const navBlockPage = (id: string, path: string, title: string, nav?: unknown) => ({
  id,
  path,
  title,
  ...(nav ? { nav } : {}),
  root: {
    id: `${id}-r`,
    type: 'Section',
    children: [
      { id: `${id}-nav`, type: 'Nav', props: { slot: 'header' } },
      { id: `${id}-h`, type: 'Heading', props: { text: `${title} body`, level: 1 } },
    ],
  },
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

  async function fetchSite(path: string): Promise<string> {
    const res = await client.get(`/sites/${slug}/${path}`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('renders the header menu from the page tree, with page-relative links', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', navBlockPage('home', '', 'Home', { slots: ['header'], order: 0 }))).statusCode).toBe(200);
    expect(
      (await proj.putContent('page', 'about', navBlockPage('about', 'about', 'About Page', { title: 'About', slots: ['header'], order: 1 }))).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // Home page (site root): links are root-relative-from-home.
    const home = await fetchSite('index.html');
    expect(home).toContain('data-sw-block="Nav"');
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
    // A page with a footer Nav block; two pages placed in the footer slot; a
    // collection page also flagged for the footer (must NOT appear).
    const footerHome = {
      id: 'home',
      path: '',
      title: 'Home',
      nav: { slots: ['footer'], order: 0 },
      root: { id: 'hr', type: 'Section', children: [{ id: 'hn', type: 'Nav', props: { slot: 'footer' } }] },
    };
    expect((await proj.putContent('page', 'home', footerHome)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'terms', { id: 'terms', path: 'terms', title: 'Terms', nav: { slots: ['footer'], order: 1 }, root: { id: 'tr', type: 'Section' } })).statusCode).toBe(200);
    // dataset + collection page flagged for the footer slot — excluded from nav.
    expect((await proj.putContent('dataset', 'posts', { id: 'posts', slug: 'posts', name: 'Posts', fields: [] })).statusCode).toBe(200);
    expect(
      (await proj.putContent('page', 'post', { id: 'post', path: '[slug]', title: 'Post', collection: { dataset: 'posts', param: 'slug' }, nav: { slots: ['footer'] }, root: { id: 'pr', type: 'Section' } })).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    expect(home).toContain('data-slot="footer"');
    expect(home).toContain('href="./"'); // Home
    expect(home).toContain('href="terms"'); // Terms
    expect(home).toContain('>Terms<');
    expect(home).not.toContain('posts/'); // collection page excluded from nav
  });

  it('excludes draft pages from the published site, its routes, and the nav', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', navBlockPage('home', '', 'Home', { slots: ['header'], order: 0 }))).statusCode).toBe(200);
    // A draft page placed in the header nav — must NOT publish, route, or appear in the menu.
    expect(
      (await proj.putContent('page', 'secret', { ...navBlockPage('secret', 'secret', 'Secret', { slots: ['header'], order: 1 }), status: 'draft' })).statusCode,
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

  it('omits pages without nav placement from the menu', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', navBlockPage('home', '', 'Home', { slots: ['header'] }))).statusCode).toBe(200);
    // 'secret' has no nav → not in the menu.
    expect((await proj.putContent('page', 'secret', navBlockPage('secret', 'secret', 'Secret'))).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    expect(home).toContain('href="./"');
    expect(home).not.toContain('href="secret"');
  });
});
