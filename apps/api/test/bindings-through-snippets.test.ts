import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOBAL_SNIPPET_PARTIALS, type ProjectBundle } from '@sitewright/core';
import { renderTemplate, type TemplateContext } from '@sitewright/blocks';
import { buildSite } from '../src/publish/build.js';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

// The expensive page bindings — page.parent, page.children, page.code, pages.*, item.*, sw-page-url — are
// built REFERENCED-ONLY: a render gets one only when its source names it. The gate used to read the page's
// OWN text alone, so a page that composed `{{> page-hero}}` whose snippet read `{{page.parent.title}}` got
// nothing at all: no error, just an empty back link (and an empty grid for a snippet looping
// `@root.pages.features._attributes.children`). The gate now reads everything the render can reach — the
// page, every snippet it includes (transitively), and the chrome slots that share its context — and a page
// that names a binding NOWHERE still skips building it. Both surfaces are pinned: publish and the editor.

// Call-through spy: the build renders for real, and a test can read the context each render was given.
vi.mock('@sitewright/blocks', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sitewright/blocks')>();
  return { ...mod, renderTemplate: vi.fn(mod.renderTemplate) };
});

const root = { id: 'r', type: 'Section' as const };

// home ─┬─ services (the page under test) ─┬─ seo
//       │                                  └─ ads
//       └─ features ─┬─ alpha
//                    └─ beta
const OTHER_PAGES = [
  { id: 'home', path: '', title: 'Home', source: '<p>home</p>' },
  { id: 'seo', path: 'seo', parent: 'services', title: 'SEO', order: 1, source: '<p>seo</p>' },
  { id: 'ads', path: 'ads', parent: 'services', title: 'Ads', order: 2, source: '<p>ads</p>' },
  { id: 'features', path: 'features', parent: 'home', title: 'Features', source: '<p>features</p>' },
  { id: 'alpha', path: 'alpha', parent: 'features', title: 'Alpha', order: 1, source: '<p>alpha</p>' },
  { id: 'beta', path: 'beta', parent: 'features', title: 'Beta', order: 2, source: '<p>beta</p>' },
];
const SERVICES = { id: 'services', path: 'services', parent: 'home', title: 'Services' };

// Every binding below is named ONLY inside a snippet — never in the text of the page that includes it.
const SNIPPETS: Record<string, string> = {
  'page-hero': '<p class="up">Back to {{page.parent.title}}</p>',
  'feature-grid': '<ul class="grid">{{#each pages.features._attributes.children}}<li>{{title}}</li>{{/each}}</ul>',
  // The form a snippet needs from inside a loop, where the current context is the loop item.
  'feature-next': '<ul class="next">{{#each @root.pages.features._attributes.children}}<li>{{title}}</li>{{/each}}</ul>',
  // Composes another snippet — the binding is two includes away from the page.
  'section-shell': '<section>{{> child-list}}</section>',
  'child-list': '<ul class="kids">{{#each page.children}}<li>{{title}}</li>{{/each}}</ul>',
  'view-source': '<pre class="code">{{page.code}}</pre>',
  'team-lead': '<p class="lead">{{item.team.lead.name}}</p>',
  'features-link': '<a class="pu" href="{{sw-page-url "features"}}">features</a>',
};
const TEAM_DATASET = { id: 'team', name: 'Team', slug: 'team', fields: [{ name: 'name', type: 'text', required: false, localized: false }] };
const TEAM_LEAD = { id: 'lead', dataset: 'team', status: 'published', values: { name: 'Ada' } };

/** The href of the anchor carrying `cls`, or undefined when the anchor is missing. */
const hrefOf = (html: string, cls: string): string | undefined => new RegExp(`class="${cls}" href="([^"]*)"`).exec(html)?.[1];

/** The context the PAGE BODY was rendered with — the render whose source is `source` and that carries partials. */
function bodyContext(calls: ReadonlyArray<readonly unknown[]>, source: string): TemplateContext {
  const call = calls.find(([src, ctx]) => src === source && (ctx as TemplateContext).partials);
  if (!call) throw new Error(`no body render of ${source}`);
  return call[1] as TemplateContext;
}

describe('publish: a binding named only inside a snippet is built', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'sw-snippet-bindings-'));
    vi.mocked(renderTemplate).mockClear();
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  /** Build the site with the services page given `over` (its source, or a template ref). */
  const build = (over: Record<string, unknown>, opts: { bundle?: Partial<ProjectBundle>; snippets?: Record<string, string> } = {}) =>
    buildSite({
      publishedAt: '2026-11-28T00:00:00.000Z',
      outDir,
      snippets: opts.snippets ?? SNIPPETS,
      bundle: {
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
        pages: [...OTHER_PAGES, { ...SERVICES, ...over }],
        datasets: [TEAM_DATASET],
        entries: [TEAM_LEAD],
        ...opts.bundle,
      } as ProjectBundle,
    });
  const servicesHtml = (): Promise<string> => readFile(join(outDir, 'services', 'index.html'), 'utf8');

  it('page.parent read by a project snippet', async () => {
    await build({ source: '<div>{{> page-hero}}</div>' });
    expect(await servicesHtml()).toContain('<p class="up">Back to Home</p>');
  });

  it('a pages.<path>._attributes.children listing in a snippet — plain and @root form', async () => {
    await build({ source: '<div>{{> feature-grid}}{{> feature-next}}</div>' });
    const html = await servicesHtml();
    expect(html).toContain('<ul class="grid"><li>Alpha</li><li>Beta</li></ul>');
    expect(html).toContain('<ul class="next"><li>Alpha</li><li>Beta</li></ul>');
  });

  it('page.children read by a snippet that another snippet includes', async () => {
    await build({ source: '<div>{{> section-shell}}</div>' });
    expect(await servicesHtml()).toContain('<ul class="kids"><li>SEO</li><li>Ads</li></ul>');
  });

  it('a page rendering from a TEMPLATE that includes the snippet', async () => {
    await build(
      { template: 'service-tpl' },
      { bundle: { templates: [{ id: 'service-tpl', name: 'Service', source: '<article>{{> page-hero}}</article>' }] } },
    );
    expect(await servicesHtml()).toContain('<article><p class="up">Back to Home</p></article>');
  });

  it('the built-in page-vars recipe from the global library', async () => {
    await build({ source: '{{> page-vars}}' }, { snippets: { ...GLOBAL_SNIPPET_PARTIALS } });
    const html = await servicesHtml();
    expect(html).toMatch(/>(?:&larr;|←) Home<\/a>/); // its page.parent back link
    expect(html).toContain('>SEO</span>'); // its page.children cards
    expect(html).toContain('>Ads</span>');
  });

  it('page.code, item.<dataset>.<id> and sw-page-url read by snippets', async () => {
    await build({ source: '<div>{{> view-source}}{{> team-lead}}{{> features-link}}</div>' });
    const html = await servicesHtml();
    expect(html, 'page.code').toMatch(/<pre class="code">&lt;div&gt;/);
    expect(html, 'item').toContain('<p class="lead">Ada</p>');
    expect(hrefOf(html, 'pu'), 'sw-page-url').toBe('../features/');
  });

  it('page.parent read by a chrome SLOT, which shares the page’s render context', async () => {
    await build(
      { source: '<p>services</p>' },
      {
        bundle: {
          project: {
            formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
            identity: { name: 'Acme', colors: { primary: '#0a7' } },
            settings: { defaultLocale: 'en', locales: ['en'] },
            website: { footer: '<div class="ft">Up: {{page.parent.title}}</div>' },
          },
        },
      },
    );
    expect(await servicesHtml()).toContain('<div class="ft">Up: Home</div>');
  });

  it('★ builds NOTHING for a page that names none of them — an available, unincluded snippet does not count', async () => {
    const source = '<p>{{page.title}}</p>';
    await build({ source });
    const ctx = bodyContext(vi.mocked(renderTemplate).mock.calls, source);
    expect(ctx.parentPage).toBeUndefined();
    expect((ctx.page as { children: unknown[] }).children).toEqual([]);
    expect((ctx.page as { code: string }).code).toBe('');
    expect(ctx.pages).toBeUndefined();
    expect(ctx.pageUrls).toBeUndefined();
    expect(ctx.item).toEqual({});
  });

  it('★ builds only what the included snippet names — page.parent, not the children or the pages tree', async () => {
    const source = '<div>{{> page-hero}}</div>';
    await build({ source });
    const ctx = bodyContext(vi.mocked(renderTemplate).mock.calls, source);
    expect(ctx.parentPage).toMatchObject({ title: 'Home' });
    expect((ctx.page as { children: unknown[] }).children).toEqual([]);
    expect(ctx.pages).toBeUndefined();
  });

  it('★ the 4 MiB cross-page guard still fails a publish whose snippet names too much data', async () => {
    const huge = { id: 'archive', path: 'archive', parent: 'home', title: 'Archive', source: '<p>a</p>', data: { blob: 'x'.repeat(4.5 * 1024 * 1024) } };
    await expect(
      build(
        { source: '<div>{{> big-read}}</div>' },
        { snippets: { 'big-read': '{{pages.archive._attributes.data.blob}}' }, bundle: { pages: [...OTHER_PAGES, huge, { ...SERVICES, source: '<div>{{> big-read}}</div>' }] } },
      ),
    ).rejects.toThrow(/page "services" references too much cross-page data/);
  });
});

describe('editor preview + code-editor render: a binding named only inside a snippet is built', () => {
  let harness: Harness;
  let client: TestClient;
  let proj: ProjectClient;
  let projectId: string;
  let pool: RenderPool;
  let publishRoot: string;
  let mediaRoot: string;
  const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-snippet-bindings-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-snippet-bindings-media-'));
    pool = new RenderPool({ size: 1, workerPath });
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: pool });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
    proj = client.project(projectId);
    for (const p of [...OTHER_PAGES, { ...SERVICES, source: '<p>services</p>' }]) {
      expect((await proj.putContent('page', p.id, { ...p, root })).statusCode).toBe(200);
    }
    for (const [name, source] of Object.entries(SNIPPETS)) {
      expect((await proj.putContent('snippet', name, { id: name, name, source })).statusCode).toBe(200);
    }
    expect((await proj.putContent('dataset', 'team', TEAM_DATASET)).statusCode).toBe(200);
    expect((await proj.putContent('entry', 'lead', TEAM_LEAD)).statusCode).toBe(200);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const preview = async (over: Record<string, unknown>): Promise<string> => {
    const res = await client.post(`/projects/${projectId}/preview`, { ...SERVICES, root, ...over });
    expect(res.statusCode).toBe(200);
    return (res.json() as { html: string }).html;
  };

  it('page.parent read by a project snippet', async () => {
    expect(await preview({ source: '<div>{{> page-hero}}</div>' })).toContain('<p class="up">Back to Home</p>');
  });

  it('a pages.<path>._attributes.children listing in a snippet — plain and @root form', async () => {
    const html = await preview({ source: '<div>{{> feature-grid}}{{> feature-next}}</div>' });
    expect(html).toContain('<ul class="grid"><li>Alpha</li><li>Beta</li></ul>');
    expect(html).toContain('<ul class="next"><li>Alpha</li><li>Beta</li></ul>');
  });

  it('page.children read by a snippet that another snippet includes', async () => {
    expect(await preview({ source: '<div>{{> section-shell}}</div>' })).toContain('<ul class="kids"><li>SEO</li><li>Ads</li></ul>');
  });

  it('a page rendering from a TEMPLATE that includes the snippet', async () => {
    expect((await proj.putContent('template', 'service-tpl', { id: 'service-tpl', name: 'Service', source: '<article>{{> page-hero}}</article>' })).statusCode).toBe(200);
    expect(await preview({ template: 'service-tpl' })).toContain('<article><p class="up">Back to Home</p></article>');
  });

  it('page.code, item.<dataset>.<id> and sw-page-url read by snippets', async () => {
    const html = await preview({ source: '<div>{{> view-source}}{{> team-lead}}{{> features-link}}</div>' });
    expect(html, 'page.code').toMatch(/<pre class="code">&lt;div&gt;/);
    expect(html, 'item').toContain('<p class="lead">Ada</p>');
    expect(hrefOf(html, 'pu'), 'sw-page-url').toBe('/features/');
  });

  it('page.parent read by a chrome SLOT, which shares the page’s render context', async () => {
    expect((await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      website: { footer: '<div class="ft">Up: {{page.parent.title}}</div>' },
    })).statusCode).toBe(200);
    expect(await preview({ source: '<p>services</p>' })).toContain('<div class="ft">Up: Home</div>');
  });

  it('★ ships NOTHING to the render worker for a page that names none of them', async () => {
    const render = vi.spyOn(pool, 'render');
    const source = '<p>{{page.title}}</p>';
    await preview({ source });
    const ctx = bodyContext(render.mock.calls, source);
    expect(ctx.parentPage).toBeUndefined();
    expect((ctx.page as { children: unknown[] }).children).toEqual([]);
    expect((ctx.page as { code: string }).code).toBe('');
    expect(ctx.pages).toBeUndefined();
    expect(ctx.pageUrls).toBeUndefined();
    expect(ctx.item).toEqual({});
  });

  it('code-editor render (render_template): item.<dataset>.<id> and sw-page-url read by snippets', async () => {
    const res = await client.post(`/projects/${projectId}/render-template`, { template: '<div>{{> team-lead}}{{> features-link}}</div>' });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html, 'item').toContain('<p class="lead">Ada</p>');
    expect(hrefOf(html, 'pu'), 'sw-page-url').toBe('/features/');
  });
});
