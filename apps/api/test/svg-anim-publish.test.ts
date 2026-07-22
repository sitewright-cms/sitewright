import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the SVG animation engine (the `data-sw-svg` vocabulary). When any authored
// surface — a code-first source, a raw Html embed, a skeleton slot, or a snippet — uses
// `data-sw-svg`, the publisher ships the first-party runtime: ONE `svg-anim.js` at the site
// root (linked per page at the right relative depth) plus the inline structural stylesheet.
// Sites that don't use it get byte-identical output (no extra file, no request) — the
// components.js only-used-ships discipline.

describe('SVG animation engine → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-svg-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-svg-media-'));
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
      source:
        '<section><svg viewBox="0 0 100 100" data-sw-svg-scene data-sw-svg-stagger="80">' +
        '<path d="M10 10 H90" fill="none" stroke="currentColor" data-sw-svg="draw" data-sw-duration="1200"/>' +
        '<circle cx="50" cy="50" r="20" data-sw-svg="zoom-in"/></svg></section>',
    };
    const about = {
      id: 'about',
      path: 'about',
      title: 'About',
      root: { id: 'r2', type: 'Section' },
      // A nested page that ALSO authors an svg animation — so it links the runtime rebased to its depth.
      source:
        '<section><svg viewBox="0 0 10 10" data-sw-svg-scene>' +
        '<path d="M0 0 H10" fill="none" stroke="currentColor" data-sw-svg="draw"/></svg></section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', about)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // The authored attributes survive into the export; the runtime is linked + inlined.
    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('data-sw-svg="draw"');
    expect(index.body).toContain('<script defer src="svg-anim.js?v=');
    expect(index.body).toContain('[data-sw-svg]{transform-box:fill-box'); // inline structural stylesheet
    expect(index.body).toContain('prefers-reduced-motion'); // accessibility gate

    // A nested page that authors the runtime links it rebased to its depth (per-page shipping).
    const aboutPage = await client.get(`/sites/${slug}/about/index.html`);
    expect(aboutPage.statusCode).toBe(200);
    expect(aboutPage.body).toContain('<script defer src="../svg-anim.js?v=');

    // The runtime itself is served from the site root and drives WAAPI + stroke draw.
    const js = await client.get(`/sites/${slug}/svg-anim.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('IntersectionObserver');
    expect(js.body).toContain('getTotalLength');
    expect(js.body).toContain('.animate(');
  });

  it('ships the runtime when only a skeleton slot uses data-sw-svg', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: {
            footer:
              '<svg viewBox="0 0 24 24" data-sw-svg="draw"><path d="M2 12 L22 12" stroke="currentColor" fill="none"/></svg>',
          },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>No SVG animation in the page itself</h1></section>',
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('data-sw-svg="draw"');
    expect(index.body).toContain('<script defer src="svg-anim.js?v=');
  });

  it('ships NOTHING extra for a site that uses no SVG animation', async () => {
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
    expect(index.body).not.toContain('svg-anim.js');
    expect(index.body).not.toContain('transform-box:fill-box');
    expect((await client.get(`/sites/${slug}/svg-anim.js`)).statusCode).toBe(404);
  });
});
