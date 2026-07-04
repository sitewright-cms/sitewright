import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: scroll-reveal animations (the `data-sw-animation` vocabulary). When any
// authored surface — a code-first source, a raw Html embed, a skeleton slot, or a
// snippet — uses `data-sw-animation`, the publisher ships the first-party runtime: ONE
// `animations.js` at the site root (linked per page at the right relative depth)
// plus the inline animation stylesheet. Sites that don't use it get byte-identical
// output (no extra file, no extra request) — the components.js discipline.

describe('scroll-reveal animations → publish + preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-anim-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-anim-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('ships the runtime for a code-first source page, linked at page depth', async () => {
    const proj = client.project(projectId);
    const home = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1 data-sw-animation="fade-up">Hi</h1><p data-sw-animation="fade-up" data-sw-delay="200">There</p></section>',
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

    // The authored attributes survive into the export; the runtime is linked + inlined.
    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('data-sw-animation="fade-up"');
    expect(index.body).toContain('<script defer src="animations.js?v=');
    expect(index.body).toContain('[data-sw-animation].sw-animation-init'); // inline animation stylesheet
    expect(index.body).toContain('prefers-reduced-motion'); // accessibility gate

    // Site-wide asset: a nested page on the same site links it rebased to its depth.
    const aboutPage = await client.get(`/sites/${slug}/about/index.html`);
    expect(aboutPage.statusCode).toBe(200);
    expect(aboutPage.body).toContain('<script defer src="../animations.js?v=');

    // The runtime itself is served from the site root.
    const js = await client.get(`/sites/${slug}/animations.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('IntersectionObserver');
    expect(js.body).toContain('sw-animation-active');
  });

  it('ships the runtime when only a skeleton slot uses data-sw-animation', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { footer: '<div data-sw-animation="fade">© {{ company.name }}</div>' },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>No animation in the page itself</h1></section>',
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    // The footer slot's neutral <div> is wrapped by the skeleton's own <footer id="footer"> landmark.
    expect(index.body).toContain('<footer id="footer"><div data-sw-animation="fade">© Acme</div></footer>');
    expect(index.body).toContain('<script defer src="animations.js?v=');
  });

  it('ships NOTHING extra for a site that uses no animations', async () => {
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
    expect(index.body).not.toContain('animations.js');
    expect(index.body).not.toContain('sw-animation-init');
    expect((await client.get(`/sites/${slug}/animations.js`)).statusCode).toBe(404);
  });

});
