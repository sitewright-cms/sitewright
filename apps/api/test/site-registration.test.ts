import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteRegistrationActionResult, SiteRegistrationPrepareResult, SiteRegistrationToggleResult, SiteRegistrationVerifyResult, SiteRegistrationView } from '@sitewright/schema';
import { registrableSiteUrl } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { webmasterRemovals, webmasterSites } from '../src/db/schema.js';
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
const SERVICE_ACCOUNT = 'sitewright-seo@sitewright-seo-123.iam.gserviceaccount.com';
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

/**
 * What the fake search engines do, and what they were asked (method + URL without its query). `googleOwners` are the
 * site's Search Console owners besides the service account, once Google verified it (`googleOwned`).
 */
let engines: {
  google: 'ok' | 'missing' | 'down';
  bing: boolean;
  bingDown: boolean;
  bingRefusesRemoval: boolean;
  bingSites: string[];
  googleOwned: boolean;
  googleOwners: string[];
  /** Google refuses any owner list (as it does an address that is not a Google account). */
  googleRefusesOwners: boolean;
  feeds: string[];
  calls: string[];
};

const fakeEngines: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  engines.calls.push(`${init.method} ${path}`);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === '' ? '' : JSON.stringify(body)) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.startsWith('https://www.googleapis.com/') && engines.google === 'down') return answer(503, {});
  if (path.endsWith('/siteVerification/v1/token')) return answer(200, { method: 'META', token: `<meta name="google-site-verification" content="${GOOGLE_TAG}" />` });
  if (path.includes('/siteVerification/v1/webResource')) {
    const resource = () => ({ id: 'x', site: { type: 'SITE', identifier: SITE }, owners: [SERVICE_ACCOUNT, ...engines.googleOwners] });
    const notOwner = answer(403, { error: { code: 403, message: 'You are not an owner of this site.', errors: [{ reason: 'forbidden' }] } });
    if (init.method === 'DELETE') {
      engines.googleOwned = false;
      return answer(204, '');
    }
    if (init.method === 'GET') return engines.googleOwned ? answer(200, resource()) : notOwner;
    if (init.method === 'PUT') {
      if (!engines.googleOwned) return notOwner;
      if (engines.googleRefusesOwners) return answer(400, { error: { code: 400, message: 'Invalid owner.' } });
      engines.googleOwners = (JSON.parse(String(init.body)) as { owners: string[] }).owners.filter((o) => o !== SERVICE_ACCOUNT);
      return answer(200, resource());
    }
    if (engines.google !== 'ok') return answer(400, { error: { code: 400, message: 'The necessary verification token could not be found on your site.' } });
    engines.googleOwned = true;
    return answer(200, resource());
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
  if (path.endsWith('/SubmitFeed')) {
    engines.feeds.push((JSON.parse(String(init.body)) as { feedUrl: string }).feedUrl);
    return answer(200, { d: null });
  }
  return answer(404, {});
};

let harness: Harness;
let admin: TestClient;
let projectId: string;
let publishRoot: string;

beforeEach(async () => {
  engines = { google: 'ok', bing: true, bingDown: false, bingRefusesRemoval: false, bingSites: [], googleOwned: false, googleOwners: [], googleRefusesOwners: false, feeds: [], calls: [] };
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
const sitemap = async (service: string): Promise<SiteRegistrationActionResult> => {
  const r = await admin.post(`${base()}/${service}/sitemap`, {});
  expect(r.statusCode).toBe(200);
  return r.json() as SiteRegistrationActionResult;
};
const setOwners = async (owners: unknown) => admin.put(`${base()}/google/owners`, { owners });
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
    expect((await admin.put('/admin/webmaster-accounts', { bing: { apiKey: 'fedcba9876543210fedcba9876543210' } })).statusCode).toBe(409); // a site is registered with the old one
    expect((await admin.put('/admin/webmaster-accounts', { bing: { apiKey: 'fedcba9876543210fedcba9876543210' }, force: true })).statusCode).toBe(200);
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
      await client.post(`${base()}/google/sitemap`, {}),
      await client.put(`${base()}/google/owners`, { owners: [] }),
    ]) {
      expect(r.statusCode).toBe(403);
    }
  });
});

/** What the platform does with a project's registrations when the project is deleted, restored and purged. */
describe('deleting, restoring and purging a project', () => {
  /** The delete removes in the background: bounded, generously, for a loaded machine. */
  const WAIT = { timeout: 10_000, interval: 20 };
  const sites = () => harness.db.select().from(webmasterSites);
  const removals = () => harness.db.select().from(webmasterRemovals);
  const del = async () => expect((await admin.del(`/projects/${projectId}`)).statusCode).toBe(204);

  it('★ the delete removes the site but keeps the switches and owners: restored, Verify now registers it and gives the owners access again', async () => {
    await toggle({ google: true, bing: true });
    await prepare();
    await publish();
    await verify('google');
    await verify('bing');
    expect((await setOwners(['ana@example.com'])).statusCode).toBe(200);
    expect(engines.googleOwners).toEqual(['ana@example.com']);

    await del();
    await vi.waitFor(async () => expect((await sites()).map((r) => r.siteUrl)).toEqual(['', '']), WAIT);
    expect(engines.googleOwned).toBe(false);
    expect(engines.googleOwners).toEqual([]);
    expect(engines.bingSites).toEqual([]);

    expect((await admin.post(`/admin/deleted-projects/${projectId}/restore`, {})).statusCode).toBe(204);
    const back = await view();
    expect(back.google).toMatchObject({ enabled: true, status: 'none', owners: ['ana@example.com'] });
    expect(back.bing).toMatchObject({ enabled: true, status: 'none' });

    await prepare();
    await publish();
    expect((await verify('google')).result).toEqual({ ok: true, detail: 'Verified and added to Search Console · 1 owner given access' });
    expect(engines.googleOwners).toEqual(['ana@example.com']);
    expect((await verify('bing')).result.ok).toBe(true);
    expect(engines.bingSites).toEqual([SITE]);
  });

  it('★ a delete that cannot reach Bing keeps the registration (it is still there) and queues it; the purge keeps the queue', async () => {
    await toggle({ bing: true });
    await prepare();
    engines.bingDown = true;
    await del();
    await vi.waitFor(async () => expect(await removals()).toHaveLength(1), WAIT);
    expect((await sites())[0]).toMatchObject({ service: 'bing', enabled: true, siteUrl: SITE, status: 'pending' });

    // Still down at the purge: the rows go, the queued removal stays for the hourly sweep.
    expect((await admin.del(`/admin/deleted-projects/${projectId}`)).statusCode).toBeLessThan(300);
    expect(await sites()).toEqual([]);
    expect(await removals()).toMatchObject([{ projectId, service: 'bing', siteUrl: SITE, attempts: 2 }]);
    expect(engines.bingSites).toEqual([SITE]);
  });

  it('a restore cancels what the delete could not remove', async () => {
    await toggle({ bing: true });
    await prepare();
    engines.bingDown = true;
    await del();
    await vi.waitFor(async () => expect(await removals()).toHaveLength(1), WAIT);
    expect((await admin.post(`/admin/deleted-projects/${projectId}/restore`, {})).statusCode).toBe(204);
    await vi.waitFor(async () => expect(await removals()).toEqual([]), WAIT);
    expect((await view()).bing).toMatchObject({ enabled: true, status: 'pending' });
  });

  it('★ a replaced Google key never reports the old registration removed', async () => {
    await toggle({ google: true });
    await prepare();
    await publish();
    await verify('google');
    const replaced = JSON.stringify({ ...(JSON.parse(KEY_FILE) as object), client_email: 'other@sitewright-seo-123.iam.gserviceaccount.com' });
    // Refused without `force` while the site is registered (see below); forced, as for a key that no longer works.
    expect((await admin.put('/admin/webmaster-accounts', { google: { keyFile: replaced }, force: true })).statusCode).toBe(200);
    const off = (await toggle({ google: false })).json() as SiteRegistrationToggleResult;
    // Google would have answered the new account "not an owner" — what "already removed" looks like.
    expect(off.removed.google).toEqual({ ok: false, detail: 'Not removed from Google: it was registered with an account the platform no longer uses' });
    expect(count('DELETE ')).toBe(0);
    expect(engines.googleOwned).toBe(true);
    expect(off.view.google).toMatchObject({ enabled: false, status: 'off', detail: off.removed.google!.detail });
  });

  const STAYS = 'that site stays registered at the old account, to be removed there by hand.';
  const BING_ON = `1 site is switched on with this Bing Webmaster account. Switch it off in the Search engines tile first, or, if the Bing API key no longer works, remove it anyway: ${STAYS}`;
  const BING_STUCK = `1 site is still registered with this Bing Webmaster account although switched off or deleted (the removal did not get through). If the Bing API key no longer works, remove it anyway: ${STAYS}`;
  /** The 409 for one account in the way. */
  const inUse = (service: 'google' | 'bing', action: 'remove' | 'replace', error: string) => ({ error, code: 'account-in-use', count: 1, accounts: [{ service, action, count: 1, error }] });

  it('★ System Settings refuses to remove an account sites are registered with, or still being removed from', async () => {
    await toggle({ bing: true });
    await prepare();
    const refused = await admin.put('/admin/webmaster-accounts', { bing: null });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual(inUse('bing', 'remove', BING_ON));
    expect((await admin.get('/admin/webmaster-accounts')).json()).toMatchObject({ bing: { configured: true } });

    engines.bingDown = true;
    await del();
    await vi.waitFor(async () => expect(await removals()).toHaveLength(1), WAIT);
    expect((await admin.put('/admin/webmaster-accounts', { bing: null })).json()).toEqual(inUse('bing', 'remove', BING_STUCK));

    // The Google account holds nothing: it can go.
    expect((await admin.put('/admin/webmaster-accounts', { google: null })).statusCode).toBe(200);
  });

  it('★ a site switched off whose removal Bing refused does not say "switch it off" — and a dead key can still go, forced', async () => {
    await toggle({ bing: true });
    await prepare();
    engines.bingRefusesRemoval = true; // as Bing answers a revoked key
    const off = (await toggle({ bing: false })).json() as SiteRegistrationToggleResult;
    expect(off.view.bing).toMatchObject({ enabled: false, status: 'off' });
    expect((await sites())[0]).toMatchObject({ enabled: false, siteUrl: SITE }); // still registered there

    const refused = await admin.put('/admin/webmaster-accounts', { bing: null });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual(inUse('bing', 'remove', BING_STUCK));
    const forced = await admin.put('/admin/webmaster-accounts', { bing: null, force: true });
    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ bing: { configured: false } });
    expect(engines.bingSites).toEqual([SITE]); // what "remove it there by hand" means
  });

  it('★ replacing one account and removing the other: each is refused in its own words, with its own count', async () => {
    await toggle({ google: true, bing: true });
    await prepare();
    const other = JSON.stringify({ ...(JSON.parse(KEY_FILE) as object), client_email: 'other@sitewright-seo-123.iam.gserviceaccount.com' });
    const refused = await admin.put('/admin/webmaster-accounts', { google: { keyFile: other }, bing: null });
    expect(refused.statusCode).toBe(409);
    const body = refused.json() as { error: string; count: number; accounts: Array<{ service: string; action: string; count: number; error: string }> };
    expect(body.accounts.map(({ service, action, count }) => ({ service, action, count }))).toEqual([
      { service: 'google', action: 'replace', count: 1 },
      { service: 'bing', action: 'remove', count: 1 },
    ]);
    expect(body.accounts[0]!.error).toMatch(/^1 site is switched on with this Google service account\. .* replace it anyway: /);
    expect(body.accounts[1]!.error).toBe(BING_ON);
    expect(body.count).toBe(2);
    expect(body.error).toBe(`${body.accounts[0]!.error} ${BING_ON}`);
  });

  it('★ replacing a key with ANOTHER account is refused like removing it; forced, verifying the same address again removes nothing', async () => {
    await toggle({ google: true });
    await prepare();
    await publish();
    await verify('google');
    const other = JSON.stringify({ ...(JSON.parse(KEY_FILE) as object), client_email: 'other@sitewright-seo-123.iam.gserviceaccount.com' });
    const refused = await admin.put('/admin/webmaster-accounts', { google: { keyFile: other } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual(
      inUse('google', 'replace', `1 site is switched on with this Google service account. Switch it off in the Search engines tile first, or, if the Google service-account key no longer works, replace it anyway: ${STAYS}`),
    );
    expect((await admin.get('/admin/webmaster-accounts')).json()).toMatchObject({ google: { clientEmail: SERVICE_ACCOUNT } });
    // The same service account's key saved again is not a change of account.
    expect((await admin.put('/admin/webmaster-accounts', { google: { keyFile: KEY_FILE } })).statusCode).toBe(200);

    expect((await admin.put('/admin/webmaster-accounts', { google: { keyFile: other }, force: true })).statusCode).toBe(200);
    // The same address under the new account: nothing is queued (the old account keeps a stale ownership, the safe side).
    expect((await prepare()).results.google).toEqual({ ok: true, detail: `Tag ready (the previous service account may still hold ${SITE} too: remove it there by hand if that account is gone)` });
    expect(await removals()).toEqual([]);
    expect(engines.googleOwned).toBe(true); // nothing was asked of Google with the new account about the old property
    expect(count('DELETE ')).toBe(0);
  });
});

describe('sitemap submission', () => {
  const SITEMAP = `${SITE}sitemap.xml`;
  const ENC = encodeURIComponent(SITE);

  it('hands the sitemap to a search engine that verified the site, and only then', async () => {
    await toggle({ google: true, bing: true });
    await prepare();
    await publish();
    expect((await view()).sitemapUrl).toBe(SITEMAP);
    expect((await sitemap('google')).result).toEqual({ ok: false, detail: 'Verify the site with Google first' });
    expect(count('/sitemaps/')).toBe(0);

    await verify('google');
    await verify('bing');
    const google = await sitemap('google');
    expect(google.result).toEqual({ ok: true, detail: `Sitemap submitted: ${SITEMAP}` });
    expect(engines.calls).toContain(`PUT https://www.googleapis.com/webmasters/v3/sites/${ENC}/sitemaps/${encodeURIComponent(SITEMAP)}`);
    expect(google.view.google.sitemap).toMatchObject({ ok: true, detail: `Sitemap submitted: ${SITEMAP}` });
    expect((await sitemap('bing')).view.bing.sitemap).toMatchObject({ ok: true });
    expect(engines.feeds).toEqual([SITEMAP]);
    expect((await admin.post(`${base()}/yahoo/sitemap`, {})).statusCode).toBe(404);
  });

  it('records a refused submission, and forgets the record with the registration', async () => {
    await toggle({ google: true });
    await prepare();
    await publish();
    await verify('google');
    engines.google = 'down';
    const refused = await sitemap('google');
    expect(refused.result).toEqual({ ok: false, detail: 'Google is unavailable (HTTP 503)' });
    expect(refused.view.google.sitemap).toMatchObject({ ok: false, detail: 'Google is unavailable (HTTP 503)' });
    engines.google = 'ok';
    expect(((await toggle({ google: false })).json() as SiteRegistrationToggleResult).view.google.sitemap).toBeNull();
  });
});

describe('Search Console owners', () => {
  it('only once Google verified the site; the list is staff’s, owners added at Google stay', async () => {
    await toggle({ google: true });
    expect((await setOwners(['ana@agency.example'])).json()).toMatchObject({ result: { ok: false, detail: 'Verify the site with Google first' } });
    await prepare();
    await publish();
    await verify('google');
    engines.googleOwners = ['client@own.example']; // the client made themself an owner at Google

    const set = (await setOwners([' Ana@Agency.example ', 'ana@agency.example', 'ben@agency.example'])).json() as SiteRegistrationActionResult;
    expect(set.result).toEqual({ ok: true, detail: '2 owners in Search Console' });
    expect(set.view.google.owners).toEqual(['ana@agency.example', 'ben@agency.example']);
    expect(engines.googleOwners).toEqual(['client@own.example', 'ana@agency.example', 'ben@agency.example']);

    const fewer = (await setOwners(['ben@agency.example'])).json() as SiteRegistrationActionResult;
    expect(fewer.view.google.owners).toEqual(['ben@agency.example']);
    expect(engines.googleOwners).toEqual(['client@own.example', 'ben@agency.example']);
    expect((await view()).bing.owners).toEqual([]);
  });

  it('says when the owners did not get access at a verification, and gives them access on the next save', async () => {
    await toggle({ google: true });
    await prepare();
    await publish();
    await verify('google');
    await setOwners(['ana@agency.example']);
    // A new Production URL is a new property: its verification gives the owners access again — here, refused.
    await seed('https://www.reg-site.test');
    await prepare();
    engines.googleRefusesOwners = true;
    const done = await verify('google');
    expect(done.result).toEqual({ ok: true, detail: 'Verified and added to Search Console · the owners were not given access: Google did not change the owners: Invalid owner.' });
    expect(done.view.google).toMatchObject({ status: 'verified', owners: ['ana@agency.example'], ownersIssue: 'Not given access: Google did not change the owners: Invalid owner.' });

    engines.googleRefusesOwners = false;
    const saved = (await setOwners(['ana@agency.example'])).json() as SiteRegistrationActionResult;
    expect(saved.result.ok).toBe(true);
    expect(saved.view.google.ownersIssue).toBeNull();
    expect(engines.googleOwners).toEqual(['ana@agency.example']);
  });

  it('never changes the owners of a property two projects share', async () => {
    const twin = await admin.createProject('Twin', 'twinsite');
    await admin.project(twin).putContent('settings', 'settings', { brand: { name: 'Twin' }, settings: { defaultLocale: 'en', locales: ['en'] }, website: { siteUrl: SITE } });
    await toggle({ google: true });
    await prepare();
    await publish();
    await verify('google');
    expect((await admin.put(`/projects/${twin}/search-engines`, { google: true })).statusCode).toBe(200);
    expect((await admin.post(`/projects/${twin}/search-engines/prepare`, {})).statusCode).toBe(200);
    const refused = (await setOwners(['ana@agency.example'])).json() as SiteRegistrationActionResult;
    expect(refused.result).toEqual({ ok: false, detail: `Another project registers ${SITE} too, and the two share one Search Console property: set its owners in one project only` });
    expect(engines.googleOwners).toEqual([]);
  });

  it('refuses what is not a list of email addresses, or too many', async () => {
    expect((await setOwners(['not-an-email'])).statusCode).toBe(400);
    expect((await setOwners(Array.from({ length: 11 }, (_, i) => `p${i}@agency.example`))).statusCode).toBe(400);
    expect((await admin.put(`${base()}/google/owners`, { owners: [], extra: 1 })).statusCode).toBe(400);
  });

  it('switching Google off takes them off first; the next verification gives them access again', async () => {
    await toggle({ google: true });
    await prepare();
    await publish();
    await verify('google');
    engines.googleOwners = ['client@own.example'];
    await setOwners(['ana@agency.example']);

    const off = (await toggle({ google: false })).json() as SiteRegistrationToggleResult;
    expect(off.removed.google).toEqual({ ok: true, detail: 'Removed from Search Console, and the ownership given up (1 owner removed)' });
    expect(engines.googleOwners).toEqual(['client@own.example']);
    expect(off.view.google.owners).toEqual(['ana@agency.example']); // staff's choice, kept for the next time

    await toggle({ google: true });
    await prepare();
    await publish();
    expect((await verify('google')).result).toEqual({ ok: true, detail: 'Verified and added to Search Console · 1 owner given access' });
    expect(engines.googleOwners).toEqual(['client@own.example', 'ana@agency.example']);
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
