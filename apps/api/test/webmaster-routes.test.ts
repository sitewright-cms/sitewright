import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebmasterAccountsView } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { webmasterCredentials } from '../src/db/schema.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * The platform's search engine accounts over HTTP: only an instance admin in a session reaches them, a secret
 * goes in and never comes out (not in an answer, not in plain text at rest), and a test reads with the stored key.
 */

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const EMAIL = 'sitewright-seo@sitewright-seo-123.iam.gserviceaccount.com';
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  project_id: 'sitewright-seo-123',
  private_key_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  private_key: PEM,
  client_email: EMAIL,
});
const BING_KEY = '0123456789abcdef0123456789abcdef';
const PEM_BODY = PEM.split('\n')[1]!;

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;
let calls: string[];

const fakeEngines: FetchLike = async (url) => {
  calls.push(url);
  const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'ya29.token' });
  if (url.startsWith('https://www.googleapis.com/siteVerification/')) return json({ items: [{ id: 'x' }] });
  if (url.startsWith('https://www.googleapis.com/webmasters/')) return json({ siteEntry: [{ siteUrl: 'https://a.example/' }, { siteUrl: 'https://b.example/' }] });
  if (url.startsWith('https://ssl.bing.com/')) return json({ d: [{ Url: 'https://a.example/', IsVerified: true }] });
  return { ok: false, status: 404, text: async () => '{}' };
};

beforeEach(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-webmaster-'));
  db = await makeTestDb();
  calls = [];
  app = await createApp({
    db,
    previewRoot,
    cookieSecret: 'webmaster-test-secret',
    encryptionKey: randomBytes(32),
    rankTickMs: 0,
    webmasterFetch: fakeEngines,
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(previewRoot, { recursive: true, force: true });
});

async function session(email: string, platformRole?: 'admin' | 'developer'): Promise<string> {
  await registerAccount(db, email, 'Pw-secret-1', platformRole ? { platformRole } : {});
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
const as = (t: string) => ({ cookies: { sw_session: t } });

describe('search engine accounts', () => {
  it('stores both accounts encrypted, shows only who the Google key belongs to, and tests each with what is stored', async () => {
    const admin = await session('admin@agency.test', 'admin');
    const empty = (await app.inject({ method: 'GET', url: '/admin/webmaster-accounts', ...as(admin) })).json() as WebmasterAccountsView;
    expect(empty).toEqual({ google: { configured: false, clientEmail: null, projectId: null, updatedAt: null }, bing: { configured: false, updatedAt: null } });

    const put = await app.inject({ method: 'PUT', url: '/admin/webmaster-accounts', ...as(admin), payload: { google: { keyFile: KEY_FILE }, bing: { apiKey: BING_KEY } } });
    expect(put.statusCode).toBe(200);
    const view = put.json() as WebmasterAccountsView;
    expect(view).toMatchObject({ google: { configured: true, clientEmail: EMAIL, projectId: 'sitewright-seo-123' }, bing: { configured: true } });
    expect(put.body).not.toContain(PEM_BODY);
    expect(put.body).not.toContain(BING_KEY);
    const got = await app.inject({ method: 'GET', url: '/admin/webmaster-accounts', ...as(admin) });
    expect(got.json()).toEqual(view);
    expect(got.body).not.toContain(PEM_BODY);

    // At rest: neither secret is readable in the row.
    const rows = JSON.stringify(await db.select().from(webmasterCredentials));
    expect(rows).not.toContain(PEM_BODY);
    expect(rows).not.toContain(BING_KEY);

    const test = (service: string) => app.inject({ method: 'POST', url: '/admin/webmaster-accounts/test', ...as(admin), payload: { service } });
    const google = await test('google');
    expect(google.json()).toEqual({ ok: true, detail: `Connected as ${EMAIL} · 1 site verified · 2 in Search Console` });
    const bing = await test('bing');
    expect(bing.json()).toEqual({ ok: true, detail: 'Connected · 1 site on the account, 1 verified' });
    expect(calls.at(-1)).toBe(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${BING_KEY}`);
    expect((await test('yahoo')).statusCode).toBe(400);
  });

  it('keeps what a save leaves out, removes on null, and checks everything before storing anything', async () => {
    const admin = await session('admin@agency.test', 'admin');
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/admin/webmaster-accounts', ...as(admin), payload });
    await put({ google: { keyFile: KEY_FILE } });

    // A bad Bing key refuses the whole save: the Google key in the same request is not stored either.
    const other = KEY_FILE.replace('sitewright-seo-123"', 'another-project-9"');
    const refused = await put({ google: { keyFile: other }, bing: { apiKey: 'not a key' } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: 'bing.apiKey: a Bing Webmaster API key is 16 to 128 letters and digits' });
    const notAKey = await put({ google: { keyFile: '{"type":"authorized_user"}' } });
    expect(notAKey.statusCode).toBe(400);
    expect((notAKey.json() as { error: string }).error).toMatch(/^This is not a Google service-account key file/);
    expect((await put({ google: { keyFile: 'x' }, extra: 1 })).statusCode).toBe(400);

    const kept = (await put({ bing: { apiKey: BING_KEY } })).json() as WebmasterAccountsView;
    expect(kept).toMatchObject({ google: { configured: true, projectId: 'sitewright-seo-123' }, bing: { configured: true } });

    const removed = (await put({ google: null })).json() as WebmasterAccountsView;
    expect(removed).toMatchObject({ google: { configured: false, clientEmail: null }, bing: { configured: true } });
    const test = await app.inject({ method: 'POST', url: '/admin/webmaster-accounts/test', ...as(admin), payload: { service: 'google' } });
    expect(test.json()).toEqual({ ok: false, error: 'No Google service-account key is stored' });
  });

  it('is for instance admins in a session only: not developers, clients, tokens or strangers', async () => {
    const developer = await session('dev@agency.test', 'developer');
    const client = await session('client@shop.test');
    for (const t of [developer, client]) {
      expect((await app.inject({ method: 'GET', url: '/admin/webmaster-accounts', ...as(t) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: '/admin/webmaster-accounts', ...as(t), payload: { bing: { apiKey: BING_KEY } } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/admin/webmaster-accounts/test', ...as(t), payload: { service: 'bing' } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/admin/webmaster-accounts' })).statusCode).toBe(401);
    const bearer = await app.inject({ method: 'GET', url: '/admin/webmaster-accounts', headers: { authorization: 'Bearer swm_whatever' } });
    expect(bearer.statusCode).toBe(403);
    expect(await db.select().from(webmasterCredentials)).toEqual([]);
  });
});
