import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

// Code-first preview (POST /projects/:id/preview) renders the page `source` in the worker pool and
// wraps it in the sandboxed document shell. These cover the branches the deleted block-tree preview
// tests used to hit: a template-referencing page, a page that loops `page.children`, a source-less
// page (empty body), and a render error → 400.
const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

describe('code-first preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-pcf-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-pcf-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const previewHtml = async (page: unknown): Promise<string> => {
    const res = await client.post(`/projects/${projectId}/preview`, page);
    expect(res.statusCode).toBe(200);
    return (res.json() as { html: string }).html;
  };

  it('renders a code-first page source into the sandboxed shell, substituting {{ company.* }}', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1>{{ company.name }}</h1></section>',
    });
    expect(html).toContain('<main id="page-content"><section><h1>Site</h1></section></main>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('renders a page from its referenced TEMPLATE source (the page contributes only its data)', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('template', 'base', {
      id: 'base', name: 'Base', source: '<section><h1>{{ page.title }} — templated</h1></section>',
    })).statusCode).toBe(200);
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, template: 'base',
    });
    expect(html).toContain('Home — templated');
  });

  it('loops the previewed page’s child pages via {{#each page.children}}', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><h1>Home</h1></section>',
    })).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', {
      id: 'about', path: 'about', parent: 'home', title: 'About', root: { id: 'r2', type: 'Section' },
      source: '<section>About</section>', nav: { slots: ['header'] },
    })).statusCode).toBe(200);
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><ul>{{#each page.children}}<li>{{this.title}}</li>{{/each}}</ul></section>',
    });
    expect(html).toContain('<li>About</li>');
  });

  it('renders a source-less page as an empty body (no crash)', async () => {
    const html = await previewHtml({ id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } });
    expect(html).toContain('<main id="page-content"></main>');
  });

  it('inlines the animation / lazyload / ripple runtimes (and cart CSS) for their code-first markers', async () => {
    const html = await previewHtml({
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section><div data-aos="fade-up" class="waves-effect" data-bg="/hero.jpg" data-sw-cart>x</div></section>',
    });
    expect(html).toContain('aos-init'); // ANIMATION_CSS inlined
    expect(html).toContain('IntersectionObserver'); // ANIMATION_JS inlined
    expect(html).toContain('waves'); // RIPPLE runtime inlined
  });

  it('returns a 400 error envelope (never a raw 500) when the source fails to render', async () => {
    const res = await client.post(`/projects/${projectId}/preview`, {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<section>{{#each page.children}}<li>{{this.title}}</li></section>', // missing {{/each}}
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error?: string }).error).toBeTruthy();
  });
});
