import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MediaAsset } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { ContentRepository } from '../src/repo/content.js';
import type { ProjectContext } from '../src/repo/context.js';

// The media metadata writes — PATCH (alt / rename / move / font fields), bulk-alt and bulk-move — each
// READ an asset, change part of it and write the WHOLE asset back. Unguarded, a write that landed between
// that read and that write (another PATCH, a bulk call, a transform or a byte replace of the same asset)
// was silently reverted, and every call answered 200. They now carry the version they read (the content
// pattern from #1102): the loser re-reads and re-applies on top, so both writes survive.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Open the lost-update window DETERMINISTICALLY: the first time a route reads an asset, another writer
 * changes the stored asset (via `mutate`) before the route gets to write. `every` keeps doing it on every
 * read — a writer the route can never get ahead of.
 */
function interleave(mutate: (asset: MediaAsset, n: number) => MediaAsset, every = false): void {
  const original = ContentRepository.prototype.getLiveMediaWithVersion;
  let n = 0;
  vi.spyOn(ContentRepository.prototype, 'getLiveMediaWithVersion').mockImplementation(async function (
    this: ContentRepository,
    ctx: ProjectContext,
    id: string,
  ) {
    const read = await original.call(this, ctx, id);
    if (every || n === 0) await this.put(ctx, 'media', id, mutate(read.asset, n));
    n += 1;
    return read; // the STALE copy — exactly what the route would have built its write from
  });
}

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;
let t: string;
let projectId: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-media-race-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
  await registerAccount(db, 'race@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'race@acme.test', password: 'Pw-secret-1' } });
  t = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'race' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function upload(name = 'photo.png'): Promise<MediaAsset> {
  const boundary = 'SWRACEBOUNDARY';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
    PNG_1X1,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media`,
    cookies: { sw_session: t },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { item: MediaAsset }).item;
}

async function stored(id: string): Promise<MediaAsset> {
  const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } });
  const asset = (res.json() as { items: MediaAsset[] }).items.find((m) => m.id === id);
  if (!asset) throw new Error(`asset ${id} not listed`);
  return asset;
}

const inject = (method: 'PATCH' | 'POST', url: string, payload: unknown) =>
  app.inject({ method, url: `/projects/${projectId}${url}`, cookies: { sw_session: t }, payload: payload as Record<string, unknown> });

describe('media PATCH — a write that lands between its read and its write is not reverted', () => {
  it('an alt PATCH keeps a concurrent move (and the move keeps the alt)', async () => {
    const asset = await upload();
    interleave((a) => ({ ...a, folder: 'moved-meanwhile' }));
    const res = await inject('PATCH', `/media/${asset.id}`, { alt: 'A harbour at dusk' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await stored(asset.id);
    expect(after.folder).toBe('moved-meanwhile'); // the concurrent writer's change survived…
    expect(after.alt).toBe('A harbour at dusk'); // …and so did this one, re-applied on top
    // The echo is the asset as finally stored — the merged result, not this call's stale base.
    expect((res.json() as { item: MediaAsset }).item).toMatchObject({ folder: 'moved-meanwhile', alt: 'A harbour at dusk' });
  });

  it('a rename keeps a concurrent alt', async () => {
    const asset = await upload();
    interleave((a) => ({ ...a, alt: 'Written meanwhile' }));
    const res = await inject('PATCH', `/media/${asset.id}`, { filename: 'harbour.png' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await stored(asset.id);
    expect(after.filename).toBe('harbour.png');
    expect(after.alt).toBe('Written meanwhile');
  });

  it('a writer it can never get ahead of: 409 that says retry the same call — and nothing is reverted', async () => {
    const asset = await upload();
    interleave((a, n) => ({ ...a, alt: `meanwhile ${n}` }), true);
    const res = await inject('PATCH', `/media/${asset.id}`, { folder: 'mine' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/retry the same call/);
    const after = await stored(asset.id);
    expect(after.folder).not.toBe('mine'); // this write never landed on a stale base
    expect(after.alt).toMatch(/^meanwhile \d+$/); // the other writer's last change stands
  });

  it('a validation refusal inside the guarded read still answers 400 (a font field on an image)', async () => {
    const asset = await upload();
    const res = await inject('PATCH', `/media/${asset.id}`, { family: 'Inter' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/describe a FONT/);
  });
});

describe('media bulk-alt / bulk-move — the same guard per asset', () => {
  it('bulk-alt keeps a concurrent move of the asset it is describing', async () => {
    const a = await upload('a.png');
    const b = await upload('b.png');
    interleave((m) => ({ ...m, folder: 'moved-meanwhile' })); // lands on the FIRST asset read
    const res = await inject('POST', '/media/bulk-alt', { items: [{ id: a.id, alt: 'Alpha' }, { id: b.id, alt: 'Beta' }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ updated: [a.id, b.id], failed: [], requested: 2 });
    const first = await stored(a.id);
    expect(first.folder).toBe('moved-meanwhile');
    expect(first.alt).toBe('Alpha');
    expect((await stored(b.id)).alt).toBe('Beta');
  });

  it('bulk-alt reports an asset it could not get ahead of as failed, and carries on with the rest', async () => {
    const a = await upload('a.png');
    interleave((m, n) => ({ ...m, filename: `renamed-${n}.png` }), true);
    const res = await inject('POST', '/media/bulk-alt', { items: [{ id: a.id, alt: 'Alpha' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: [], failed: [{ id: a.id, error: 'could not update' }], requested: 1 });
    expect((await stored(a.id)).filename).toMatch(/^renamed-\d+\.png$/);
  });

  it('bulk-move keeps a concurrent alt of the asset it is moving', async () => {
    const a = await upload('a.png');
    interleave((m) => ({ ...m, alt: 'Written meanwhile' }));
    const res = await inject('POST', '/media/bulk-move', { ids: [a.id], folder: 'gallery' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await stored(a.id);
    expect(after.folder).toBe('gallery');
    expect(after.alt).toBe('Written meanwhile');
  });
});
