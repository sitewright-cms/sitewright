import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './helpers.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { WebmasterRepository } from '../src/webmaster/repo.js';
import { SiteRegistrar } from '../src/webmaster/sites.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * The registrar on its own: what it asks the search engines, when, and with which tag — the rules a publish or deploy
 * relies on but cannot show (concurrent builds, a build that is not the latest, a cache in front of the host).
 */

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SITE = 'https://www.example.com/';

let calls: string[];
let tokenAnswers: string[];
let verifyAnswers: Array<'ok' | 'missing'>;
const fetch: FetchLike = async (url) => {
  const path = url.split('?')[0]!;
  calls.push(path);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.endsWith('/siteVerification/v1/token')) {
    await new Promise((r) => setTimeout(r, 20));
    return answer(200, { method: 'META', token: `<meta name="google-site-verification" content="${tokenAnswers.shift() ?? 'gTag_default1'}" />` });
  }
  if (path.endsWith('/siteVerification/v1/webResource')) {
    return (verifyAnswers.shift() ?? 'ok') === 'ok' ? answer(200, { id: 'x' }) : answer(400, { error: { message: 'The necessary verification token could not be found on your site.' } });
  }
  return answer(200, {});
};

let registrar: SiteRegistrar;
let projectId: string;

async function make(verifyRetryMs = 0): Promise<SiteRegistrar> {
  const db = await makeTestDb();
  projectId = (await new ProjectRepository(db).create({ name: 'Reg', slug: `reg-${randomBytes(3).toString('hex')}` })).id;
  const accounts = new WebmasterRepository(db, randomBytes(32));
  await accounts.apply({
    google: {
      secret: { clientEmail: 'seo@p-123.iam.gserviceaccount.com', privateKey: PEM, privateKeyId: 'a1b2c3d4e5f6', projectId: 'p-123' },
      info: { clientEmail: 'seo@p-123.iam.gserviceaccount.com', projectId: 'p-123' },
    },
  });
  return new SiteRegistrar({ db, accounts, io: { fetch }, log: { info: () => {}, warn: () => {} }, verifyRetryMs });
}

const verifies = (): number => calls.filter((c) => c.endsWith('/webResource')).length;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  calls = [];
  tokenAnswers = ['gTag_first111'];
  verifyAnswers = [];
  registrar = await make();
});

describe('SiteRegistrar', () => {
  it('two first builds at once ask Google for the tag once, and both carry it', async () => {
    const [a, b] = await Promise.all([registrar.tagsFor(projectId, SITE), registrar.tagsFor(projectId, SITE)]);
    expect(a).toEqual({ google: 'gTag_first111' });
    expect(b).toEqual({ google: 'gTag_first111' });
    expect(calls.filter((c) => c.endsWith('/siteVerification/v1/token'))).toHaveLength(1);
  });

  it('verifies only with the tag the live build carried', async () => {
    const tags = await registrar.tagsFor(projectId, SITE);
    // A build from before this tag existed (or for another URL) went live: nothing it carries can be verified.
    registrar.afterDeploy(projectId, { google: 'gTag_stale999' });
    registrar.afterDeploy(projectId, {});
    registrar.afterDeploy(projectId, undefined);
    await registrar.settled(projectId);
    expect(verifies()).toBe(0);
    expect((await registrar.view(projectId, SITE)).google.status).toBe('pending');

    registrar.afterDeploy(projectId, tags);
    await registrar.settled(projectId);
    expect(verifies()).toBe(1);
    expect((await registrar.view(projectId, SITE)).google).toMatchObject({ status: 'verified', detail: 'Verified and added to Search Console' });

    // Verified stays verified: the next live build asks nothing.
    registrar.afterDeploy(projectId, tags);
    await registrar.settled(projectId);
    expect(verifies()).toBe(1);
  });

  it('asks once more a little later when the search engine did not find the tag yet', async () => {
    registrar = await make(30);
    verifyAnswers = ['missing', 'ok'];
    const tags = await registrar.tagsFor(projectId, SITE);
    registrar.afterDeploy(projectId, tags);
    await registrar.settled(projectId);
    expect((await registrar.view(projectId, SITE)).google.status).toBe('failed');
    await wait(80);
    await registrar.settled(projectId);
    expect(verifies()).toBe(2);
    expect((await registrar.view(projectId, SITE)).google.status).toBe('verified');
  });

  it('asks only once more, and close() cancels the second ask', async () => {
    registrar = await make(30);
    verifyAnswers = ['missing', 'missing', 'missing'];
    const tags = await registrar.tagsFor(projectId, SITE);
    registrar.afterDeploy(projectId, tags);
    await registrar.settled(projectId);
    await wait(120);
    await registrar.settled(projectId);
    expect(verifies()).toBe(2);

    registrar.afterDeploy(projectId, tags);
    await registrar.settled(projectId);
    registrar.close();
    await wait(80);
    expect(verifies()).toBe(3);
  });

  it('a new Site URL gets its own tag, and the old one is no longer shown', async () => {
    tokenAnswers = ['gTag_first111', 'gTag_second22'];
    expect(await registrar.tagsFor(projectId, SITE)).toEqual({ google: 'gTag_first111' });
    expect(await registrar.tagsFor(projectId, 'https://shop.example.com')).toEqual({ google: 'gTag_second22' });
    expect((await registrar.view(projectId, SITE)).google.status).toBe('none');
    expect((await registrar.view(projectId, 'https://shop.example.com/')).google.status).toBe('pending');
    expect(await registrar.tagsFor(projectId, 'http://shop.example.com')).toEqual({});
  });
});
