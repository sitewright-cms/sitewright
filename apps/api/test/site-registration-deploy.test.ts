import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * SITE REGISTRATION and a REMOTE deploy (SFTP here): once staff have switched a search engine on and its tag is ready,
 * every uploaded build carries it — and the deploy itself asks Google and Bing nothing. The upload is faked; the build
 * and the bookkeeping are real.
 */

const upload = vi.hoisted(() => ({ fail: false, homes: [] as string[] }));
vi.mock('../src/publish/adapters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/publish/adapters.js')>();
  return {
    ...actual,
    deploySite: vi.fn(async (dir: string) => {
      upload.homes.push(await readFile(join(dir, 'index.html'), 'utf8'));
      if (upload.fail) throw new Error('connect ECONNREFUSED');
      return { protocol: 'sftp', files: 1, uploaded: 1, skipped: 0, removed: 0, strategy: 'full', bytes: 1 };
    }),
  };
});

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
const GOOGLE_TAG = 'gOOgle-Tag_1234567890';
const BING_CODE = '0A1B2C3D4E5F60718293A4B5C6D7E8F9';

let verifies: string[];
let calls: string[];
/** The live site still carries Google's tag: Google refuses to give the ownership up (its measured answer). */
let tagLive: boolean;
const fakeEngines: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  calls.push(path);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === '' ? '' : JSON.stringify(body)) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (init.method === 'DELETE' && path.startsWith('https://www.googleapis.com/siteVerification/v1/webResource/')) {
    if (!tagLive) return answer(204, '');
    const message = 'You cannot unverify your ownership of this site until your verification token (meta tag, HTML file, Google Analytics tracking code, Google Tag Manager container code, or DNS record) has been removed.';
    return answer(400, { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'badRequest' }] } });
  }
  if (path.endsWith('/siteVerification/v1/token')) return answer(200, { method: 'META', token: `<meta name="google-site-verification" content="${GOOGLE_TAG}" />` });
  if (path.endsWith('/siteVerification/v1/webResource')) {
    verifies.push('google');
    return answer(200, { id: 'x' });
  }
  if (path.startsWith('https://www.googleapis.com/webmasters/v3/sites/')) return answer(204, '');
  if (path.endsWith('/GetUserSites')) return answer(200, { d: [{ Url: 'https://www.shop.test/', AuthenticationCode: BING_CODE }] });
  if (path.endsWith('/VerifySite')) {
    verifies.push('bing');
    return answer(200, { d: true });
  }
  return answer(404, {});
};

let h: Harness;
let owner: TestClient;
let projectId: string;
let targetId: string;
let publishRoot: string;

beforeEach(async () => {
  upload.fail = false;
  upload.homes = [];
  verifies = [];
  calls = [];
  tagLive = false;
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-site-reg-deploy-'));
  h = await makeHarness({ publicUrl: 'https://sw.test', publishRoot, deployAllowedHosts: ['allowed.example.com'], webmasterFetch: fakeEngines, rankTickMs: 0 });
  owner = await h.signup({ admin: true });
  expect((await owner.put('/admin/webmaster-accounts', { google: { keyFile: KEY_FILE }, bing: { apiKey: '0123456789abcdef0123456789abcdef' } })).statusCode).toBe(200);
  projectId = await owner.createProject('Shop', 'shop', { localHosting: false });
  const proj = owner.project(projectId);
  await proj.putContent('settings', 'settings', { identity: { name: 'Shop' }, settings: {}, website: { siteUrl: 'https://www.shop.test/' } });
  await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<h1>Hi</h1>' });
  const target = await owner.post(`/projects/${projectId}/deploy-targets`, {
    name: 'Webspace', protocol: 'sftp', host: 'allowed.example.com', user: 'deployer', password: 'pw', remoteDir: '/var/www',
  });
  targetId = (target.json() as { target: { id: string } }).target.id;
});
afterEach(async () => {
  await h.close();
  await rm(publishRoot, { recursive: true, force: true });
});

describe('site registration and a remote deploy', () => {
  it('uploads a build carrying the switched-on tags, and asks the search engines nothing', async () => {
    expect((await owner.put(`/projects/${projectId}/search-engines`, { google: true, bing: true })).statusCode).toBe(200);
    expect((await owner.post(`/projects/${projectId}/search-engines/prepare`, {})).statusCode).toBe(200);
    calls = [];
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(200);
    expect(upload.homes[0]).toContain(`<meta name="google-site-verification" content="${GOOGLE_TAG}" />`);
    expect(upload.homes[0]).toContain(`<meta name="msvalidate.01" content="${BING_CODE}" />`);
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy/stream`, {})).body).toContain('event: done');
    expect(upload.homes[1]).toContain(GOOGLE_TAG);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]);
    expect(verifies).toEqual([]);
  });

  it('uploads no tag for a search engine that is off', async () => {
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(200);
    expect(upload.homes[0]).toContain('<h1>Hi</h1>');
    expect(upload.homes[0]).not.toMatch(/google-site-verification|msvalidate/);
    expect(calls).toEqual([]);
  });

  /**
   * ★ Google keeps an ownership while the live site carries its tag, and builds carry the tag while the switch is on —
   * so before the fix switching Google off "stayed on to try again" and never could. Found on a real site.
   */
  it('★ switching Google off while the live site carries the tag: off now, the ownership given up after the next deploy', async () => {
    const siteResource = `https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent('https://www.shop.test/')}`;
    expect((await owner.put(`/projects/${projectId}/search-engines`, { google: true })).statusCode).toBe(200);
    expect((await owner.post(`/projects/${projectId}/search-engines/prepare`, {})).statusCode).toBe(200);
    tagLive = true;

    const off = await owner.put(`/projects/${projectId}/search-engines`, { google: false });
    expect(off.statusCode).toBe(200);
    const detail = "Removed from Search Console. Google keeps the platform's ownership while the site still carries its tag: it is given up once a deploy has taken the tag off";
    expect(off.json()).toMatchObject({ removed: { google: { ok: true, detail } }, view: { google: { enabled: false } } });

    // The deploy that takes the tag off the live site…
    tagLive = false;
    calls = [];
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(200);
    expect(upload.homes[0]).toContain('<h1>Hi</h1>');
    expect(upload.homes[0]).not.toContain('google-site-verification');
    // …and, after it, the ownership given up (in the background: the deploy's answer does not wait for Google).
    await vi.waitFor(() => expect(calls).toContain(siteResource));
    await vi.waitFor(async () => {
      const view = (await owner.get(`/projects/${projectId}/search-engines`)).json() as { google: { detail: string | null } };
      expect(view.google.detail).toBe('Removed from Search Console, and the ownership given up');
    });
  });
});
