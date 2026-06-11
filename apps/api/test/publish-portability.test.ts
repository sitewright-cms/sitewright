import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// ---------------------------------------------------------------------------
// Integration suite: the publish/export pipeline must produce a PORTABLE,
// correct static site. "Portable" = the exported artifact works unchanged at
// any base path (webspace root, a subfolder, or the /sites/<id>/ preview),
// which requires internal links + asset paths to be PAGE-RELATIVE, not
// absolute. We drive the real API end-to-end (content PUT → publish → fetch
// the served HTML at /sites/...) using the shared harness, configured for the
// in-process build runner (default — no SW_BUILD_WORKER, so no Docker).
// ---------------------------------------------------------------------------

/** A code-first page: a `<section>` with a heading and an internal link to `linkHref`. */
function sectionPage(opts: {
  id: string;
  path: string;
  title: string;
  heading: string;
  linkHref: string;
  linkText: string;
  /** Extra flat page fields (e.g. a `title` override or `description`/`image`) merged onto the page. */
  extra?: Record<string, unknown>;
}) {
  return {
    id: opts.id,
    path: opts.path,
    title: opts.title,
    ...(opts.extra ?? {}),
    root: { id: `${opts.id}-root`, type: 'Section' },
    // Internal href via {{sw-url}} so the publisher rebases it page-relative for a portable export.
    source: `<section><h1>${opts.heading}</h1><a href="{{sw-url '${opts.linkHref}'}}">${opts.linkText}</a></section>`,
  };
}

describe('publish portability', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'portable-site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-portability-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-portability-media-'));
    // In-process build runner (default): no SW_BUILD_WORKER → runs without Docker.
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Portable Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  /** Publishes the project and asserts a 200 + the expected route count. */
  async function publish(expectedRoutes: number) {
    const pub = await client.post(`${client.project(projectId).base}/publish`);
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as { release: { routes: number }; url: string };
    expect(body.url).toBe(`/sites/${slug}/`);
    expect(body.release.routes).toBe(expectedRoutes);
    return body;
  }

  /** Fetches an exported HTML document at `/sites/<slug>/<path>`. */
  async function fetchSite(path: string): Promise<string> {
    const res = await client.get(`/sites/${slug}/${path}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    return res.body;
  }

  /** PUT a home page + an /about subpage that link to each other via root-relative hrefs. */
  async function putHomeAndAbout(extra?: { home?: Record<string, unknown>; about?: Record<string, unknown> }) {
    const project = client.project(projectId);
    const home = sectionPage({
      id: 'home',
      path: '',
      title: 'Home',
      heading: 'Welcome Home',
      linkHref: '/about', // root-relative internal link
      linkText: 'About us',
      extra: extra?.home,
    });
    const about = sectionPage({
      id: 'about',
      path: 'about',
      title: 'About',
      heading: 'About Page',
      linkHref: '/', // root-relative internal link back to home
      linkText: 'Back home',
      extra: extra?.about,
    });
    expect((await project.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await project.putContent('page', 'about', about)).statusCode).toBe(200);
  }

  /** PUT the project settings singleton (brand + locales). */
  async function putSettings(brand: Record<string, unknown>) {
    const project = client.project(projectId);
    const res = await project.putContent('settings', 'settings', {
      brand,
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    expect(res.statusCode).toBe(200);
  }

  it('emits a data-driven document head (title, description/og, theme-color)', async () => {
    await putSettings({ name: 'Acme', colors: { primary: '#0a7' } });
    await putHomeAndAbout({
      home: { title: 'Home — Acme', description: 'The Acme home page' },
    });
    await publish(2);

    const home = await fetchSite('');
    // <title> resolves to the page title.
    expect(home).toContain('<title>Home — Acme</title>');
    // page.description → <meta name="description"> and og:description.
    expect(home).toContain('<meta name="description" content="The Acme home page" />');
    expect(home).toContain('<meta property="og:description" content="The Acme home page" />');
    // og:title and og:type are always present.
    expect(home).toContain('<meta property="og:title" content="Home — Acme" />');
    expect(home).toContain('<meta property="og:type" content="website" />');
    // theme-color is driven by the brand primary color.
    expect(home).toContain('<meta name="theme-color" content="#0a7" />');

    // A page WITHOUT explicit SEO falls back to the page title and emits no description meta.
    const about = await fetchSite('about/');
    expect(about).toContain('<title>About</title>');
    expect(about).not.toContain('<meta name="description"');
  });

  it('omits the schema.org JSON-LD block when no organization data drives it', async () => {
    // schemaOrgJsonLd is gated on an `organization`, which buildSite derives from
    // the settings singleton's `company`. This test sets only brand (no company),
    // so no organization is produced and no JSON-LD is emitted. (The populated
    // case is covered in company-publish.test.ts.)
    await putSettings({ name: 'Acme', colors: { primary: '#0a7' } });
    await putHomeAndAbout();
    await publish(2);

    const home = await fetchSite('');
    expect(home).not.toContain('application/ld+json');
    const about = await fetchSite('about/');
    expect(about).not.toContain('application/ld+json');
  });

  it('writes a release manifest and reports the route count', async () => {
    await putSettings({ name: 'Acme', colors: { primary: '#0a7' } });
    await putHomeAndAbout();
    const body = await publish(2);

    // The publish response carries the manifest.
    expect(body.release.routes).toBe(2);

    // release.json is present in the published output directory (keyed by slug).
    const siteDir = join(publishRoot, slug);
    const entries = await readdir(siteDir);
    expect(entries).toContain('release.json');
    const manifest = JSON.parse(await readFile(join(siteDir, 'release.json'), 'utf8')) as {
      routes: number;
      publishedAt: string;
      bytes: number;
    };
    expect(manifest.routes).toBe(2);
    expect(typeof manifest.publishedAt).toBe('string');
    expect(manifest.bytes).toBeGreaterThan(0);

    // The status endpoint also reports the release.
    const status = await client.get(`${client.project(projectId).base}/publish`);
    expect(status.statusCode).toBe(200);
    expect((status.json() as { release: { routes: number } }).release.routes).toBe(2);
  });

});
