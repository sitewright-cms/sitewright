import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the css-only Accordion (native <details>, no JS bundle) and the
// JS-backed Lightbox exercise both arms of the component pipeline through publish.

describe('Accordion + Lightbox → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-ga-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-ga-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('Accordion publishes its CSS inline but ships NO components.js (zero-JS component)', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'FAQ',
      root: {
        id: 'r',
        type: 'Accordion',
        children: [
          {
            id: 'i1',
            type: 'AccordionItem',
            props: { title: 'What?', open: true },
            children: [{ id: 'c', type: 'RichText', props: { text: 'Because.' } }],
          },
        ],
      },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<details data-sw-block="AccordionItem" open>');
    expect(index.body).toContain('<summary>What?</summary>');
    expect(index.body).toContain('[data-sw-block="AccordionItem"]'); // component CSS inlined
    // No JS bundle for a zero-JS component.
    expect(index.body).not.toContain('<script defer');
    expect((await client.get(`/sites/${slug}/components.js`)).statusCode).toBe(404);
  });

  it('Lightbox publishes a thumbnail grid (PE anchors) + a served components.js overlay', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'Gallery',
      root: {
        id: 'r',
        type: 'Lightbox',
        props: { label: 'Work' },
        children: [
          { id: 'p1', type: 'LightboxItem', props: { image: '/full1.jpg', alt: 'A', caption: 'One' } },
          { id: 'p2', type: 'LightboxItem', props: { image: '/full2.jpg', thumb: '/t2.jpg', alt: 'B' } },
        ],
      },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('data-sw-component="lightbox"');
    // PE fallback: each item is an anchor to the full image (works with no JS).
    expect(index.body).toContain('data-sw-part="item" href="full1.jpg"');
    expect(index.body).toContain('data-caption="One"');
    expect(index.body).toContain('[data-sw-part="overlay"]'); // component CSS inlined
    expect(index.body).toContain('<script defer src="components.js"></script>');

    const bundle = await client.get(`/sites/${slug}/components.js`);
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers['content-type']).toContain('javascript');
    expect(bundle.body).toContain('data-sw-component="lightbox"');
  });

  it('previews a Lightbox live — inlined CSS + behavior (sandbox-CSP doc)', async () => {
    const page = {
      id: 'home',
      path: '',
      title: 'Gallery',
      root: {
        id: 'r',
        type: 'Lightbox',
        children: [{ id: 'p1', type: 'LightboxItem', props: { image: '/f.jpg', alt: 'A' } }],
      },
    };
    const res = await client.post(`/projects/${projectId}/preview`, page);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    expect(body.html).toContain('data-sw-component="lightbox"');
    expect(body.html).toContain('[data-sw-part="overlay"]'); // CSS inlined
    expect(body.html).toContain('<script>'); // behavior inlined (preview runs scripts)
    expect(body.html).toContain('Image viewer'); // lightbox dialog enhancer present inline
    expect(body.token).toBeTruthy(); // a preview token is issued for the doc endpoint
  });
});
