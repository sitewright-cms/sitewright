import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteRegistrationView } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * SITE REGISTRATION through a REMOTE deploy (SFTP here): the uploaded build carries the tags, and only an upload
 * that succeeded is followed by verification. The upload is faked; the build and the bookkeeping are real.
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
const fakeEngines: FetchLike = async (url) => {
  const path = url.split('?')[0]!;
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === '' ? '' : JSON.stringify(body)) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
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

async function settled(): Promise<SiteRegistrationView> {
  for (let i = 0; i < 100; i++) {
    const v = (await owner.get(`/projects/${projectId}/search-engines`)).json() as SiteRegistrationView;
    if (v.google.status === 'verified' && v.bing.status === 'verified') return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('registration never settled');
}

describe('site registration through a remote deploy', () => {
  it('uploads a build carrying both tags, then has the site verified', async () => {
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(200);
    expect(upload.homes[0]).toContain(`<meta name="google-site-verification" content="${GOOGLE_TAG}" />`);
    expect(upload.homes[0]).toContain(`<meta name="msvalidate.01" content="${BING_CODE}" />`);
    await settled();
    expect(verifies.sort()).toEqual(['bing', 'google']);
  });

  it('the streaming deploy (the editor’s) registers too', async () => {
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy/stream`, {})).body).toContain('event: done');
    await settled();
  });

  it('asks nobody to verify a site whose upload failed', async () => {
    upload.fail = true;
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(502);
    expect(upload.homes[0]).toContain(GOOGLE_TAG);
    await new Promise((r) => setTimeout(r, 100));
    expect(verifies).toEqual([]);
    const v = (await owner.get(`/projects/${projectId}/search-engines`)).json() as SiteRegistrationView;
    expect(v.google.status).toBe('pending');
  });
});
