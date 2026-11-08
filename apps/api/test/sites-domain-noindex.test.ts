import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// The admin setting `sitesDomainNoindex`: hosted sites at the PLATFORM's own addresses — `<slug>.<sitesDomain>`
// and the `/sites/<slug>/` path form — answer `X-Robots-Tag: noindex`, while a site on its verified custom
// domain stays indexable. There, the site's robots.txt shuts crawlers out too, like the platform's own
// (`platform-noindex.test.ts`). The owner learns about it from the publish status (`searchHidden`).

const DOMAIN = 'agency.site';
const CUSTOM = 'www.clientbrand.com';
const slug = 'example';
const home = { kind: 'page' as const, title: 'Home', path: '', source: '<h1>Home</h1>' };

async function seedAndPublish(client: TestClient, projectId: string, targetOpts: Record<string, unknown> = {}) {
  const proj = client.project(projectId);
  await proj.putContent('settings', 'settings', {
    brand: { name: 'Example', colors: { primary: '#e11' } },
    settings: { defaultLocale: 'en', locales: ['en'] },
  });
  await proj.putContent('page', 'home', home);
  await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local', ...targetOpts });
  expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
}

const setNoindex = async (client: TestClient, on: boolean) =>
  expect((await client.put('/admin/settings', { sitesDomainNoindex: on })).statusCode).toBe(200);

describe('sitesDomainNoindex: hosted sites on the sites domain', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;
  let txt: string[][] = [];

  beforeEach(async () => {
    txt = [];
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-noindex-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-noindex-media-'));
    harness = await makeHarness({
      publishRoot,
      mediaRoot,
      sitesDomain: DOMAIN,
      // The app host stays OUTSIDE the sites domain (see custom-domain-serving.test.ts).
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

  const get = (url: string, host: string) =>
    client.inject({ method: 'GET', url, headers: { host, 'x-forwarded-proto': 'https' } });
  const site = (url: string) => get(url, `${slug}.${DOMAIN}`);
  const status = async () => (await client.get(`/projects/${projectId}/publish`)).json() as { url: string | null; searchHidden?: boolean };

  async function claimAndVerify(host: string) {
    const claimed = (await client.post(`/projects/${projectId}/domains`, { host })).json().domain;
    txt = [[claimed.verificationToken]];
    expect((await client.post(`/projects/${projectId}/domains/${claimed.id}/verify`)).json()).toMatchObject({ verified: true });
  }

  it('is OFF by default: a hosted page carries no X-Robots-Tag, and the status says nothing', async () => {
    await seedAndPublish(client, projectId);
    const page = await site('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>Home</h1>');
    expect(page.headers['x-robots-tag']).toBeUndefined();
    // The site's own robots.txt, from its publish.
    const robots = await site('/robots.txt');
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('Allow: /');
    expect(robots.body).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots.headers['x-robots-tag']).toBeUndefined();
    expect((await status()).searchHidden).toBeUndefined();
    expect((await client.get('/admin/settings')).json().settings.sitesDomainNoindex).toBe(false);
  });

  it('ON: the page, its files and a planted PDF answer noindex, and robots.txt disallows everything', async () => {
    await seedAndPublish(client, projectId);
    await mkdir(join(publishRoot, slug, '_assets', 'doc', 'file'), { recursive: true });
    await writeFile(join(publishRoot, slug, '_assets', 'doc', 'file', 'brochure.pdf'), '%PDF-1.4\n');
    await setNoindex(client, true);

    const page = await site('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>Home</h1>');
    expect(page.headers['x-robots-tag']).toBe('noindex');

    // noindex + robots.txt, as for the rest of the platform: the site's own file is not served here.
    const robots = await site('/robots.txt');
    expect(robots.statusCode).toBe(200);
    expect(robots.headers['x-robots-tag']).toBe('noindex');
    expect(robots.headers['cache-control']).toBe('no-cache');
    expect(robots.body).toBe('User-agent: *\nDisallow: /\n');

    const pdf = await site('/_assets/doc/file/brochure.pdf');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['x-robots-tag']).toBe('noindex');
  });

  it('ON: the preview-token page of a gated site carries it too', async () => {
    await seedAndPublish(client, projectId, { previewToken: 'tok_abcdefgh12345678' });
    await setNoindex(client, true);
    const gated = await site('/');
    expect(gated.statusCode).toBe(403);
    expect(gated.headers['x-robots-tag']).toBe('noindex');
  });

  it('ON: the publish status names the hidden address (searchHidden), and the admin GET reports the switch', async () => {
    await seedAndPublish(client, projectId);
    await setNoindex(client, true);
    const st = await status();
    expect(st.url).toBe(`https://${slug}.${DOMAIN}/`);
    expect(st.searchHidden).toBe(true);
    expect((await client.get('/admin/settings')).json().settings.sitesDomainNoindex).toBe(true);
    // The publish response says the same, so a deploy reports it without a second read.
    expect((await client.post(`/projects/${projectId}/publish`)).json().searchHidden).toBe(true);
  });

  it('★ a site on its VERIFIED custom domain stays indexable, and is not reported hidden', async () => {
    await seedAndPublish(client, projectId);
    await claimAndVerify(CUSTOM);
    await setNoindex(client, true);

    const page = await get('/', CUSTOM);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>Home</h1>');
    expect(page.headers['x-robots-tag']).toBeUndefined();
    const robots = await get('/robots.txt', CUSTOM);
    expect(robots.statusCode).toBe(200);
    expect(robots.headers['x-robots-tag']).toBeUndefined();
    expect(robots.body).toContain('Allow: /'); // the site's own file, not the platform's Disallow
    expect(robots.body).not.toMatch(/^Disallow:\s*\/\s*$/m);
    // Its platform address only redirects to the custom domain, so a search engine follows it there.
    const viaSub = await site('/');
    expect(viaSub.statusCode).toBe(301);
    expect(viaSub.headers.location).toBe(`https://${CUSTOM}/`);
    // robots.txt too: the redirect comes first, so the platform address never answers Disallow for this site.
    const subRobots = await site('/robots.txt');
    expect(subRobots.statusCode).toBe(301);
    expect(subRobots.headers.location).toBe(`https://${CUSTOM}/robots.txt`);

    const st = await status();
    expect(st.url).toBe(`https://${CUSTOM}/`);
    expect(st.searchHidden).toBeUndefined();
  });

  it('★ the custom-domain exemption survives a Host with a port and capitals', async () => {
    await seedAndPublish(client, projectId);
    await claimAndVerify(CUSTOM);
    await setNoindex(client, true);
    // The same normalisation the rewrite uses to route the request here, so the two can never disagree.
    const page = await get('/', 'WWW.ClientBrand.com:443');
    expect(page.statusCode).toBe(200);
    expect(page.headers['x-robots-tag']).toBeUndefined();
  });

  it('★ a verified domain that is NOT the primary redirects to the platform address, so the site IS hidden', async () => {
    await seedAndPublish(client, projectId);
    // The first claim becomes the primary even while unverified; the second is verified but not primary.
    await client.post(`/projects/${projectId}/domains`, { host: 'unverified.example' });
    await claimAndVerify(CUSTOM);
    await setNoindex(client, true);
    const viaCustom = await get('/', CUSTOM);
    expect(viaCustom.statusCode).toBe(301);
    expect(viaCustom.headers.location).toBe(`https://${slug}.${DOMAIN}/`);
    expect((await site('/')).headers['x-robots-tag']).toBe('noindex');
    // The status tells the owner the truth: the address that serves the site is a hidden one.
    expect((await status()).searchHidden).toBe(true);
  });

  it('an unknown path on a platform address 404s with the header too', async () => {
    await seedAndPublish(client, projectId);
    await setNoindex(client, true);
    const missing = await site('/no-such-page/');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-robots-tag']).toBe('noindex');
  });

  it('a save applies to the very next request, both ways (no restart)', async () => {
    await seedAndPublish(client, projectId);
    await setNoindex(client, true);
    expect((await site('/')).headers['x-robots-tag']).toBe('noindex');
    expect((await site('/robots.txt')).body).toBe('User-agent: *\nDisallow: /\n');
    await setNoindex(client, false);
    expect((await site('/')).headers['x-robots-tag']).toBeUndefined();
    expect((await site('/robots.txt')).body).toContain('Allow: /');
    expect((await status()).searchHidden).toBeUndefined();
  });

  it('★ a save from another panel (no sitesDomainNoindex in the body) keeps it on', async () => {
    await seedAndPublish(client, projectId);
    await setNoindex(client, true);
    expect((await client.put('/admin/settings', { shareExpiryDays: 7 })).statusCode).toBe(200);
    expect((await client.get('/admin/settings')).json().settings.sitesDomainNoindex).toBe(true);
    expect((await site('/')).headers['x-robots-tag']).toBe('noindex');
  });

  it("★ the app's own host answers the platform robots.txt, not a site's", async () => {
    await seedAndPublish(client, projectId);
    const app = await get('/robots.txt', 'cms.agency.com');
    expect(app.statusCode).toBe(200);
    expect(app.body).toBe('User-agent: *\nAllow: /sites/\nDisallow: /\n');
    expect(app.headers['x-robots-tag']).toBe('noindex');
  });

  it('only an instance admin may switch it', async () => {
    const member = await harness.signup();
    const res = await member.put('/admin/settings', { sitesDomainNoindex: true });
    expect(res.statusCode).toBe(403);
    expect((await client.get('/admin/settings')).json().settings.sitesDomainNoindex).toBe(false);
  });

  it('a project with no Local Hosting is never reported hidden (nothing is served there)', async () => {
    await setNoindex(client, true);
    const st = await status();
    expect(st.url).toBeNull();
    expect(st.searchHidden).toBeUndefined();
  });
});

describe('sitesDomainNoindex: the /sites/<slug>/ path form (no sites domain configured)', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;
  let txt: string[][] = [];

  beforeEach(async () => {
    txt = [];
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-noindex-path-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-noindex-path-media-'));
    // NO sitesDomain → the path form serves.
    harness = await makeHarness({ publishRoot, mediaRoot, publicUrl: 'https://cms.agency.com', txtLookup: async () => txt });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Example', slug, { localHosting: false });
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('is on the app origin, so it answers noindex when the switch is on', async () => {
    await seedAndPublish(client, projectId);
    expect((await client.get(`/sites/${slug}/`)).headers['x-robots-tag']).toBeUndefined();
    await setNoindex(client, true);
    const page = await client.get(`/sites/${slug}/`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>Home</h1>');
    expect(page.headers['x-robots-tag']).toBe('noindex');
    expect(((await client.get(`/projects/${projectId}/publish`)).json() as { searchHidden?: boolean }).searchHidden).toBe(true);
  });

  it('★ with no sites domain a verified NON-primary domain serves the site itself: indexable, and not reported hidden', async () => {
    await seedAndPublish(client, projectId);
    await client.post(`/projects/${projectId}/domains`, { host: 'unverified.example' }); // the (unverified) primary
    const claimed = (await client.post(`/projects/${projectId}/domains`, { host: CUSTOM })).json().domain;
    txt = [[claimed.verificationToken]];
    expect((await client.post(`/projects/${projectId}/domains/${claimed.id}/verify`)).json()).toMatchObject({ verified: true });
    await setNoindex(client, true);
    // There is no platform host to send it to, so the verified domain answers with the page, without the header…
    const page = await client.inject({ method: 'GET', url: '/', headers: { host: CUSTOM } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>Home</h1>');
    expect(page.headers['x-robots-tag']).toBeUndefined();
    // …so the status must not call the site hidden (the rule servedOnCustomDomain shares with the route).
    expect(((await client.get(`/projects/${projectId}/publish`)).json() as { searchHidden?: boolean }).searchHidden).toBeUndefined();
  });
});
