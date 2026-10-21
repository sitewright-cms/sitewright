import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SiteRegistrationPrepareResult, SiteRegistrationToggleResult, SiteRegistrationVerifyResult, SiteRegistrationView } from '@sitewright/schema';
import { registrableSiteUrl } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { webmasterSites } from '../src/db/schema.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * SITE REGISTRATION over HTTP. Staff switch each search engine on for a project and run the verification from the
 * Search engines tile: get the tags, deploy (the editor runs the project's own deploys), then verify each. Nothing
 * reaches Google or Bing on its own — not a publish, not a deploy. Switching off, and deleting the project, removes
 * the site from that account.
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
/** Local Hosting serves the project at `<slug>.<sitesDomain>`. */
const SITE = 'https://regsite.sites.test/';
const GOOGLE_TAG = 'gOOgle-Tag_1234567890';
const BING_CODE = '0A1B2C3D4E5F60718293A4B5C6D7E8F9';
const slug = 'regsite';

/** What the fake search engines do, and what they were asked (method + URL without its query). */
let engines: { google: 'ok' | 'missing' | 'down'; bing: boolean; bingDown: boolean; bingRefusesRemoval: boolean; bingSites: string[]; calls: string[] };

const fakeEngines: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  engines.calls.push(`${init.method} ${path}`);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === '' ? '' : JSON.stringify(body)) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.startsWith('https://www.googleapis.com/') && engines.google === 'down') return answer(503, {});
  if (path.endsWith('/siteVerification/v1/token')) return answer(200, { method: 'META', token: `<meta name="google-site-verification" content="${GOOGLE_TAG}" />` });
  if (path.includes('/siteVerification/v1/webResource')) {
    if (init.method === 'DELETE') return answer(204, '');
    return engines.google === 'ok' ? answer(200, { id: 'x' }) : answer(400, { error: { code: 400, message: 'The necessary verification token could not be found on your site.' } });
  }
  if (path.startsWith('https://www.googleapis.com/webmasters/v3/sites/')) return answer(204, '');
  if (engines.bingDown) return answer(503, {});
  if (path.endsWith('/GetUserSites')) return answer(200, { d: engines.bingSites.map((u) => ({ Url: u, AuthenticationCode: BING_CODE, IsVerified: false })) });
  if (path.endsWith('/AddSite')) {
    engines.bingSites.push((JSON.parse(String(init.body)) as { siteUrl: string }).siteUrl);
    return answer(200, { d: null });
  }
  if (path.endsWith('/RemoveSite')) {
    if (engines.bingRefusesRemoval) return answer(400, { ErrorCode: 14, Message: 'NotAuthorized' });
    const gone = (JSON.parse(String(init.body)) as { siteUrl: string }).siteUrl;
    engines.bingSites = engines.bingSites.filter((u) => u !== gone);
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
  engines = { google: 'ok', bing: true, bingDown: false, bingRefusesRemoval: false, bingSites: [], calls: [] };
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-site-reg-'));
  harness = await makeHarness({ publishRoot, sitesDomain: 'sites.test', webmasterFetch: fakeEngines, rankTickMs: 0 });
  admin = await harness.signup({ admin: true });
  expect((await admin.put('/admin/webmaster-accounts', { google: { keyFile: KEY_FILE }, bing: { apiKey: BING_KEY } })).statusCode).toBe(200);
  projectId = await admin.createProject('Reg Site', slug);
  await seed(SITE);
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
const base = () => `/projects/${projectId}/search-engines`;
const view = async (): Promise<SiteRegistrationView> => (await admin.get(base())).json() as SiteRegistrationView;
const toggle = async (body: unknown) => admin.put(base(), body);
const prepare = async (): Promise<SiteRegistrationPrepareResult> => {
  const r = await admin.post(`${base()}/prepare`, {});
  expect(r.statusCode).toBe(200);
  return r.json() as SiteRegistrationPrepareResult;
};
const verify = async (service: string): Promise<SiteRegistrationVerifyResult> => {
  const r = await admin.post(`${base()}/${service}/verify`, {});
  expect(r.statusCode).toBe(200);
  return r.json() as SiteRegistrationVerifyResult;
};
const publish = async (): Promise<void> => {
  expect((await admin.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
};
/** The published home page, through the host Local Hosting serves it at. Asserted present, so an absence check means something. */
async function home(): Promise<string> {
  const r = await harness.app.inject({ method: 'GET', url: '/', headers: { host: `${slug}.sites.test` } });
  expect(r.statusCode).toBe(200);
  expect(r.body).toContain('<h1>Hi</h1>');
  return r.body;
}
const count = (fragment: string): number => engines.calls.filter((c) => c.includes(fragment)).length;

describe('site registration', () => {
  it('nothing reaches Google or Bing by itself: not a publish, not a switch', async () => {
    expect(await view()).toMatchObject({ siteUrl: SITE, notice: null, google: { configured: true, enabled: false, status: 'off' }, bing: { enabled: false, status: 'off' } });
    await publish();
    expect(await home()).not.toMatch(/google-site-verification|msvalidate/);
    const on = (await toggle({ google: true, bing: true })).json() as SiteRegistrationToggleResult;
    expect(on.view).toMatchObject({ google: { enabled: true, status: 'none' }, bing: { enabled: true, status: 'none' } });
    await publish();
    expect(engines.calls).toEqual([]);
  });

  it('verifies: the tags first, then the deploy carries them, then each search engine confirms', async () => {
    await toggle({ google: true, bing: true });
    const ready = await prepare();
    expect(ready.results).toEqual({ google: { ok: true, detail: 'Tag ready' }, bing: { ok: true, detail: 'Tag ready' } });
    expect(ready.view).toMatchObject({ google: { status: 'pending' }, bing: { status: 'pending' } });
    expect(engines.bingSites).toEqual([SITE]);

    await publish();
    const page = await home();
    expect(page).toContain(`<meta name="google-site-verification" content="${GOOGLE_TAG}" />`);
    expect(page).toContain(`<meta name="msvalidate.01" content="${BING_CODE}" />`);

    expect((await verify('google')).result).toEqual({ ok: true, detail: 'Verified and added to Search Console' });
    const done = await verify('bing');
    expect(done.result).toEqual({ ok: true, detail: 'Verified in Bing Webmaster Tools' });
    expect(done.view.google).toMatchObject({ status: 'verified', detail: 'Verified and added to Search Console' });
    expect(done.view.google.verifiedAt).toBeTruthy();
    expect(done.view.bing.status).toBe('verified');
    expect(engines.calls).toContain('PUT https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fregsite.sites.test%2F');

    // Verified stays tagged on every later build, and a second run reuses the tags.
    const asked = count('/siteVerification/v1/token');
    expect((await prepare()).results.google).toEqual({ ok: true, detail: 'Already verified: its tag stays on the site' });
    expect(count('/siteVerification/v1/token')).toBe(asked);
    await publish();
    expect(await home()).toContain(GOOGLE_TAG);
  });

  it('says why a search engine did not verify, and keeps the tag for the next try', async () => {
    engines.google = 'missing';
    engines.bing = false;
    await toggle({ google: true, bing: true });
    await prepare();
    await publish();
    expect((await verify('google')).result).toEqual({ ok: false, detail: `Google could not verify ${SITE}: The necessary verification token could not be found on your site.` });
    const bing = await verify('bing');
    expect(bing.result.detail).toMatch(/did not find the verification tag/);
    expect(bing.view).toMatchObject({ google: { status: 'failed' }, bing: { status: 'failed' } });
    await publish();
    expect(await home()).toContain(GOOGLE_TAG);
  });

  it('says why a tag could not be had, and asks for the step again only when told to', async () => {
    engines.google = 'down';
    await toggle({ google: true });
    expect((await prepare()).results.google).toEqual({ ok: false, detail: 'Google is unavailable (HTTP 503)' });
    expect((await view()).google).toMatchObject({ status: 'failed', detail: 'Google is unavailable (HTTP 503)' });
    expect((await verify('google')).result).toEqual({ ok: false, detail: 'No tag for this Production URL yet: start the verification again' });
    await publish();
    expect(await home()).not.toContain('google-site-verification');
  });

  it('switching off removes the site from that account and stops tagging it', async () => {
    await toggle({ google: true, bing: true });
    await prepare();
    await publish();
    await verify('google');
    await verify('bing');

    const off = (await toggle({ google: false })).json() as SiteRegistrationToggleResult;
    expect(off.removed.google).toEqual({ ok: true, detail: 'Removed from Search Console, and the ownership given up' });
    expect(engines.calls).toContain('DELETE https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fregsite.sites.test%2F');
    expect(engines.calls).toContain('DELETE https://www.googleapis.com/siteVerification/v1/webResource/https%3A%2F%2Fregsite.sites.test%2F');
    expect(off.view.google).toMatchObject({ enabled: false, status: 'off', detail: 'Removed from Search Console, and the ownership given up' });
    await publish();
    const page = await home();
    expect(page).not.toContain('google-site-verification');
    expect(page).toContain('msvalidate.01');

    expect(((await toggle({ bing: false })).json() as SiteRegistrationToggleResult).removed.bing).toEqual({ ok: true, detail: 'Removed from Bing Webmaster Tools' });
    expect(engines.bingSites).toEqual([]);
    // Switched back on, it starts over: nothing is left of the old registration.
    expect(((await toggle({ bing: true })).json() as SiteRegistrationToggleResult).view.bing).toMatchObject({ enabled: true, status: 'none' });
  });

  it('keeps a search engine on when its removal could not get through', async () => {
    await toggle({ bing: true });
    await prepare();
    engines.bingDown = true;
    const r = (await toggle({ bing: false })).json() as SiteRegistrationToggleResult;
    expect(r.removed.bing).toEqual({ ok: false, detail: `Could not remove ${SITE} from Bing: Bing is unavailable (HTTP 503)` });
    expect(r.view.bing).toMatchObject({ enabled: true, status: 'pending' });
    engines.bingDown = false;
    expect(((await toggle({ bing: false })).json() as SiteRegistrationToggleResult).view.bing.enabled).toBe(false);
  });

  it('a removal refused for good switches off, but keeps what it registered for the reap to remove', async () => {
    await toggle({ bing: true });
    await prepare();
    engines.bingRefusesRemoval = true;
    const r = (await toggle({ bing: false })).json() as SiteRegistrationToggleResult;
    expect(r.removed.bing).toEqual({ ok: false, detail: `Could not remove ${SITE} from Bing: Bing refused the API key` });
    expect(r.view.bing).toMatchObject({ enabled: false, status: 'off', detail: `Could not remove ${SITE} from Bing: Bing refused the API key` });
    await publish();
    expect(await home()).not.toContain('msvalidate.01');
    engines.bingRefusesRemoval = false;
    expect((await admin.del(`/projects/${projectId}`)).statusCode).toBe(204);
    expect((await admin.del(`/admin/deleted-projects/${projectId}`)).statusCode).toBeLessThan(300);
    expect(engines.bingSites).toEqual([]);
  });

  it('keeps an address another project registers too', async () => {
    const twin = await admin.createProject('Twin', 'twinsite');
    await admin.project(twin).putContent('settings', 'settings', { brand: { name: 'Twin' }, settings: { defaultLocale: 'en', locales: ['en'] }, website: { siteUrl: SITE } });
    await toggle({ bing: true });
    await prepare();
    expect((await admin.put(`/projects/${twin}/search-engines`, { bing: true })).statusCode).toBe(200);
    expect((await admin.post(`/projects/${twin}/search-engines/prepare`, {})).statusCode).toBe(200);
    const r = (await toggle({ bing: false })).json() as SiteRegistrationToggleResult;
    expect(r.removed.bing).toEqual({ ok: true, detail: `Kept at Bing: another project registers ${SITE} too` });
    expect(engines.bingSites).toEqual([SITE]);
    expect(count('/RemoveSite')).toBe(0);
  });

  it('does not forget an old address it could not remove', async () => {
    await toggle({ bing: true });
    await prepare();
    await seed('https://www.reg-site.test');
    engines.bingDown = true;
    expect((await prepare()).results.bing).toEqual({ ok: false, detail: `Could not remove ${SITE} from Bing: Bing is unavailable (HTTP 503). Try again.` });
    engines.bingDown = false;
    expect((await prepare()).results.bing).toEqual({ ok: true, detail: `Tag ready (the old address ${SITE} was removed)` });
    expect(engines.bingSites).toEqual(['https://www.reg-site.test/']);
  });

  it('a new Production URL removes the old registration before getting the new tag', async () => {
    await toggle({ google: true, bing: true });
    await prepare();
    await publish();
    await verify('google');
    await seed('https://www.reg-site.test');
    expect(await view()).toMatchObject({ siteUrl: 'https://www.reg-site.test/', google: { status: 'none', verifiedAt: null } });
    const moved = await prepare();
    expect(moved.results.google).toEqual({ ok: true, detail: `Tag ready (the old address ${SITE} was removed)` });
    expect(engines.bingSites).toEqual(['https://www.reg-site.test/']);
    expect(moved.view.google.status).toBe('pending');
  });

  it('switches on only with an https Production URL and a platform account', async () => {
    await seed('http://regsite.sites.test/');
    expect(await view()).toMatchObject({ siteUrl: null, notice: 'not-https' });
    expect((await toggle({ google: true })).statusCode).toBe(409);
    await seed(undefined);
    expect((await view()).notice).toBe('no-site-url');
    expect((await toggle({ google: true })).statusCode).toBe(409);
    await seed(SITE);
    expect((await admin.put('/admin/webmaster-accounts', { bing: null })).statusCode).toBe(200);
    expect((await toggle({ bing: true })).json()).toEqual({ error: 'The platform has no Bing Webmaster account yet' });
    expect((await toggle({})).statusCode).toBe(400);
    expect((await admin.post(`${base()}/yahoo/verify`, {})).statusCode).toBe(404);
  });

  it('a replaced key needs a new verification; the same key saved again does not', async () => {
    await toggle({ bing: true });
    await prepare();
    await publish();
    await verify('bing');
    expect((await admin.put('/admin/webmaster-accounts', { bing: { apiKey: BING_KEY } })).statusCode).toBe(200);
    expect((await view()).bing.status).toBe('verified');
    expect((await admin.put('/admin/webmaster-accounts', { bing: { apiKey: 'fedcba9876543210fedcba9876543210' } })).statusCode).toBe(200);
    expect((await view()).bing).toMatchObject({ enabled: true, status: 'none' });
    await publish();
    expect(await home()).not.toContain('msvalidate.01');
  });

  it('deleting the project removes its site from both accounts; the reap removes what was left', async () => {
    await toggle({ google: true, bing: true });
    await prepare();
    await publish();
    await verify('google');
    engines.bingDown = true; // Bing cannot be reached when the project is deleted…
    expect((await admin.del(`/projects/${projectId}`)).statusCode).toBe(204);
    for (let i = 0; i < 100 && count('DELETE https://www.googleapis.com/siteVerification') === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(count('DELETE https://www.googleapis.com/webmasters/v3/sites/')).toBe(1);
    expect(engines.bingSites).toEqual([SITE]);

    engines.bingDown = false; // …and is, when the deleted project is reaped.
    expect((await admin.del(`/admin/deleted-projects/${projectId}`)).statusCode).toBeLessThan(300);
    expect(engines.bingSites).toEqual([]);
    expect(count('DELETE https://www.googleapis.com/webmasters/v3/sites/')).toBe(1); // Google was done already
    expect(await harness.db.select().from(webmasterSites)).toEqual([]);
  });

  it('is agency staff only', async () => {
    const client = await harness.signup();
    for (const r of [
      await client.get(base()),
      await client.put(base(), { google: true }),
      await client.post(`${base()}/prepare`, {}),
      await client.post(`${base()}/google/verify`, {}),
    ]) {
      expect(r.statusCode).toBe(403);
    }
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
