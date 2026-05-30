import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: when a site uses Tailwind utility classes, the publisher compiles
// ONE minimal shared stylesheet (only the used utilities), writes it at the site
// root, and links it from every page at the correct relative depth. Sites that
// use no utility classes are unchanged (no extra file, no extra request).

describe('Tailwind utility layer → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-tw-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-tw-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('compiles a minimal shared stylesheet and links it, scoped to page depth', async () => {
    const proj = client.project(projectId);
    const home = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Section',
        className: 'flex gap-4',
        children: [{ id: 'h', type: 'Heading', className: 'text-center', props: { text: 'Hi' } }],
      },
    };
    const about = {
      id: 'about',
      path: '/about',
      title: 'About',
      root: { id: 'r2', type: 'Section', className: 'grid', children: [] },
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', about)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // Home page: class emitted + stylesheet linked at the site root.
    const index = await client.get(`/sites/${projectId}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('class="flex gap-4"');
    expect(index.body).toContain('<link rel="stylesheet" href="styles.css" />');

    // Nested page links the SAME sheet, rebased to its depth (about/index.html).
    const aboutPage = await client.get(`/sites/${projectId}/about/index.html`);
    expect(aboutPage.statusCode).toBe(200);
    expect(aboutPage.body).toContain('<link rel="stylesheet" href="../styles.css" />');

    // The compiled sheet contains only the utilities actually used across pages.
    const sheet = await client.get(`/sites/${projectId}/styles.css`);
    expect(sheet.statusCode).toBe(200);
    expect(sheet.body).toContain('display:flex'); // .flex (minified)
    expect(sheet.body).toContain('.text-center');
    expect(sheet.body).toContain('display:grid'); // .grid used on the about page
    expect(sheet.body).not.toContain('display:table'); // an unused utility is absent
  });

  it('emits no stylesheet (and no link) for a site that uses no utility classes', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${projectId}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).not.toContain('rel="stylesheet"');

    const sheet = await client.get(`/sites/${projectId}/styles.css`);
    expect(sheet.statusCode).toBe(404); // never written
  });

  it('serves only the .css asset — never release.json, and not via traversal', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: { id: 'r', type: 'Section', className: 'flex', children: [] },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // The build manifest (.json) is not an allowlisted asset → not served.
    expect((await client.get(`/sites/${projectId}/release.json`)).statusCode).toBe(404);
    // Traversal attempts out of the site dir are rejected.
    expect((await client.get(`/sites/${projectId}/../../etc/passwd`)).statusCode).toBe(404);
    // The legitimate stylesheet is served with the css content type.
    const sheet = await client.get(`/sites/${projectId}/styles.css`);
    expect(sheet.statusCode).toBe(200);
    expect(sheet.headers['content-type']).toContain('text/css');
  });
});
