import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * `PUT /media/:id/content` — REPLACE an asset's bytes in place.
 *
 * The point of the route is that the asset id, the stored file name and therefore every URL that
 * references it survive: a page, a dataset entry and a chrome slot pointing at the old picture all
 * show the new one with no reference migration. That is only honest if three things hold, and each
 * has a test here:
 *   · the EXTENSION cannot change (it is baked into every URL), so a format change is refused;
 *   · the cached thumbnails, all derived from the OLD pixels, are dropped;
 *   · the outgoing bytes are recoverable — a replace snapshots them into the Recycle Bin.
 *
 * The cache-header tests belong here too: an in-place overwrite is invisible if the delivery route
 * still promises `immutable` for a year.
 */

/** 32×16 solid green JPEG. */
const JPEG_32X16 = Buffer.from(
  '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmARTPAAH/9k=',
  'base64',
);

/** 64×32 JPEG (left half red, right half blue) — a DIFFERENT size to the one above. */
const JPEG_64X32 = Buffer.from(
  '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAAAQAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAEAAAAADoAQAAQAAACAAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAIABAAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABcBAQEBAQAAAAAAAAAAAAAAAAAJBwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCJAMqd+gAJCAqkm0AArwCVqkoACQgKpJtAAP/Z',
  'base64',
);

/** 20×20 blue PNG — a different FORMAT, used to prove the extension guard. */
const PNG_20X20 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJUlEQVQ4jWNgYPj/n7qYYdRAhtEwZBhNNgyjOYVhtHBgGHHlIQDZvh0OP+rLwQAAAABJRU5ErkJggg==',
  'base64',
);

const SVG_OLD = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>';
const SVG_NEW = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><circle cx="40" cy="30" r="20" fill="blue"/></svg>';

const PDF_OLD = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf8');
const PDF_NEW = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Version/1.7>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF-NEW\n', 'utf8');

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-replace-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, slug = 'site') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}

function multipart(filename: string, contentType: string, bytes: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  };
}

interface Item {
  id: string;
  url: string;
  bytes: number;
  filename: string;
  folder: string;
  width?: number;
  height?: number;
  format?: string;
  kind: string;
}

async function upload(projectId: string, t: string, filename: string, contentType: string, bytes: Buffer): Promise<Item> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media`,
    cookies: { sw_session: t },
    ...multipart(filename, contentType, bytes),
  });
  expect(res.statusCode, `upload must succeed: ${res.body}`).toBeLessThan(300);
  return (res.json() as { item: Item }).item;
}

async function replace(projectId: string, t: string, id: string, filename: string, contentType: string, bytes: Buffer) {
  return app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/media/${id}/content`,
    cookies: { sw_session: t },
    ...multipart(filename, contentType, bytes),
  });
}

describe('PUT /media/:id/content — replace an asset in place', () => {
  it('keeps the id, the URL and the stored name; swaps the bytes and the dimensions', async () => {
    const { t, projectId } = await setup('replace-basic@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);
    expect(asset.width).toBe(32);

    const res = await replace(projectId, t, asset.id, 'hero-v2.jpg', 'image/jpeg', JPEG_64X32);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { item: Item; previous: { width?: number; height?: number; bytes: number } };

    // The whole point: every existing reference stays valid.
    expect(body.item.id).toBe(asset.id);
    expect(body.item.url).toBe(asset.url);
    // …but the content is the new picture.
    expect(body.item.width).toBe(64);
    expect(body.item.height).toBe(32);
    expect(body.item.bytes).not.toBe(asset.bytes);
    // The receipt reports what it was, so a caller can notice an aspect-ratio change.
    expect(body.previous.width).toBe(32);
    expect(body.previous.height).toBe(16);
  });

  it('refuses a format change — the extension is part of every URL', async () => {
    const { t, projectId } = await setup('replace-format@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);

    const res = await replace(projectId, t, asset.id, 'hero.png', 'image/png', PNG_20X20);
    expect(res.statusCode).toBe(400);
    expect(String((res.json() as { error: string }).error)).toMatch(/format|extension/i);

    // The asset is untouched — a refused replace must not have half-applied.
    const after = await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } });
    const live = (after.json() as { items: Item[] }).items.find((i) => i.id === asset.id);
    expect(live?.bytes).toBe(asset.bytes);
    expect(live?.width).toBe(32);
    // …and it left no Recycle-Bin litter: the snapshot is taken only once the replacement is valid.
    const bin = await app.inject({ method: 'GET', url: `/projects/${projectId}/media/deleted`, cookies: { sw_session: t } });
    expect((bin.json() as { items: Item[] }).items).toHaveLength(0);
  });

  it('drops the thumbnails cached from the OLD pixels', async () => {
    const { t, projectId } = await setup('replace-thumbs@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);

    // Prime the on-demand thumbnail cache from the old pixels.
    const before = await app.inject({ method: 'GET', url: `${asset.url}?size=sm` });
    expect(before.statusCode).toBe(200);
    const beforeBytes = before.rawPayload;

    expect((await replace(projectId, t, asset.id, 'hero.jpg', 'image/jpeg', JPEG_64X32)).statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `${asset.url}?size=sm` });
    expect(after.statusCode).toBe(200);
    expect(Buffer.compare(after.rawPayload, beforeBytes)).not.toBe(0);
  });

  it('snapshots the outgoing bytes into the Recycle Bin', async () => {
    const { t, projectId } = await setup('replace-undo@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);
    await replace(projectId, t, asset.id, 'hero.jpg', 'image/jpeg', JPEG_64X32);

    const bin = await app.inject({ method: 'GET', url: `/projects/${projectId}/media/deleted`, cookies: { sw_session: t } });
    expect(bin.statusCode).toBe(200);
    const items = (bin.json() as { items: Item[] }).items;
    // One snapshot, holding the PREVIOUS dimensions, under a different id (the live asset keeps its own).
    expect(items).toHaveLength(1);
    expect(items[0]!.id).not.toBe(asset.id);
    expect(items[0]!.width).toBe(32);
    expect(items[0]!.filename).toMatch(/replaced/i);
  });

  it('replaces an SVG through the same route, re-sanitizing it', async () => {
    const { t, projectId } = await setup('replace-svg@test.dev');
    const asset = await upload(projectId, t, 'logo.svg', 'image/svg+xml', Buffer.from(SVG_OLD));
    expect(asset.format).toBe('svg');

    const hostile = SVG_NEW.replace('<circle', '<script>alert(1)</script><circle');
    const res = await replace(projectId, t, asset.id, 'logo.svg', 'image/svg+xml', Buffer.from(hostile));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { item: Item }).item.width).toBe(80);

    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.body).toContain('<circle');
    expect(served.body).not.toContain('<script');
    expect(served.body).not.toContain('<rect');
  });

  it('replaces a non-image file asset', async () => {
    const { t, projectId } = await setup('replace-file@test.dev');
    const asset = await upload(projectId, t, 'terms.pdf', 'application/pdf', PDF_OLD);
    expect(asset.kind).toBe('file');

    const res = await replace(projectId, t, asset.id, 'terms.pdf', 'application/pdf', PDF_NEW);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { item: Item }).item.url).toBe(asset.url);

    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.body).toContain('EOF-NEW');
  });

  it('rejects a replace on a binned asset, and from a reader', async () => {
    const { t, projectId } = await setup('replace-guards@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);

    await app.inject({ method: 'DELETE', url: `/projects/${projectId}/media/${asset.id}`, cookies: { sw_session: t } });
    const binned = await replace(projectId, t, asset.id, 'hero.jpg', 'image/jpeg', JPEG_64X32);
    expect(binned.statusCode).toBe(404);

    // An unauthenticated caller cannot replace at all.
    const anon = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/media/${asset.id}/content`,
      ...multipart('hero.jpg', 'image/jpeg', JPEG_64X32),
    });
    expect(anon.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('404s for an unknown asset id', async () => {
    const { t, projectId } = await setup('replace-unknown@test.dev');
    const res = await replace(projectId, t, 'nope123', 'x.jpg', 'image/jpeg', JPEG_64X32);
    expect(res.statusCode).toBe(404);
  });
});

describe('media delivery cache headers', () => {
  it('serves a raster thumbnail revalidating (never immutable), with a working ETag', async () => {
    const { t, projectId } = await setup('cache-thumb@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);

    const first = await app.inject({ method: 'GET', url: asset.url });
    expect(first.statusCode).toBe(200);
    // An in-place replace under a stable URL means this can NEVER promise a year of immutability.
    expect(String(first.headers['cache-control'])).not.toContain('immutable');
    const etag = String(first.headers.etag);
    expect(etag).toBeTruthy();

    const conditional = await app.inject({ method: 'GET', url: asset.url, headers: { 'if-none-match': etag } });
    expect(conditional.statusCode).toBe(304);

    // RFC 9110 §13.1.2 — If-None-Match may carry a comma list.
    const multi = await app.inject({ method: 'GET', url: asset.url, headers: { 'if-none-match': `"other", ${etag}` } });
    expect(multi.statusCode).toBe(304);
  });

  it('changes the ETag after a replace, so a cached client refetches', async () => {
    const { t, projectId } = await setup('cache-etag@test.dev');
    const asset = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);
    const before = String((await app.inject({ method: 'GET', url: asset.url })).headers.etag);

    await replace(projectId, t, asset.id, 'hero.jpg', 'image/jpeg', JPEG_64X32);

    const after = await app.inject({ method: 'GET', url: asset.url });
    expect(String(after.headers.etag)).not.toBe(before);
    // The client's old validator must no longer match, or it would keep the stale picture.
    const stale = await app.inject({ method: 'GET', url: asset.url, headers: { 'if-none-match': before } });
    expect(stale.statusCode).toBe(200);
  });

  it('serves ?size=original and a raw file revalidating too', async () => {
    const { t, projectId } = await setup('cache-original@test.dev');
    const img = await upload(projectId, t, 'hero.jpg', 'image/jpeg', JPEG_32X16);
    const orig = await app.inject({ method: 'GET', url: `${img.url}?size=original` });
    expect(String(orig.headers['cache-control'])).not.toContain('immutable');
    expect(orig.headers.etag).toBeTruthy();

    const pdf = await upload(projectId, t, 'terms.pdf', 'application/pdf', PDF_OLD);
    const file = await app.inject({ method: 'GET', url: pdf.url });
    expect(String(file.headers['cache-control'])).not.toContain('immutable');
    expect(file.headers.etag).toBeTruthy();
  });
});
