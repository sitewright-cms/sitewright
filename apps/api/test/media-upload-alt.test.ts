import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MediaAsset } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// `?alt=` on the multipart upload (POST /projects/:id/media — the route the editor and a bearer client
// use). Upload tickets, the media PATCH and bulk-alt all set alt since #1108; this route ignored it, so a
// file uploaded here was always born undescribed and needed a second call. It is honoured on BOTH of the
// route's storage paths: the in-memory one (raster images, SVG) and the streamed one (video, files).

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

let app: FastifyInstance;
let mediaRoot: string;
let t: string;
let projectId: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-upload-alt-'));
  const db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
  await registerAccount(db, 'alt@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'alt@acme.test', password: 'Pw-secret-1' } });
  t = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'alt' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
});
afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function upload(name: string, mime: string, bytes: Buffer, query = '') {
  const boundary = 'SWALTBOUNDARY';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media${query}`,
    cookies: { sw_session: t },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

const listed = async (): Promise<MediaAsset[]> =>
  ((await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } })).json() as { items: MediaAsset[] }).items;

describe('POST /projects/:id/media?alt=', () => {
  it.each([
    ['a raster image (in-memory path)', 'harbour.png', 'image/png', PNG_1X1, 'image'],
    ['an SVG (in-memory path)', 'logo.svg', 'image/svg+xml', SVG, 'image'],
    ['a document (streamed path)', 'prices.pdf', 'application/pdf', Buffer.from('%PDF-1.4 not really'), 'file'],
    ['a video (streamed path)', 'loop.mp4', 'video/mp4', Buffer.from('not really a video'), 'video'],
  ])('stores the alt on %s', async (_label, name, mime, bytes, kind) => {
    const alt = 'Fishing boats in the harbour at dusk — 2024';
    const res = await upload(name, mime, bytes, `?alt=${encodeURIComponent(alt)}`);
    expect(res.statusCode, res.body).toBe(201);
    const item = (res.json() as { item: MediaAsset }).item;
    expect(item.kind).toBe(kind);
    expect(item.alt).toBe(alt);
    expect((await listed()).find((m) => m.id === item.id)?.alt).toBe(alt); // stored, not just echoed
  });

  it('files and describes in one call (with ?folder=)', async () => {
    const res = await upload('harbour.png', 'image/png', PNG_1X1, '?folder=gallery&alt=Harbour');
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { item: MediaAsset }).item).toMatchObject({ folder: 'gallery', alt: 'Harbour' });
  });

  it('an EMPTY alt leaves the asset undescribed (decorative is a property of a use, not of the file)', async () => {
    const res = await upload('harbour.png', 'image/png', PNG_1X1, '?alt=');
    expect(res.statusCode, res.body).toBe(201);
    expect('alt' in (res.json() as { item: MediaAsset }).item).toBe(false);
  });

  it('no ?alt= at all: unchanged — the asset is born undescribed', async () => {
    const res = await upload('harbour.png', 'image/png', PNG_1X1);
    expect(res.statusCode, res.body).toBe(201);
    expect('alt' in (res.json() as { item: MediaAsset }).item).toBe(false);
  });

  it('refuses an alt over the stored bound BEFORE reading the upload — nothing is stored', async () => {
    const res = await upload('harbour.png', 'image/png', PNG_1X1, `?alt=${'x'.repeat(501)}`);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/alt/);
    expect(await listed()).toEqual([]);
  });

  it('a repeated ?alt= (an array) is refused, not stringified', async () => {
    const res = await upload('harbour.png', 'image/png', PNG_1X1, '?alt=a&alt=b');
    expect(res.statusCode).toBe(400);
    expect(await listed()).toEqual([]);
  });
});
