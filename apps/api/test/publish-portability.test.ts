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

// A tiny but valid 1x1 PNG — enough for the sharp pipeline to decode + optimize
// (mirrors media-api.test.ts; avoids a direct sharp dep in the API package).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

/** Builds a multipart/form-data body for a single `file` field. */
function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWPORTABILITYBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail]),
  };
}

/** A Section wrapping a Heading and an internal Link to `linkHref`. */
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
    root: {
      id: `${opts.id}-root`,
      type: 'Section',
      children: [
        { id: `${opts.id}-h`, type: 'Heading', props: { text: opts.heading, level: 1 } },
        { id: `${opts.id}-link`, type: 'Link', props: { text: opts.linkText, href: opts.linkHref } },
      ],
    },
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

  it('rewrites internal links to be PAGE-RELATIVE on a subpage (portability guarantee)', async () => {
    await putSettings({ name: 'Acme', colors: { primary: '#0a7' } });
    await putHomeAndAbout();
    await publish(2);

    // The subpage lives at /about/index.html (one level deep). Its link back to
    // the home page ("/") must be rebased to "../", and a self/sibling link
    // ("/about") to "../about" — NOT the absolute "/about". This is what makes
    // the exported artifact work at any base path.
    const about = await fetchSite('about/');
    expect(about).toContain('data-sw-block="Link"');
    expect(about).toContain('href="../"');
    expect(about).not.toContain('href="/about"');
    expect(about).not.toContain('href="/"');

    // The home page (site root, relativeRoot = '') emits the sibling subpage as
    // a bare relative path "about", never the absolute "/about".
    const home = await fetchSite('');
    expect(home).toContain('href="about"');
    expect(home).not.toContain('href="/about"');
    expect(home).not.toContain('href="/"');
  });

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

  it('bundles uploaded media and emits page-relative <picture> URLs', async () => {
    await putSettings({ name: 'Acme', colors: { primary: '#0a7' } });
    const project = client.project(projectId);

    // Upload a real image through the media pipeline (optimize → variants).
    const up = await client.inject({
      method: 'POST',
      url: `${project.base}/media`,
      ...multipart('hero.png', 'image/png', PNG_1X1),
    });
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: { id: string; url: string } }).item;

    // A home page and an /about subpage, each with an Image referencing the asset.
    const imagePage = (id: string, path: string, title: string) => ({
      id,
      path,
      title,
      root: {
        id: `${id}-root`,
        type: 'Section',
        children: [{ id: `${id}-img`, type: 'Image', props: { src: asset.url, alt: 'Hero' } }],
      },
    });
    expect((await project.putContent('page', 'home', imagePage('home', '', 'Home'))).statusCode).toBe(200);
    expect((await project.putContent('page', 'about', imagePage('about', 'about', 'About'))).statusCode).toBe(200);
    await publish(2);

    // The binaries were copied into the artifact under _assets/<assetId>/ (the
    // published-site dir is keyed by slug).
    const mediaDir = await readdir(join(publishRoot, slug, '_assets', asset.id));
    expect(mediaDir.length).toBeGreaterThan(0);

    // Home (site root): <picture> srcset references are bare-relative `_assets/...`.
    const home = await fetchSite('');
    expect(home).toContain('<picture');
    expect(home).toContain(`src="_assets/${asset.id}/`);
    expect(home).not.toContain(`src="/media/${asset.id}/`);

    // Subpage (one level deep): the same asset is referenced page-relative `../_assets/...`.
    const about = await fetchSite('about/');
    expect(about).toContain('<picture');
    expect(about).toContain(`../_assets/${asset.id}/`);
    expect(about).not.toContain(`src="/media/${asset.id}/`);

    // The bundled image binary is served over HTTP at /sites/<slug>/_assets/<id>/<file>,
    // inline with an image content-type + nosniff (so the demo's LOCAL images actually load
    // in the /sites preview, not just in a deployed copy).
    const fallbackFile = asset.url.split('/').pop()!;
    const bin = await client.get(`/sites/${slug}/_assets/${asset.id}/${fallbackFile}`);
    expect(bin.statusCode).toBe(200);
    expect(bin.headers['content-type']).toMatch(/^image\//);
    expect(bin.headers['x-content-type-options']).toBe('nosniff');

    // A page request lacking its trailing slash is redirected (301) to the canonical directory
    // URL, so its relative asset paths resolve. Explicit .html URLs are served as-is.
    const noSlash = await client.get(`/sites/${slug}/about`);
    expect(noSlash.statusCode).toBe(301);
    expect(noSlash.headers.location).toBe(`/sites/${slug}/about/`);
    const explicit = await client.get(`/sites/${slug}/index.html`);
    expect(explicit.statusCode).toBe(200);
  });
});
