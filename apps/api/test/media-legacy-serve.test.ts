import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { content } from '../src/db/schema.js';
import { MediaStorage } from '../src/media/storage.js';

/**
 * The LEGACY delivery routes (`/media/<slug>/<uuid>/<file>` and `…/<uuid>/file/<name>`), which still
 * serve un-migrated assets.
 *
 * These branches had no coverage at all, which mattered once the cache policy changed: an asset whose
 * bytes can be overwritten in place must revalidate, and that has to hold on the legacy path too — an
 * un-migrated project is exactly the one whose media has been around long enough to be edited. A FONT
 * is the deliberate exception (replace refuses a multi-file family, so its URL really is immutable).
 *
 * Legacy assets can only be planted directly: every upload path now mints a short flat id.
 */

const UUID = (n: number) => `3f8a1c2e-9b4d-4e6a-8c1f-00000000000${n}`;
const IMG = UUID(1);
const CSS = UUID(2);
const JS = UUID(3);
const SVG = UUID(4);
const PDF = UUID(5);
const BIN = UUID(6);
const FONT = UUID(7);

/** 32×16 solid green JPEG — a real raster so the thumbnailer has something to encode. */
const JPEG = Buffer.from(
  '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmARTPAAH/9k=',
  'base64',
);

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;
let storage: MediaStorage;
let projectId: string;

beforeEach(async () => {
  db = await makeTestDb();
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-legacy-serve-'));
  storage = new MediaStorage(mediaRoot);
  app = await createApp({ db, mediaRoot });
  await app.ready();

  await registerAccount(db, 'dev@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = (
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'dev@acme.test', password: 'Pw-secret-1' } })
  ).cookies.find((c) => c.name === 'sw_session')!.value;
  projectId = (
    (await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'P', slug: 'p' } })).json() as {
      project: { id: string };
    }
  ).project.id;

  // Plant legacy-shaped rows + binaries directly: no upload path produces a uuid id any more.
  const raw = async (entityId: string, data: unknown) => {
    await db.insert(content).values({
      id: `raw-media-${entityId}`,
      projectId,
      kind: 'media' as never,
      entityId,
      scope: '',
      data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  };
  await raw(IMG, { kind: 'image', id: IMG, filename: 'photo.jpg', folder: '', format: 'jpeg', bytes: JPEG.length,
    width: 32, height: 16, hasAlpha: false, animated: false, original: 'photo.jpg', url: `/media/p/${IMG}/photo.jpg` });
  await raw(SVG, { kind: 'image', id: SVG, filename: 'logo.svg', folder: '', format: 'svg', bytes: 60, width: 40, height: 40,
    hasAlpha: true, animated: false, original: 'logo.svg', url: `/media/p/${SVG}/logo.svg` });
  await raw(CSS, { kind: 'stylesheet', id: CSS, filename: 'site.css', folder: '', bytes: 20, storedName: 'site.css',
    url: `/media/p/${CSS}/site.css` });
  await raw(JS, { kind: 'script', id: JS, filename: 'site.js', folder: '', bytes: 18, storedName: 'site.js',
    url: `/media/p/${JS}/site.js` });
  await raw(PDF, { kind: 'file', id: PDF, filename: 'terms.pdf', folder: '', bytes: 9, contentType: 'application/pdf',
    storedName: 'terms.pdf', url: `/media/p/${PDF}/file/terms.pdf` });
  await raw(BIN, { kind: 'file', id: BIN, filename: 'data.zip', folder: '', bytes: 4, contentType: 'application/zip',
    storedName: 'data.zip', url: `/media/p/${BIN}/file/data.zip` });
  await raw(FONT, { kind: 'font', id: FONT, filename: 'Inter', folder: '', bytes: 6, family: 'Inter', fallback: 'sans-serif',
    source: 'local', files: [{ weight: 400, style: 'normal', format: 'woff2', file: 'inter-400.woff2' }],
    url: `/media/p/${FONT}/inter-400.woff2` });

  await storage.storeFile('p', IMG, 'photo.jpg', JPEG);
  await storage.storeFile('p', SVG, 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'));
  await storage.storeFile('p', CSS, 'site.css', Buffer.from('body{color:red}'));
  await storage.storeFile('p', JS, 'site.js', Buffer.from('console.log(1)'));
  await storage.storeFile('p', PDF, 'terms.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'));
  await storage.storeFile('p', BIN, 'data.zip', Buffer.from('PK'));
  await storage.storeFile('p', FONT, 'inter-400.woff2', Buffer.from('wOF2--'));
});
afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

/** A replaceable asset must revalidate and honour its own validator. */
async function expectRevalidates(url: string, expectType?: RegExp) {
  const first = await app.inject({ method: 'GET', url });
  expect(first.statusCode, `${url}: ${first.body?.slice?.(0, 120)}`).toBe(200);
  expect(String(first.headers['cache-control'])).not.toContain('immutable');
  const etag = String(first.headers.etag);
  expect(etag, `${url} must carry a validator`).toBeTruthy();
  if (expectType) expect(String(first.headers['content-type'])).toMatch(expectType);
  const again = await app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } });
  expect(again.statusCode, `${url} must 304 on a matching validator`).toBe(304);
  return first;
}

describe('legacy media delivery — revalidating cache on the un-migrated path', () => {
  it('serves a legacy raster thumbnail and its original revalidating', async () => {
    await expectRevalidates(`/media/p/${IMG}/photo.jpg`, /image\/webp/);
    await expectRevalidates(`/media/p/${IMG}/photo.jpg?size=original`, /image\/jpeg/);
  });

  it('serves a legacy SVG inline, sandboxed, and revalidating', async () => {
    const res = await expectRevalidates(`/media/p/${SVG}/logo.svg`, /image\/svg\+xml/);
    // The strict policy must survive on BOTH the 200 and the 304, or a cached 200 gets it weakened.
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
    const cond = await app.inject({ method: 'GET', url: `/media/p/${SVG}/logo.svg`, headers: { 'if-none-match': String(res.headers.etag) } });
    expect(cond.statusCode).toBe(304);
    expect(String(cond.headers['content-security-policy'])).toContain('sandbox');
  });

  it('serves a legacy stylesheet and script inline (CORS) and revalidating', async () => {
    const css = await expectRevalidates(`/media/p/${CSS}/site.css`, /text\/css/);
    expect(css.headers['access-control-allow-origin']).toBe('*');
    const js = await expectRevalidates(`/media/p/${JS}/site.js`, /text\/javascript/);
    expect(js.headers['access-control-allow-origin']).toBe('*');
  });

  it('serves a legacy PDF inline-frameable and a raw file as an attachment, both revalidating', async () => {
    const pdf = await expectRevalidates(`/media/p/${PDF}/file/terms.pdf`, /application\/pdf/);
    expect(String(pdf.headers['x-frame-options'])).toBe('SAMEORIGIN');
    const bin = await expectRevalidates(`/media/p/${BIN}/file/data.zip`, /application\/octet-stream/);
    expect(String(bin.headers['content-disposition'])).toContain('attachment');
  });

  it('keeps the year-long cache for a FONT — the one kind replace refuses', async () => {
    const res = await app.inject({ method: 'GET', url: `/media/p/${FONT}/inter-400.woff2` });
    expect(res.statusCode).toBe(200);
    // A font family is many files, so it cannot be replaced in place; its URL is genuinely immutable.
    expect(String(res.headers['cache-control'])).toContain('immutable');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('404s an unknown legacy file without leaking whether the asset exists', async () => {
    expect((await app.inject({ method: 'GET', url: `/media/p/${IMG}/missing.jpg` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/media/p/${UUID(9)}/photo.jpg` })).statusCode).toBe(404);
  });
});
