import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the parallax / scroll-linked property engine (the `data-sw-parallax*` vocabulary).
// When any authored surface uses a parallax channel, the publisher ships the first-party runtime —
// ONE `parallax.js` at the site root (linked per page at the right relative depth) plus the inline
// structural stylesheet. Sites that don't use it ship nothing extra (no file, no request).

describe('parallax → publish + preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-px-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-px-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('ships the runtime + structural CSS for a code-first source, linked at page depth', async () => {
    const proj = client.project(projectId);
    const home = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      // a channel can be used without the base translate; also the bg-section variant
      source:
        '<section><h1 data-sw-parallax="0.3">Drift</h1><p data-sw-parallax-opacity="0,1">Fade</p>' +
        '<div data-sw-parallax-bg data-sw-parallax="0.4"><div data-sw-parallax-layer></div><span>Hero</span></div></section>',
    };
    const about = {
      id: 'about',
      path: 'about',
      title: 'About',
      root: { id: 'r2', type: 'Section' },
      source: '<section><h2>Plain page on the same site</h2></section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', about)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('data-sw-parallax="0.3"'); // authored attrs survive
    expect(index.body).toContain('data-sw-parallax-opacity="0,1"');
    expect(index.body).toContain('<script defer src="parallax.js"></script>'); // runtime linked
    expect(index.body).toContain('[data-sw-parallax-bg]{position:relative;overflow:hidden}'); // structural CSS inlined

    // Site-wide asset: a nested page links it rebased to its depth.
    const aboutPage = await client.get(`/sites/${slug}/about/index.html`);
    expect(aboutPage.statusCode).toBe(200);
    expect(aboutPage.body).toContain('<script defer src="../parallax.js"></script>');

    // The runtime itself is served from the site root + bails under reduced motion.
    const js = await client.get(`/sites/${slug}/parallax.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('prefers-reduced-motion'); // accessibility gate
    expect(js.body).toContain('requestAnimationFrame');
  });

  it('ships the runtime when only a skeleton slot uses a parallax channel', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { footer: '<div data-sw-parallax-scale="0.9,1">© {{ company.name }}</div>' },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>No parallax in the page itself</h1></section>',
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('data-sw-parallax-scale="0.9,1"');
    expect(index.body).toContain('<script defer src="parallax.js"></script>');
  });

  it('ships NOTHING extra for a site that uses no parallax', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>Plain</h1></section>',
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).not.toContain('parallax.js');
    expect(index.body).not.toContain('data-sw-parallax-bg]{position');
    expect((await client.get(`/sites/${slug}/parallax.js`)).statusCode).toBe(404);
  });
});
