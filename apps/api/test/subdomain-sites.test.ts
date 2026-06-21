import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Subdomain routing for locally-hosted sites: `<slug>.<sitesDomain>` serves that local site at the
// ROOT path (coexisting with the `/sites/<slug>/` path form). Driven by AppOptions.sitesDomain.

const home = {
  id: 'home',
  path: '',
  title: 'Home',
  source: '<section class="p-6"><h1 class="text-2xl font-bold">Hello world</h1></section>',
};
const about = { id: 'about', path: 'about', title: 'About', source: '<section class="p-6"><h1>About us</h1></section>' };

describe('subdomain routing for local sites (sitesDomain)', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'example';
  const DOMAIN = 'agency.site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-subdomain-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-subdomain-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, sitesDomain: DOMAIN });
    client = await harness.signup();
    projectId = await client.createProject('Example', slug, { localHosting: false });
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function seedAndPublish(targetOpts: Record<string, unknown> = {}) {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Example', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    await proj.putContent('page', 'home', home);
    await proj.putContent('page', 'about', about);
    await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local', ...targetOpts });
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
  }
  // A request to `<slug>.<DOMAIN>` (the session cookie is harmless — the /sites serve ignores it).
  const site = (url: string, cookies: Record<string, string> = {}) =>
    client.inject({ method: 'GET', url, headers: { host: `${slug}.${DOMAIN}` }, cookies });

  it('serves the local site at the subdomain ROOT, with root-relative redirects', async () => {
    await seedAndPublish();
    const root = await site('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('Hello world');
    // a subpage missing its trailing slash → a ROOT-relative 301 (NOT /sites/<slug>/about/)
    const redir = await site('/about');
    expect(redir.statusCode).toBe(301);
    expect(redir.headers.location).toBe('/about/');
    expect((await site('/about/')).body).toContain('About us');
    // a static asset serves at the subdomain root too
    expect((await site('/styles.css')).statusCode).toBe(200);
  });

  it('the apex and `www` are NOT treated as a site (API/editor live there)', async () => {
    await seedAndPublish();
    const apex = await client.inject({ method: 'GET', url: '/', headers: { host: DOMAIN } });
    expect(apex.body).not.toContain('Hello world');
    const www = await client.inject({ method: 'GET', url: '/', headers: { host: `www.${DOMAIN}` } });
    expect(www.body).not.toContain('Hello world');
  });

  it('the /sites/<slug>/ PATH form still works (coexists)', async () => {
    await seedAndPublish();
    const r = await client.inject({ method: 'GET', url: `/sites/${slug}/`, headers: { host: DOMAIN } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Hello world');
  });

  it('publishStatus returns the SUBDOMAIN url as canonical when sitesDomain is set', async () => {
    await seedAndPublish();
    const st = await client.get(`/projects/${projectId}/publish`);
    expect((st.json() as { url: string }).url).toBe(`//${slug}.${DOMAIN}/`);
  });

  it('runs a bundled .js on the isolated subdomain origin, but keeps it download-only on the path form', async () => {
    await seedAndPublish();
    // Drop a bundled (imported) script into the published tree (`_assets/<id>/file/<name>.js`).
    const jsDir = join(publishRoot, slug, '_assets', 'imp', 'file');
    await mkdir(jsDir, { recursive: true });
    await writeFile(join(jsDir, 'app.js'), 'console.log(1)');

    // Via the subdomain `<slug>.<DOMAIN>` — a SEPARATE origin from the editor/API (host-only session
    // cookie never sent there) — the imported script is runnable text/javascript.
    const viaSub = await site('/_assets/imp/file/app.js');
    expect(viaSub.statusCode).toBe(200);
    expect(viaSub.headers['content-type']).toContain('text/javascript');
    expect(viaSub.headers['content-disposition']).toBeUndefined();
    // Content-type depends on Host under an immutable cache → must vary on Host.
    expect(viaSub.headers['vary']).toBe('Host');

    // Via the app-origin `/sites/<slug>/` PATH form (no sitesDomain host) it stays download-only +
    // inert — the platform origin is cookie-bearing, so foreign JS must never execute there.
    const viaPath = await client.inject({ method: 'GET', url: `/sites/${slug}/_assets/imp/file/app.js` });
    expect(viaPath.statusCode).toBe(200);
    expect(viaPath.headers['content-type']).toContain('application/octet-stream');
    expect(viaPath.headers['content-disposition']).toContain('attachment');
  });

  it('a token-gated site via subdomain sets a ROOT-scoped cookie + redirects clean', async () => {
    await seedAndPublish({ previewToken: 'tok_abcdefgh12345678' });
    expect((await site('/')).statusCode).toBe(403); // no token, no cookie
    const entry = await site('/?token=tok_abcdefgh12345678');
    expect(entry.statusCode).toBe(302);
    expect(entry.headers.location).toBe('/'); // clean root URL, token stripped
    const cookie = entry.cookies.find((c) => c.name === `sw_site_${slug}`);
    expect(cookie?.path).toBe('/'); // root-scoped (not /sites/<slug>/)
    expect((await site('/', { [`sw_site_${slug}`]: 'tok_abcdefgh12345678' })).statusCode).toBe(200);
  });
});
