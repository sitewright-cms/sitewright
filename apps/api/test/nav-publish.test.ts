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
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-nav-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-nav-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function fetchSite(path: string): Promise<string> {
    const res = await client.get(`/sites/${projectId}/${path}`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('renders the header menu from the page tree, with page-relative links', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', navBlockPage('home', '/', 'Home', { slots: ['header'], order: 0 }))).statusCode).toBe(200);
    expect(
      (await proj.putContent('page', 'about', navBlockPage('about', '/about', 'About Page', { title: 'About', slots: ['header'], order: 1 }))).statusCode,
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

  it('omits pages without nav placement from the menu', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', navBlockPage('home', '/', 'Home', { slots: ['header'] }))).statusCode).toBe(200);
    // 'secret' has no nav → not in the menu.
    expect((await proj.putContent('page', 'secret', navBlockPage('secret', '/secret', 'Secret'))).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const home = await fetchSite('index.html');
    expect(home).toContain('href="./"');
    expect(home).not.toContain('href="secret"');
  });
});
