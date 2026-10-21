import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SiteRegistrationView } from '@sitewright/schema';
import { registrableSiteUrl } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { webmasterSites } from '../src/db/schema.js';
import { ProjectRepository } from '../src/repo/projects.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * SITE REGISTRATION end to end: a publish with Local Hosting puts the platform accounts' verification tags in the
 * served pages, then Google and Bing are asked to verify the site — once. What goes wrong is recorded for staff and
 * never fails the publish.
 */

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  project_id: 'sitewright-seo-123',
  private_key_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  private_key: PEM,
  client_email: 'sitewright-seo@sitewright-seo-123.iam.gserviceaccount.com',
});
const BING_KEY = '0123456789abcdef0123456789abcdef';
/** Local Hosting serves the project at `<slug>.<sitesDomain>`: the Site URL a publish here makes live. */
const SITE = 'https://regsite.sites.test/';
const GOOGLE_TAG = 'gOOgle-Tag_1234567890';
const BING_CODE = '0A1B2C3D4E5F60718293A4B5C6D7E8F9';
const slug = 'regsite';

/** What the fake search engines do, and what they were asked (method + URL without its query). */
let engines: { google: 'ok' | 'missing' | 'down'; bing: boolean; bingSites: string[]; calls: string[] };

const fakeEngines: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  engines.calls.push(`${init.method} ${path}`);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === '' ? '' : JSON.stringify(body)) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.endsWith('/siteVerification/v1/token')) {
    return engines.google === 'down' ? answer(503, {}) : answer(200, { method: 'META', token: `<meta name="google-site-verification" content="${GOOGLE_TAG}" />` });
  }
  if (path.endsWith('/siteVerification/v1/webResource')) {
    return engines.google === 'ok' ? answer(200, { id: 'x' }) : answer(400, { error: { code: 400, message: 'The necessary verification token could not be found on your site.' } });
  }
  if (path.startsWith('https://www.googleapis.com/webmasters/v3/sites/')) return answer(204, '');
  if (path.endsWith('/GetUserSites')) return answer(200, { d: engines.bingSites.map((u) => ({ Url: u, AuthenticationCode: BING_CODE, IsVerified: false })) });
  if (path.endsWith('/AddSite')) {
    engines.bingSites.push((JSON.parse(String(init.body)) as { siteUrl: string }).siteUrl);
    return answer(200, { d: null });
  }
  if (path.endsWith('/VerifySite')) return answer(200, { d: engines.bing });
  return answer(404, {});
};

let harness: Harness;
let admin: TestClient;
let projectId: string;
let publishRoot: string;

beforeEach(async () => {
  engines = { google: 'ok', bing: true, bingSites: [], calls: [] };
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-site-reg-'));
  harness = await makeHarness({ publishRoot, sitesDomain: 'sites.test', webmasterFetch: fakeEngines, rankTickMs: 0 });
  admin = await harness.signup({ admin: true });
  expect((await admin.put('/admin/webmaster-accounts', { google: { keyFile: KEY_FILE }, bing: { apiKey: BING_KEY } })).statusCode).toBe(200);
  projectId = await admin.createProject('Reg Site', slug);
});
afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

async function seed(siteUrl: string | undefined): Promise<void> {
  const proj = admin.project(projectId);
  const settings = { brand: { name: 'Reg Site' }, settings: { defaultLocale: 'en', locales: ['en'] }, website: siteUrl ? { siteUrl } : {} };
  expect((await proj.putContent('settings', 'settings', settings)).statusCode).toBe(200);
  expect((await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<h1>Hi</h1>' })).statusCode).toBe(200);
}
const publish = async (): Promise<void> => {
  expect((await admin.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
};
const status = async (): Promise<SiteRegistrationView> => (await admin.get(`/projects/${projectId}/search-engines`)).json() as SiteRegistrationView;
/** Registration runs after the publish has answered: wait for it to settle on a status. */
async function settled(want: (v: SiteRegistrationView) => boolean): Promise<SiteRegistrationView> {
  for (let i = 0; i < 100; i++) {
    const v = await status();
    if (want(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`registration never settled: ${JSON.stringify(await status())}`);
}
const count = (fragment: string): number => engines.calls.filter((c) => c.includes(fragment)).length;
/** The published home page, through the host Local Hosting serves it at. Asserted present, so an absence check means something. */
async function home(siteSlug = slug): Promise<string> {
  const r = await harness.app.inject({ method: 'GET', url: '/', headers: { host: `${siteSlug}.sites.test` } });
  expect(r.statusCode).toBe(200);
  expect(r.body).toContain('<h1>Hi</h1>');
  return r.body;
}

describe('site registration', () => {
  it('a publish carries both tags in every page and gets the site verified with Google and Bing — once', async () => {
    await seed('https://regsite.sites.test');
    const before = await status();
    expect(before).toMatchObject({ siteUrl: SITE, notice: null, google: { configured: true, status: 'none' }, bing: { configured: true, status: 'none' } });

    await publish();
    const page = await home();
    expect(page).toContain(`<meta name="google-site-verification" content="${GOOGLE_TAG}" />`);
    expect(page).toContain(`<meta name="msvalidate.01" content="${BING_CODE}" />`);

    const done = await settled((v) => v.google.status === 'verified' && v.bing.status === 'verified');
    expect(done.google).toMatchObject({ detail: 'Verified and added to Search Console' });
    expect(done.google.verifiedAt).toBeTruthy();
    expect(done.bing).toMatchObject({ detail: 'Verified in Bing Webmaster Tools' });
    expect(engines.bingSites).toEqual([SITE]);
    expect(engines.calls).toContain('PUT https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fregsite.sites.test%2F');

    // The next publish reuses the tags and asks nobody anything: the site is already registered.
    const asked = engines.calls.length;
    await publish();
    await new Promise((r) => setTimeout(r, 50));
    expect(engines.calls.length).toBe(asked);
    expect(await home()).toContain(GOOGLE_TAG);
  });

  it('records why a search engine did not verify, and the next publish tries again', async () => {
    engines.google = 'missing';
    engines.bing = false;
    await seed(SITE);
    await publish();
    const failed = await settled((v) => v.google.status === 'failed' && v.bing.status === 'failed');
    expect(failed.google.detail).toBe(`Google could not verify ${SITE}: The necessary verification token could not be found on your site.`);
    expect(failed.bing.detail).toMatch(/did not find the verification tag/);

    engines.google = 'ok';
    engines.bing = true;
    await publish();
    await settled((v) => v.google.status === 'verified' && v.bing.status === 'verified');
    expect(count('/siteVerification/v1/token')).toBe(1); // the tag was kept
  });

  it('publishes without a tag Google could not give, and does not delay every build asking again', async () => {
    engines.google = 'down';
    await seed(SITE);
    await publish();
    const page = await home();
    expect(page).not.toContain('google-site-verification');
    expect(page).toContain('msvalidate.01');
    const v = await settled((s) => s.bing.status === 'verified');
    expect(v.google).toMatchObject({ status: 'failed', detail: 'Google is unavailable (HTTP 503)' });
    expect(count('/siteVerification/v1/webResource')).toBe(0); // nothing to verify without the tag

    await publish();
    expect(count('/siteVerification/v1/token')).toBe(1); // within the hour, the build goes without
  });

  it('registers nothing without an https Site URL, or without a live build', async () => {
    await seed('http://regsite.sites.test/');
    await publish();
    expect(await status()).toMatchObject({ siteUrl: null, notice: 'not-https', google: { status: 'none' }, bing: { status: 'none' } });
    expect(await home()).not.toContain('google-site-verification');
    expect(engines.calls).toEqual([]);

    await seed(undefined);
    expect((await status()).notice).toBe('no-site-url');

    // Local Hosting serves this project here, but its Site URL is a host this instance does not serve: the publish
    // is not live THERE, so it carries no tags and asks nobody (a deploy to that host will).
    await seed('https://www.elsewhere.test/');
    await publish();
    expect(await home()).not.toMatch(/google-site-verification|msvalidate/);
    expect(engines.calls).toEqual([]);

    // A download of a never-published site builds it fresh (the deploy build) — and is live nowhere either.
    const fresh = await admin.createProject('Download', 'dlsite', { localHosting: false });
    await admin.project(fresh).putContent('settings', 'settings', { brand: { name: 'Download' }, settings: { defaultLocale: 'en', locales: ['en'] }, website: { siteUrl: 'https://www.download.test/' } });
    await admin.project(fresh).putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<h1>Hi</h1>' });
    expect((await admin.get(`/projects/${fresh}/publish/archive`)).statusCode).toBe(200);
    expect(engines.calls).toEqual([]);

    // A publish of a project that is hosted nowhere is live nowhere: no tags (asking Bing for one adds the site to
    // the platform's account), and nothing to verify.
    const hidden = await admin.createProject('Hidden', 'hiddensite', { localHosting: false });
    const proj = admin.project(hidden);
    await proj.putContent('settings', 'settings', { brand: { name: 'Hidden' }, settings: { defaultLocale: 'en', locales: ['en'] }, website: { siteUrl: 'https://hiddensite.sites.test/' } });
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<h1>Hi</h1>' });
    expect((await admin.post(`/projects/${hidden}/publish`, {})).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(engines.calls).toEqual([]);
  });

  it('a replaced key starts again, the same key saved again does not, and a removed account stops tagging', async () => {
    await seed(SITE);
    await publish();
    await settled((v) => v.bing.status === 'verified');
    expect((await admin.put('/admin/webmaster-accounts', { bing: { apiKey: BING_KEY } })).statusCode).toBe(200);
    expect((await status()).bing.status).toBe('verified');
    expect((await admin.put('/admin/webmaster-accounts', { bing: { apiKey: 'fedcba9876543210fedcba9876543210' } })).statusCode).toBe(200);
    expect((await status()).bing).toMatchObject({ configured: true, status: 'none', detail: null });

    expect((await admin.put('/admin/webmaster-accounts', { google: null })).statusCode).toBe(200);
    await publish();
    expect(await home()).not.toContain('google-site-verification');
    expect((await status()).google).toMatchObject({ configured: false, status: 'none' });
  });

  it('is shown to agency staff only, and goes with its project', async () => {
    await seed(SITE);
    await publish();
    await settled((v) => v.google.status === 'verified');
    const client = await harness.signup();
    expect((await client.get(`/projects/${projectId}/search-engines`)).statusCode).toBe(403);

    await new ProjectRepository(harness.db).remove(projectId);
    expect(await harness.db.select().from(webmasterSites)).toEqual([]);
  });
});

describe('registrableSiteUrl', () => {
  it('names the https URL-prefix property, or nothing', () => {
    expect(registrableSiteUrl('https://www.Example.com')).toBe('https://www.example.com/');
    expect(registrableSiteUrl(' https://example.com/blog?x=1#top ')).toBe('https://example.com/blog/');
    expect(registrableSiteUrl('https://example.com:8443/')).toBe('https://example.com:8443/');
    for (const bad of [undefined, null, '', 'example.com', 'http://example.com/', 'https://localhost/', 'https://user:pw@example.com/', 'ftp://example.com/']) {
      expect(registrableSiteUrl(bad)).toBeNull();
    }
  });
});
