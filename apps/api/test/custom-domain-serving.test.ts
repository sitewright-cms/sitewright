import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Serving a locally-hosted site at a VERIFIED custom domain. The custom host and the
// `<slug>.<sitesDomain>` subdomain are two ways into the same serving path, and the point of these
// tests is that they behave identically where it matters — URL rewriting, whether the site's own JS may
// execute, and which single address the site advertises.

const DOMAIN = 'agency.site';
const CUSTOM = 'www.clientbrand.com';
const slug = 'example';

const home = {
  kind: 'page' as const,
  title: 'Home',
  path: '',
  // An inline script: it may run ONLY on an isolated host, never on the cookie-bearing app origin.
  source: '<h1>Home</h1><script>window.__ran = true;</script>',
};

describe('custom domain serving', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;
  let txt: string[][] = [];

  beforeEach(async () => {
    txt = [];
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-customdom-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-customdom-media-'));
    harness = await makeHarness({
      publishRoot,
      mediaRoot,
      sitesDomain: DOMAIN,
      // ★ The app host is deliberately OUTSIDE `sitesDomain`: a platform host inside it would be
      // rewritten into the site namespace and the app would be unreachable (see the boot warning in
      // server.ts). `agency.site` is the hosted-sites domain; the app lives on another name entirely.
      publicUrl: 'https://cms.agency.com',
      txtLookup: async () => txt,
    });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Example', slug, { localHosting: false });
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function seedAndPublish() {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Example', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    await proj.putContent('page', 'home', home);
    await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local' });
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
  }

  /** Claims `host` and verifies it through the real routes, so the routing map is built the real way. */
  async function claimAndVerify(host: string) {
    const claimed = (await client.post(`/projects/${projectId}/domains`, { host })).json().domain;
    txt = [[claimed.verificationToken]];
    const res = await client.post(`/projects/${projectId}/domains/${claimed.id}/verify`);
    expect(res.json()).toMatchObject({ verified: true });
    return claimed;
  }

    const APP_HOST = 'cms.agency.com';
  // `x-forwarded-proto: https` mirrors the TLS-terminating proxy every real deployment runs behind, so
  // the redirects under test carry the scheme a browser would actually see.
  const get = (url: string, host: string) =>
    client.inject({ method: 'GET', url, headers: { host, 'x-forwarded-proto': 'https' } });

  it('serves the site at the ROOT of a verified custom domain', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);

    const res = await get('/', CUSTOM);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<h1>Home</h1>');
  });

  it('★ does NOT serve on a claimed-but-unverified host', async () => {
    await seedAndPublish();
    await client.post(`/projects/${projectId}/domains`, { host: CUSTOM });
    // A claim is inert: the hostname is reserved, but nothing is routed to it until DNS proves control.
    const res = await get('/', CUSTOM);
    expect(res.body).not.toContain('<h1>Home</h1>');
  });

  it('stops serving when the domain is released, and starts again when re-verified', async () => {
    await seedAndPublish();
    const d = await claimAndVerify(CUSTOM);
    expect((await get('/', CUSTOM)).statusCode).toBe(200);

    await client.del(`/projects/${projectId}/domains/${d.id}`);
    expect((await get('/', CUSTOM)).body).not.toContain('<h1>Home</h1>');

    await claimAndVerify(CUSTOM);
    expect((await get('/', CUSTOM)).body).toContain('<h1>Home</h1>');
  });

  it('★ a RENAMED project keeps serving its custom domain (the map stores the slug)', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    expect((await get('/', CUSTOM)).statusCode).toBe(200);

    // Anything keyed by the slug must move when the slug changes — the map is keyed by host but TARGETS
    // the slug, so a rename would otherwise 404 every custom domain until the next restart.
    const renamed = await client.patch(`/projects/${projectId}`, { slug: 'renamed-example' });
    expect(renamed.statusCode).toBe(200);
    await client.post(`/projects/${projectId}/publish`);
    expect((await get('/', CUSTOM)).statusCode).toBe(200);
  });

  it('★ a SOFT-DELETED project stops serving its custom domain, and a restore brings it back', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    await client.del(`/projects/${projectId}`);
    // Otherwise the custom domain is the one remaining way to reach a project the owner believes is gone.
    expect((await get('/', CUSTOM)).body).not.toContain('<h1>Home</h1>');

    expect((await client.post(`/admin/deleted-projects/${projectId}/restore`)).statusCode).toBe(204);
    expect((await get('/', CUSTOM)).statusCode).toBe(200);
  });

  // ── the isolation boundary ────────────────────────────────────────────────────────────────────────

  it('★ treats a custom domain as an ISOLATED origin — the site’s own inline JS may run there', async () => {
    // The predicate is "is this a separate origin the host-only session cookie never reaches", NOT "did
    // the Host end in the sites domain". Too narrow and author JS silently dies on every custom domain;
    // too wide and foreign script runs on the cookie-bearing app origin. (The subdomain cannot be used
    // as the comparison any more — with a primary custom domain configured it 301s to it.)
    await seedAndPublish();
    await claimAndVerify(CUSTOM);

    const onCustom = await get('/', CUSTOM);
    expect(onCustom.body).toContain('window.__ran');
    expect(onCustom.headers['content-security-policy']).toContain("'unsafe-inline'");
  });

  it('keeps the APP origin script-inert: it never serves the site at all, it redirects', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const onApp = await get(`/sites/${slug}/`, APP_HOST);
    expect(onApp.statusCode).toBe(301);
    expect(onApp.body).not.toContain('window.__ran');
  });

  // ── one canonical address ─────────────────────────────────────────────────────────────────────────

  it('301s the path form to the custom domain, not to the sites subdomain', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const res = await get(`/sites/${slug}/about`, APP_HOST);
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe(`https://${CUSTOM}/about`);
  });

  it('301s the sites SUBDOMAIN to the primary custom domain (one site, one address)', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const res = await get('/', `${slug}.${DOMAIN}`);
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe(`https://${CUSTOM}/`);
  });

  it('301s a NON-primary verified domain to the primary one', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const second = await claimAndVerify('clientbrand.com');
    expect(second.isPrimary).toBe(false);

    const res = await get('/', 'clientbrand.com');
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe(`https://${CUSTOM}/`);
  });

  it('follows a change of primary', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const second = await claimAndVerify('clientbrand.com');
    await client.put(`/projects/${projectId}/domains/${second.id}/primary`);

    expect((await get('/', 'clientbrand.com')).statusCode).toBe(200);
    expect((await get('/', CUSTOM)).headers.location).toBe('https://clientbrand.com/');
  });

  it('advertises the primary custom domain as the "View live" URL', async () => {
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const status = (await client.get(`/projects/${projectId}/publish`)).json();
    expect(status.url).toBe(`https://${CUSTOM}/`);
  });

  it('★ advertises the SUBDOMAIN while the claim is unverified — never an address that 404s', async () => {
    await seedAndPublish();
    await client.post(`/projects/${projectId}/domains`, { host: CUSTOM });
    const status = (await client.get(`/projects/${projectId}/publish`)).json();
    expect(status.url).toBe(`https://${slug}.${DOMAIN}/`);
  });

  // ── the platform surface a published page needs ───────────────────────────────────────────────────

  it('★ the form-submission endpoint still reaches the PLATFORM on a custom domain', async () => {
    // A published page posts to the root-relative `/f/<project>/<form>`, which on a custom domain
    // resolves to this origin. If the rewrite swallowed it into the site namespace it would 404 and
    // every contact form on every custom domain would silently stop submitting.
    await seedAndPublish();
    await claimAndVerify(CUSTOM);
    const res = await client.inject({
      method: 'OPTIONS',
      url: `/f/${projectId}/contact`,
      headers: { host: CUSTOM },
    });
    expect(res.statusCode).toBeLessThan(400);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
