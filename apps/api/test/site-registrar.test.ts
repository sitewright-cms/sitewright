import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './helpers.js';
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
const fetch: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  calls.push(`${init.method} ${path}`);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.endsWith('/siteVerification/v1/token')) {
    await new Promise((r) => setTimeout(r, 20));
    return answer(200, { method: 'META', token: '<meta name="google-site-verification" content="gTag_first111" />' });
  }
  if (path.endsWith('/GetUserSites')) return answer(200, { d: calls.some((c) => c.endsWith('/AddSite')) ? [{ Url: SITE, AuthenticationCode: bingCode }] : [] });
  if (path.endsWith('/AddSite') || path.endsWith('/RemoveSite')) return answer(200, { d: null });
  return answer(200, {});
};

let registrar: SiteRegistrar;
let projectId: string;

beforeEach(async () => {
  calls = [];
  bingCode = 'B1NGC0DE0001';
  const db = await makeTestDb();
  projectId = (await new ProjectRepository(db).create({ name: 'Reg', slug: `reg-${randomBytes(3).toString('hex')}` })).id;
  const accounts = new WebmasterRepository(db, randomBytes(32));
  await accounts.apply({
    google: {
      secret: { clientEmail: 'seo@p-123.iam.gserviceaccount.com', privateKey: PEM, privateKeyId: 'a1b2c3d4e5f6', projectId: 'p-123' },
      info: { clientEmail: 'seo@p-123.iam.gserviceaccount.com', projectId: 'p-123' },
    },
    bing: { secret: { apiKey: '0123456789abcdef0123456789abcdef' }, info: {} },
  });
  registrar = new SiteRegistrar({ db, accounts, io: { fetch }, log: { info: () => {}, warn: () => {} } });
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
