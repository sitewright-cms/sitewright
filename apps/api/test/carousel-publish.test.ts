import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: an interactive Carousel component flows through publish — its
// behavior (components.js, only-used-ships, served from the site's own origin so
// it runs under default-src 'self') + its inlined CSS — and through preview as a
// inlined behavior (the preview doc is served under CSP: sandbox allow-scripts).

describe('Carousel component → publish + preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  const carouselPage = {
    id: 'home',
    path: '',
    title: 'Home',
    root: {
      id: 'r',
      type: 'Section',
      children: [
        {
          id: 'car',
          type: 'Carousel',
          props: { label: 'Featured', autoplay: true, interval: 4000 },
          children: [
            { id: 's1', type: 'Slide', props: { image: '/a.jpg', alt: 'A', caption: 'One' } },
            { id: 's2', type: 'Slide', props: { image: '/b.jpg', alt: 'B', caption: 'Two' } },
          ],
        },
      ],
    },
  };

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-car-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-car-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('publishes the carousel, inlines its CSS, and links a served components.js', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', carouselPage)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('data-sw-component="carousel"');
    expect(index.body).toContain('data-autoplay="true"');
    expect(index.body).toContain('<figcaption>One</figcaption>');
    // Component CSS inlined; behavior bundle linked (deferred).
    expect(index.body).toContain('scroll-snap-type'); // inlined component CSS
    expect(index.body).toContain('<script defer src="components.js"></script>');

    // The bundle is served from the site's own origin (so it runs under the CSP).
    const bundle = await client.get(`/sites/${slug}/components.js`);
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers['content-type']).toContain('javascript');
    expect(bundle.body).toContain('data-sw-component="carousel"');
    expect(bundle.body).toContain('data-sw-enhanced'); // the PE enhancement marker
  });

  it('ships no components.js (and no script tag) for a site that uses no component', async () => {
    const proj = client.project(projectId);
    const plain = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] },
    };
    expect((await proj.putContent('page', 'home', plain)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).not.toContain('<script defer');
    expect((await client.get(`/sites/${slug}/components.js`)).statusCode).toBe(404);
  });

  it('previews the carousel live — inlined component CSS + behavior (sandbox-CSS doc)', async () => {
    const res = await client.post(`/projects/${projectId}/preview`, carouselPage);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    expect(body.html).toContain('data-sw-component="carousel"'); // semantic HTML present
    expect(body.html).toContain('scroll-snap-type'); // component CSS inlined
    // The preview doc is served under CSP: sandbox allow-scripts, so behavior is inlined.
    expect(body.html).toContain('<script>');
    expect(body.html).toContain('data-sw-enhanced'); // the carousel enhancer is present inline
    expect(body.html).not.toContain('<script defer'); // preview inlines; never LINKS a bundle
    expect(body.token).toBeTruthy();
  });
});
