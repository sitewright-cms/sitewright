import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: project-wide website settings (the website.* namespace) — critical
// CSS + custom head/footer HTML — stored in the settings singleton must flow
// through publish into the exported document head/body.

const home = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi', level: 1 } }] },
};

describe('website settings → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'classcar';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-website-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-website-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('ClassCar', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function putSettings(website: Record<string, unknown> | undefined) {
    const proj = client.project(projectId);
    const payload = {
      brand: { name: 'ClassCar', colors: { primary: '#e11' } },
      ...(website ? { website } : {}),
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect((await proj.putContent('settings', 'settings', payload)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
  }

  async function publishAndFetchHome(): Promise<string> {
    const pub = await client.post(`${client.project(projectId).base}/publish`);
    expect(pub.statusCode).toBe(200);
    const res = await client.get(`/sites/${slug}/index.html`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('inlines critical CSS and injects the raw head/scripts blobs into the exported site', async () => {
    await putSettings({
      criticalCss: '.hero{color:#e11}',
      head: '<!-- plausible-analytics -->',
      scripts: '<script id="cf">/*footer*/</script>',
    });
    const html = await publishAndFetchHome();

    expect(html).toContain('<style>.hero{color:#e11}</style>');
    expect(html).toContain('<!-- plausible-analytics -->');
    expect(html).toContain('<script id="cf">/*footer*/</script>');
    // critical CSS + head sit in <head>; the scripts blob sits after the body
    expect(html.indexOf('.hero{color:#e11}')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('id="cf"')).toBeGreaterThan(html.indexOf('</head>'));
  });

  it('fails the publish with 409 when jsonDataUrl targets a private host (SSRF guard)', async () => {
    // The URL passes the schema (valid https) but the publish-time fetch refuses a private host —
    // hermetic: targetsPrivateHost rejects it before any network call.
    await putSettings({ jsonDataUrl: 'https://localhost/data.json' });
    const pub = await client.post(`${client.project(projectId).base}/publish`);
    expect(pub.statusCode).toBe(409);
    expect((pub.json() as { error: string }).error).toMatch(/public https/i);
  });

  it('migrates legacy customHead/customFooter on the write path (old clients keep working)', async () => {
    // A PUT carrying the retired field names is migrated by the schema before storage.
    await putSettings({ customHead: '<!-- legacy-head -->', customFooter: '<i id="lf">legacy</i>' });
    const html = await publishAndFetchHome();
    expect(html).toContain('<!-- legacy-head -->'); // mapped to head → <head>
    expect(html).toContain('<i id="lf">legacy</i>'); // mapped to scripts → after body
    expect(html.indexOf('legacy-head')).toBeLessThan(html.indexOf('</head>'));
    // And it is stored/exported under the NEW names.
    const exp = await client.project(projectId).exportBundle();
    const w = (exp.json() as { project: { website: Record<string, unknown> } }).project.website;
    expect(w.head).toBe('<!-- legacy-head -->');
    expect(w.scripts).toBe('<i id="lf">legacy</i>');
    expect('customHead' in w).toBe(false);
  });

  it('exposes the editable website.data object to the published site ({{website.data.*}} + {{#each}})', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('settings', 'settings', {
      brand: { name: 'ClassCar', colors: { primary: '#e11' } },
      website: { data: { hero: { headline: 'Published copy' }, tags: ['a', 'b'] } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    })).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      source: '<div><h1>{{website.data.hero.headline}}</h1><ul>{{#each website.data.tags}}<li>{{this}}</li>{{/each}}</ul></div>',
    })).statusCode).toBe(200);
    const html = await publishAndFetchHome();
    expect(html).toContain('<h1>Published copy</h1>'); // keyed lookup
    expect(html).toContain('<li>a</li><li>b</li>'); // {{#each}} over a website.data array
    // The page body is wrapped in the skeleton's <main id="page-content"> landmark; no preview wrapper.
    expect(html).toContain('<body><main id="page-content"><div><h1>Published copy</h1>');
  });

  it('exposes a page’s own page.data to the published page ({{page.data.*}} + {{#each}})', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('settings', 'settings', {
      brand: { name: 'ClassCar', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    })).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
      data: { hero: { headline: 'Page-local copy' }, tags: ['a', 'b'] },
      source: '<div><h1>{{page.data.hero.headline}}</h1><ul>{{#each page.data.tags}}<li>{{this}}</li>{{/each}}</ul></div>',
    })).statusCode).toBe(200);
    const html = await publishAndFetchHome();
    expect(html).toContain('<h1>Page-local copy</h1>');
    expect(html).toContain('<li>a</li><li>b</li>');
  });

  it('exposes page.children (flattened child pages + their data) to a parent page on publish', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('settings', 'settings', { brand: { name: 'ClassCar', colors: { primary: '#e11' } }, settings: { defaultLocale: 'en', locales: ['en'] } })).statusCode).toBe(200);
    const node = { id: 'r', type: 'Section' };
    await proj.putContent('page', 'a1', { id: 'a1', path: 'first', parent: 'home', title: 'First', order: 1, description: 'One', data: { tag: 'x' }, root: node });
    await proj.putContent('page', 'a2', { id: 'a2', path: 'second', parent: 'home', title: 'Second', order: 2, description: 'Two', data: { tag: 'y' }, root: node });
    // A DRAFT child must NOT appear in the published overview (parity with nav/sitemap).
    await proj.putContent('page', 'a3', { id: 'a3', path: 'third', parent: 'home', title: 'DraftArticle', status: 'draft', order: 3, root: node });
    expect((await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root: node,
      source: '<div>{{#each page.children}}<a href="{{sw-url path}}"><h3>{{title}}</h3><p>{{description}}</p><span>{{data.tag}}</span></a>{{/each}}</div>',
    })).statusCode).toBe(200);
    const html = await publishAndFetchHome();
    expect(html).toContain('<h3>First</h3>');
    expect(html).toContain('<h3>Second</h3>');
    expect(html).toContain('<p>One</p>'); // the child's page.description
    expect(html).toContain('<span>x</span>'); // the child's page.data, read in the loop
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second')); // ordered by `order`
    expect(html).toContain('<a href="first">'); // {{sw-url path}} → portable relative link to the child page
    expect(html).not.toContain('DraftArticle'); // the draft child is excluded from publish
  });

  it('omits the optional website injections when not configured', async () => {
    await putSettings(undefined);
    const html = await publishAndFetchHome();
    expect(html).not.toContain('plausible-analytics');
    expect(html).not.toContain('<style>.hero');
  });

  it('preserves website settings across an import → export round-trip', async () => {
    const proj = client.project(projectId);
    const website = { criticalCss: '.x{}', head: '<meta name="x">', scripts: '<b>f</b>' };
    const imp = await proj.importBundle({
      project: { brand: { name: 'B', colors: {} }, website, settings: { defaultLocale: 'en', locales: ['en'] } },
      pages: [home],
    });
    expect(imp.statusCode).toBe(200);
    const exp = await proj.exportBundle();
    expect(exp.statusCode).toBe(200);
    expect((exp.json() as { project: { website: unknown } }).project.website).toEqual(website);
  });
});
