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

  it('the /sites/<slug>/ PATH form 301-redirects to the isolated subdomain (retired on the app origin)', async () => {
    await seedAndPublish();
    // The app-origin path form is RETIRED: a published page now carries the owner's inline JS, which must
    // run only on the isolated subdomain — so the path form redirects there instead of serving it.
    const r = await client.inject({ method: 'GET', url: `/sites/${slug}/`, headers: { host: DOMAIN } });
    expect(r.statusCode).toBe(301);
    expect(r.headers.location).toBe(`http://${slug}.${DOMAIN}/`);
  });

  it('the retirement redirect does NOT open-redirect on a non-slug-shaped path param (%2F smuggling)', async () => {
    // find-my-way percent-decodes :slug AFTER matching, so `%2F` could smuggle a `/` into the redirect
    // AUTHORITY (`evil.com/x.<DOMAIN>` → browser sees host `evil.com`). A value that isn't a real project
    // slug must never produce an off-origin 301 — it falls through to the normal (404) project lookup.
    const r = await client.inject({ method: 'GET', url: '/sites/evil.com%2Fx/y', headers: { host: DOMAIN } });
    expect(r.statusCode).not.toBe(301);
    if (r.headers.location) expect(r.headers.location).not.toContain('evil.com');
    // A rejected slug whose tail looks like an asset must 404 cleanly (readAsset's dirFor throw is swallowed).
    const asset = await client.inject({ method: 'GET', url: '/sites/evil.com%2Fx/styles.css', headers: { host: DOMAIN } });
    expect(asset.statusCode).toBe(404);
  });

  it('publishStatus returns the PATH-form url as the preview link even when sitesDomain is set', async () => {
    // The "View live" link must be the dependable `/sites/<slug>/` path form — it works on the app
    // origin with no wildcard DNS. The subdomain still SERVES the site (asserted above), but advertising
    // `<slug>.<DOMAIN>` as the link 404s wherever `*.<DOMAIN>` isn't resolvable.
    await seedAndPublish();
    const st = await client.get(`/projects/${projectId}/publish`);
    expect((st.json() as { url: string }).url).toBe(`/sites/${slug}/`);
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

    // Via the app-origin `/sites/<slug>/` PATH form: RETIRED → the whole request 301-redirects to the
    // isolated subdomain. The app origin never serves the published tree (page OR asset), so foreign JS
    // can never execute on the cookie-bearing origin — the redirect is the boundary.
    const viaPath = await client.inject({ method: 'GET', url: `/sites/${slug}/_assets/imp/file/app.js`, headers: { host: DOMAIN } });
    expect(viaPath.statusCode).toBe(301);
    expect(viaPath.headers.location).toBe(`http://${slug}.${DOMAIN}/_assets/imp/file/app.js`);
  });

  it('routes a form post to the platform /f/ endpoint even when reached via the subdomain host', async () => {
    // A locally-hosted site served at `<slug>.<DOMAIN>` posts to the root-relative `/f/<pid>/<form>`,
    // which resolves to the subdomain origin. rewriteUrl must NOT rewrite that into `/sites/<slug>/f/…`
    // (a site asset → 404); the public form endpoint has to reach the platform route. Without the
    // carve-out this POST 404s. (No publish needed — `/f/` reads the form from the content store; this
    // exercises the routing carve-out, not the full published-page round-trip, which the E2E covers.)
    await client.project(projectId).putContent('form', 'contact', {
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email' }],
      recipient: 'x@acme.example',
    });
    const host = `${slug}.${DOMAIN}`;
    const pre = await client.inject({ method: 'OPTIONS', url: `/f/${projectId}/contact`, headers: { host } });
    expect(pre.statusCode).toBe(204); // preflight reaches the route via the subdomain too
    const post = await client.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      headers: { host },
      payload: { email: 'lead@x.co', _elapsed: '5000' },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ ok: true });
    // It genuinely stored (the post reached the platform endpoint, not the site 404).
    const inbox = await client.get(`/projects/${projectId}/submissions`);
    expect((inbox.json() as { total: number }).total).toBe(1);
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

describe('app-origin /sites/ fallback CSP (no sites domain configured)', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'example';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-fallback-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-fallback-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot }); // NO sitesDomain → path form serves (no redirect)
    client = await harness.signup();
    projectId = await client.createProject('Example', slug, { localHosting: false });
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('serves the path form with a FIXED strict CSP — an author-spoofed <meta> cannot re-enable inline JS', async () => {
    const proj = client.project(projectId);
    // website.head is an UNFILTERED author sink: inject a spoofed CSP meta that dodges a literal string-strip
    // (reordered tokens). The served RESPONSE HEADER must still pin script-src to 'self' (no unsafe-inline).
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Example', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      website: { head: `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' 'self'">` },
    });
    await proj.putContent('page', 'home', home);
    await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local' });
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);

    const r = await client.inject({ method: 'GET', url: `/sites/${slug}/` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("script-src 'unsafe-inline' 'self'"); // the spoofed meta IS in the HTML body…
    const csp = r.headers['content-security-policy'] as string;
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self'"); // …but the enforced RESPONSE-HEADER floor blocks inline JS
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
