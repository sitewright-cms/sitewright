import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './helpers.js';
import { webmasterRemovals, webmasterSites } from '../src/db/schema.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { WebmasterRepository } from '../src/webmaster/repo.js';
import { SiteRegistrar } from '../src/webmaster/sites.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * The registrar on its own: the rules the tile relies on but cannot show — two steps at once, a tag that is not the
 * current one, a Bing site added without a code, and what a build carries.
 */

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SITE = 'https://www.example.com/';

let calls: string[];
let bingCode: string;
/** Bing answers 503 to everything while this is set. */
let bingDown: boolean;
const fetch: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  calls.push(`${init.method} ${path}`);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  if (bingDown && path.startsWith('https://ssl.bing.com/')) return answer(503, {});
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.endsWith('/siteVerification/v1/token')) {
    await new Promise((r) => setTimeout(r, 20));
    return answer(200, { method: 'META', token: '<meta name="google-site-verification" content="gTag_first111" />' });
  }
  if (path.endsWith('/GetUserSites')) return answer(200, { d: calls.some((c) => c.endsWith('/AddSite')) ? [{ Url: SITE, AuthenticationCode: bingCode }] : [] });
  if (path.endsWith('/AddSite') || path.endsWith('/RemoveSite')) return answer(200, { d: null });
  return answer(200, {});
};

const BING_KEY = '0123456789abcdef0123456789abcdef';
/** What `webmaster_sites.account` holds for a Bing key: a fingerprint, never the key. */
const bingAccount = (key: string): string => createHash('sha256').update(key).digest('hex').slice(0, 16);

let db: Awaited<ReturnType<typeof makeTestDb>>;
let accounts: WebmasterRepository;
let projects: ProjectRepository;
let registrar: SiteRegistrar;
let projectId: string;
let now: Date;
let warnings: Array<{ obj: object; msg: string }>;
const T0 = new Date('2026-10-22T08:00:00Z');
const hours = (n: number): Date => new Date(now.getTime() + n * 60 * 60_000);

function makeRegistrar(extra: { maxRemovals?: number } = {}): SiteRegistrar {
  return new SiteRegistrar({ db, accounts, io: { fetch }, now: () => now, log: { info: () => {}, warn: (obj, msg) => warnings.push({ obj, msg }) }, ...extra });
}

beforeEach(async () => {
  calls = [];
  bingCode = 'B1NGC0DE0001';
  bingDown = false;
  now = T0;
  warnings = [];
  db = await makeTestDb();
  projects = new ProjectRepository(db);
  projectId = (await projects.create({ name: 'Reg', slug: `reg-${randomBytes(3).toString('hex')}` })).id;
  accounts = new WebmasterRepository(db, randomBytes(32));
  await accounts.apply({
    google: {
      secret: { clientEmail: 'seo@p-123.iam.gserviceaccount.com', privateKey: PEM, privateKeyId: 'a1b2c3d4e5f6', projectId: 'p-123' },
      info: { clientEmail: 'seo@p-123.iam.gserviceaccount.com', projectId: 'p-123' },
    },
    bing: { secret: { apiKey: BING_KEY }, info: {} },
  });
  registrar = makeRegistrar();
});

describe('SiteRegistrar', () => {
  it('two runs at once ask Google for the tag once', async () => {
    await registrar.setEnabled(projectId, { google: true });
    const [a, b] = await Promise.all([registrar.prepare(projectId, SITE), registrar.prepare(projectId, SITE)]);
    expect(a.google).toEqual({ ok: true, detail: 'Tag ready' });
    expect(b.google).toEqual({ ok: true, detail: 'Tag ready' });
    expect(calls.filter((c) => c.endsWith('/siteVerification/v1/token'))).toHaveLength(1);
  });

  it('a build carries only switched-on tags for its own Production URL', async () => {
    await registrar.setEnabled(projectId, { google: true, bing: true });
    expect(await registrar.tagsForBuild(projectId, SITE)).toEqual({});
    await registrar.prepare(projectId, SITE);
    expect(await registrar.tagsForBuild(projectId, SITE)).toEqual({ google: 'gTag_first111', bing: 'B1NGC0DE0001' });
    expect(await registrar.tagsForBuild(projectId, 'https://other.example.com/')).toEqual({});
    expect(await registrar.tagsForBuild(projectId, undefined)).toEqual({});
  });

  it('a Bing site added without a readable code is still removed when Bing is switched off', async () => {
    bingCode = '"><bad>';
    await registrar.setEnabled(projectId, { bing: true });
    expect((await registrar.prepare(projectId, SITE)).bing).toEqual({ ok: false, detail: 'Bing sent a verification code the platform could not read' });
    expect(calls).toContain('POST https://ssl.bing.com/webmaster/api.svc/json/AddSite');
    const removed = await registrar.setEnabled(projectId, { bing: false });
    expect(removed.bing).toEqual({ ok: true, detail: 'Removed from Bing Webmaster Tools' });
    expect(calls).toContain('POST https://ssl.bing.com/webmaster/api.svc/json/RemoveSite');
  });

  it('a search engine never set up has nothing to remove, and nothing is asked', async () => {
    await registrar.setEnabled(projectId, { google: true });
    calls = [];
    expect(await registrar.setEnabled(projectId, { google: false })).toEqual({});
    expect(calls).toEqual([]);
    expect((await registrar.view(projectId, SITE)).google).toMatchObject({ enabled: false, status: 'off' });
  });

  it('verify refuses a search engine that is off, or has no tag for the URL', async () => {
    expect(await registrar.verify(projectId, 'google', SITE)).toEqual({ ok: false, detail: 'Google is switched off for this site' });
    await registrar.setEnabled(projectId, { google: true });
    expect(await registrar.verify(projectId, 'google', SITE)).toEqual({ ok: false, detail: 'No tag for this Production URL yet: start the verification again' });
    expect(await registrar.verify(projectId, 'google', 'http://www.example.com/')).toEqual({ ok: false, detail: 'Set an https Production URL first' });
  });
});

/**
 * A site the platform could not remove when its project was deleted. The purge deletes the `webmaster_sites` rows —
 * before the fix with them went the only record of the site, and it stayed in the platform's account for good.
 */
describe('removals that do not get through', () => {
  const removeCalls = (): number => calls.filter((c) => c.endsWith('/RemoveSite')).length;
  const removals = () => db.select().from(webmasterRemovals);
  const bingRow = async () => (await db.select().from(webmasterSites)).find((r) => r.projectId === projectId && r.service === 'bing');

  async function registerBing(id = projectId): Promise<void> {
    await registrar.setEnabled(id, { bing: true });
    expect((await registrar.prepare(id, SITE)).bing).toMatchObject({ ok: true });
  }

  async function purgeWhileBingIsDown(): Promise<void> {
    await registerBing();
    bingDown = true;
    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnPurge(projectId);
    await projects.remove(projectId);
  }

  it('the purge queues it, the rows go, and the hourly sweep removes it with the account that registered it', async () => {
    await purgeWhileBingIsDown();
    expect(await db.select().from(webmasterSites)).toEqual([]);
    const [queued] = await removals();
    expect(queued).toMatchObject({ projectId, service: 'bing', siteUrl: SITE, account: bingAccount(BING_KEY), attempts: 1, lastError: `Could not remove ${SITE} from Bing: Bing is unavailable (HTTP 503)` });
    expect(queued!.nextAt).toEqual(hours(1));
    expect(removeCalls()).toBe(1);

    await registrar.retryRemovals(); // not due yet
    expect(removeCalls()).toBe(1);

    now = hours(1);
    await registrar.retryRemovals(); // due, still down: later each time
    expect(removeCalls()).toBe(2);
    expect((await removals())[0]).toMatchObject({ attempts: 2, nextAt: hours(2) });

    bingDown = false;
    now = hours(2);
    await registrar.retryRemovals();
    expect(removeCalls()).toBe(3);
    expect(await removals()).toEqual([]);
  });

  it('gives up after 14 days, with a warning that names the site', async () => {
    await purgeWhileBingIsDown();
    for (let day = 1; day <= 15; day++) {
      now = new Date(T0.getTime() + day * 24 * 60 * 60_000);
      await registrar.retryRemovals();
    }
    expect(await removals()).toEqual([]);
    const gaveUp = warnings.find((w) => w.msg.includes('gave up removing a site after 14 days'));
    expect(gaveUp?.obj).toMatchObject({ service: 'bing', siteUrl: SITE, account: bingAccount(BING_KEY) });
    expect(removeCalls()).toBeLessThanOrEqual(16); // never more than a try a day once the backoff reached it
  });

  it('★ never with another account: a replaced key does not report the site removed, and the old key can still remove it', async () => {
    await registerBing();
    const OTHER = 'fedcba9876543210fedcba9876543210';
    await accounts.apply({ bing: { secret: { apiKey: OTHER }, info: {} } });
    // Switched off: Bing would have answered "not found" to the new key, which read as "already removed".
    const off = await registrar.setEnabled(projectId, { bing: false });
    expect(off.bing).toEqual({ ok: false, detail: 'Not removed from Bing: it was registered with an account the platform no longer uses' });
    expect(removeCalls()).toBe(0);
    expect(await bingRow()).toMatchObject({ enabled: false, siteUrl: SITE, account: bingAccount(BING_KEY) });

    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnPurge(projectId);
    await projects.remove(projectId);
    expect((await removals())[0]).toMatchObject({ account: bingAccount(BING_KEY), lastError: off.bing!.detail });
    now = hours(1);
    await registrar.retryRemovals();
    expect(removeCalls()).toBe(0);
    expect(await removals()).toHaveLength(1);

    await accounts.apply({ bing: { secret: { apiKey: BING_KEY }, info: {} } }); // the old key back
    now = hours(3);
    await registrar.retryRemovals();
    expect(removeCalls()).toBe(1);
    expect(await removals()).toEqual([]);
  });

  it('the same with no account at all: not removed, and kept to try again', async () => {
    await registerBing();
    await accounts.apply({ bing: null });
    expect((await registrar.setEnabled(projectId, { bing: false })).bing).toEqual({ ok: false, detail: 'Not removed from Bing: the platform no longer has the account it was registered with' });
    expect(await bingRow()).toMatchObject({ siteUrl: SITE });
  });

  it('drops a removal whose address another project registers now, without removing it', async () => {
    await purgeWhileBingIsDown();
    bingDown = false;
    const twin = (await projects.create({ name: 'Twin', slug: `twin-${randomBytes(3).toString('hex')}` })).id;
    await registerBing(twin);
    const before = removeCalls();
    now = hours(1);
    await registrar.retryRemovals();
    expect(removeCalls()).toBe(before);
    expect(await removals()).toEqual([]);
  });

  it('keeps the queue bounded: past the cap the oldest are given up, each with a warning', async () => {
    registrar = makeRegistrar({ maxRemovals: 2 });
    const old = (n: number) => ({ id: `old-${n}`, projectId: `gone-${n}`, service: 'google' as const, siteUrl: `https://old${n}.example.com/`, account: 'sa@x', attempts: 1, nextAt: hours(1), createdAt: new Date(T0.getTime() - n * 60_000) });
    await db.insert(webmasterRemovals).values([old(1), old(2)]);
    await purgeWhileBingIsDown();
    expect((await removals()).map((r) => r.siteUrl).sort()).toEqual([SITE, 'https://old1.example.com/'].sort());
    expect(warnings.find((w) => w.msg.includes('too many removals waiting'))?.obj).toMatchObject({ siteUrl: 'https://old2.example.com/' });
  });
});

/**
 * A deleted project can be restored. Its site still leaves Google and Bing at the delete, but the switches and the
 * Google owners stay, so a restore shows the search engines on and not verified. Before the fix the delete wiped them.
 */
describe('deleting and restoring a project', () => {
  const removals = () => db.select().from(webmasterRemovals);
  const bingRow = async () => (await db.select().from(webmasterSites)).find((r) => r.projectId === projectId && r.service === 'bing');

  it('removes the site but keeps the switch: on, not registered', async () => {
    await registrar.setEnabled(projectId, { bing: true });
    await registrar.prepare(projectId, SITE);
    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnDelete(projectId);
    expect(calls.filter((c) => c.endsWith('/RemoveSite'))).toHaveLength(1);
    expect(await bingRow()).toMatchObject({ enabled: true, siteUrl: '', account: '', token: null, status: 'none' });
    await projects.restore(projectId);
    expect((await registrar.view(projectId, SITE)).bing).toMatchObject({ enabled: true, status: 'none' });
  });

  it('★ a removal that fails leaves the row as it was (still registered), and the hourly sweep finishes it', async () => {
    await registrar.setEnabled(projectId, { bing: true });
    await registrar.prepare(projectId, SITE);
    const before = await bingRow();
    bingDown = true;
    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnDelete(projectId);
    expect(await bingRow()).toEqual(before); // not "off" while still registered
    expect(await removals()).toHaveLength(1);

    bingDown = false;
    now = hours(1);
    await registrar.retryRemovals();
    expect(await removals()).toEqual([]);
    expect(await bingRow()).toMatchObject({ enabled: true, siteUrl: '', token: null, status: 'none' });
  });

  it('a restore cancels the queued removal, and the site stays registered for the restored project', async () => {
    await registrar.setEnabled(projectId, { bing: true });
    await registrar.prepare(projectId, SITE);
    bingDown = true;
    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnDelete(projectId);
    await projects.restore(projectId);
    await registrar.restored(projectId);
    expect(await removals()).toEqual([]);
    bingDown = false;
    now = hours(1);
    await registrar.retryRemovals();
    expect(calls.filter((c) => c.endsWith('/RemoveSite'))).toHaveLength(1); // the failed one at the delete only
    expect(await bingRow()).toMatchObject({ enabled: true, siteUrl: SITE, status: 'pending' });
  });

  it('the sweep never removes the site of a project restored before it ran', async () => {
    await registrar.setEnabled(projectId, { bing: true });
    await registrar.prepare(projectId, SITE);
    bingDown = true;
    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnDelete(projectId);
    await projects.restore(projectId); // the restore's own cancel has not run (or lost a race)
    bingDown = false;
    now = hours(1);
    await registrar.retryRemovals();
    expect(await removals()).toEqual([]);
    expect(calls.filter((c) => c.endsWith('/RemoveSite'))).toHaveLength(1);
    expect(await bingRow()).toMatchObject({ siteUrl: SITE });
  });
});

describe('what an account still holds (System Settings refuses to remove it meanwhile)', () => {
  it('counts the live projects’ registered sites, and the sites still being removed', async () => {
    expect(await registrar.registeredWith('bing')).toEqual({ sites: 0, pending: 0 });
    await registrar.setEnabled(projectId, { bing: true });
    expect(await registrar.registeredWith('bing')).toEqual({ sites: 0, pending: 0 }); // switched on, nothing registered yet
    await registrar.prepare(projectId, SITE);
    expect(await registrar.registeredWith('bing')).toEqual({ sites: 1, pending: 0 });
    expect(await registrar.registeredWith('google')).toEqual({ sites: 0, pending: 0 });
    bingDown = true;
    await projects.softDelete(projectId, 'someone');
    await registrar.removeOnDelete(projectId);
    expect(await registrar.registeredWith('bing')).toEqual({ sites: 0, pending: 1 });
    // Registered with an account the platform no longer has: nothing the current one holds.
    await accounts.apply({ bing: { secret: { apiKey: 'fedcba9876543210fedcba9876543210' }, info: {} } });
    expect(await registrar.registeredWith('bing')).toEqual({ sites: 0, pending: 0 });
  });
});
