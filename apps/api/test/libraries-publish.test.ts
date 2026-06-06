import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the lazy-load (`data-bg` / `lazyload`) and ripple (`waves-effect`)
// first-party runtimes ship ONLY when their marker is used — the components.js
// discipline — and the {{icon}} helper inlines a built-in SVG.

describe('lazyload + ripple runtimes → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-lib-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-lib-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function publishWith(source: string): Promise<string> {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source })).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    const res = await client.get(`/sites/${slug}/index.html`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('ships lazyload.js + CSS only when a page uses data-bg', async () => {
    const html = await publishWith('<section data-bg="/media/hero.jpg" class="h-64">Hero</section>');
    expect(html).toContain('data-bg="/media/hero.jpg"');
    expect(html).toContain('<script defer src="lazyload.js"></script>');
    expect(html).toContain('.lazyloaded'); // inline lazyload CSS
    const js = await client.get(`/sites/${slug}/lazyload.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('IntersectionObserver');
  });

  it('ships ripple.js + CSS only when a page uses waves-effect', async () => {
    const html = await publishWith('<a class="btn btn-primary waves-effect waves-light" href="/contact">Go</a>');
    expect(html).toContain('waves-effect waves-light');
    expect(html).toContain('<script defer src="ripple.js"></script>');
    expect(html).toContain('@keyframes sw-waves'); // inline ripple CSS
    const js = await client.get(`/sites/${slug}/ripple.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain("createElement('span')");
  });

  it('renders {{icon}} as an inline SVG in the published page', async () => {
    const html = await publishWith('<p>Next {{icon "arrow-right" "h-4 w-4"}}</p>');
    expect(html).toContain('<svg class="h-4 w-4"');
    expect(html).toContain('<path d="M5 12h14"'); // arrow-right body, raw
  });

  it('ships ripple.js when only a skeleton slot uses waves-effect', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { footer: '<footer><a class="btn waves-effect" href="/x">Footer CTA</a></footer>' },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const html = await publishWith('<main><h1>No ripple in the page body</h1></main>');
    expect(html).toContain('waves-effect'); // the slot
    expect(html).toContain('<script defer src="ripple.js"></script>');
  });

  it('a plain site ships NONE of the library runtimes', async () => {
    const html = await publishWith('<main><h1>Plain</h1></main>');
    expect(html).not.toContain('lazyload.js');
    expect(html).not.toContain('ripple.js');
    expect(html).not.toContain('waves-rippling');
    expect((await client.get(`/sites/${slug}/lazyload.js`)).statusCode).toBe(404);
    expect((await client.get(`/sites/${slug}/ripple.js`)).statusCode).toBe(404);
  });

  it('ships all three runtimes together when a page uses all markers', async () => {
    const html = await publishWith(
      '<section data-bg="/media/bg.jpg"><h1 data-aos="fade-up">Hi</h1>' +
        '<a class="btn waves-effect waves-light">Act</a></section>',
    );
    expect(html).toContain('<script defer src="animations.js"></script>');
    expect(html).toContain('<script defer src="lazyload.js"></script>');
    expect(html).toContain('<script defer src="ripple.js"></script>');
  });
});
