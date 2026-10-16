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
import { MediaStorage } from '../src/media/storage.js';
import { makePng } from './png.js';

// The media metadata writes — PATCH (alt / rename / move / font fields), bulk-alt and bulk-move — each
// READ an asset, change part of it and write the WHOLE asset back. Unguarded, a write that landed between
// that read and that write (another PATCH, a bulk call, a transform or a byte replace of the same asset)
// was silently reverted, and every call answered 200. They now carry the version they read (the content
// pattern from #1102): the loser re-reads and re-applies on top, so both writes survive.
//
// The BYTE writes — SVG overwrite, byte replace, in-place transform — had the same flaw from the other
// side: they read the asset, did slow file work, then wrote the WHOLE stale record back, reverting an alt
// or a rename made meanwhile. They now do the file work first and apply only the fields they own (bytes,
// dimensions, placeholder…) onto a FRESH read, guarded the same way — and a retry never redoes the files.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Open the lost-update window DETERMINISTICALLY: on the route's `at`-th read of an asset (0 = its first),
 * another writer changes the stored asset (via `mutate`) before the route gets to write. `'every'` keeps
 * doing it on every read — a writer the route can never get ahead of.
 */
function interleave(mutate: (asset: MediaAsset, n: number) => MediaAsset, at: number | 'every' = 0): void {
  const original = ContentRepository.prototype.getLiveMediaWithVersion;
  let n = 0;
  vi.spyOn(ContentRepository.prototype, 'getLiveMediaWithVersion').mockImplementation(async function (
    this: ContentRepository,
    ctx: ProjectContext,
    id: string,
  ) {
    const read = await original.call(this, ctx, id);
    if (at === 'every' || n === at) await this.put(ctx, 'media', id, mutate(read.asset, n));
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

/** A multipart body carrying one file. */
function filePart(name: string, mime: string, bytes: Buffer): { headers: Record<string, string>; payload: Buffer } {
  const boundary = 'SWRACEBOUNDARY';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function upload(name = 'photo.png', mime = 'image/png', bytes: Buffer = PNG_1X1): Promise<MediaAsset> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media`,
    cookies: { sw_session: t },
    ...filePart(name, mime, bytes),
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { item: MediaAsset }).item;
}

/** PUT /media/:id/content — replace the asset's bytes in place. */
const replaceBytes = (id: string, name: string, mime: string, bytes: Buffer) =>
  app.inject({ method: 'PUT', url: `/projects/${projectId}/media/${id}/content`, cookies: { sw_session: t }, ...filePart(name, mime, bytes) });

async function stored(id: string): Promise<MediaAsset> {
  const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } });
  const asset = (res.json() as { items: MediaAsset[] }).items.find((m) => m.id === id);
  if (!asset) throw new Error(`asset ${id} not listed`);
  return asset;
}

const inject = (method: 'PATCH' | 'POST' | 'PUT', url: string, payload: unknown) =>
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
    interleave((a, n) => ({ ...a, alt: `meanwhile ${n}` }), 'every');
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
    interleave((m, n) => ({ ...m, filename: `renamed-${n}.png` }), 'every');
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

describe('byte writes — a write landing during the file work is not reverted', () => {
  const svg = (w: number, h: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}"/></svg>`;
  const meanwhile = (a: MediaAsset): MediaAsset => ({ ...a, alt: 'Written meanwhile' });

  it('the SVG overwrite (Studio save) keeps a concurrent alt — and applies its own size', async () => {
    const asset = await upload('logo.svg', 'image/svg+xml', Buffer.from(svg(10, 10)));
    interleave(meanwhile); // lands on the route's first read: during the sanitize + store
    const res = await inject('PUT', `/media/${asset.id}/svg`, { svg: svg(64, 32) });
    expect(res.statusCode, res.body).toBe(200);
    const after = await stored(asset.id);
    expect(after.alt).toBe('Written meanwhile');
    expect(after).toMatchObject({ width: 64, height: 32 });
  });

  it.each([
    ['a raster image', 'photo.png', 'image/png', makePng(40, 20, [10, 120, 90]), makePng(30, 60, [200, 30, 30]), { width: 30, height: 60 }],
    ['an SVG', 'logo.svg', 'image/svg+xml', Buffer.from(svg(10, 10)), Buffer.from(svg(80, 40)), { width: 80, height: 40 }],
    ['a verbatim file', 'prices.pdf', 'application/pdf', Buffer.from('%PDF-1.4 one'), Buffer.from('%PDF-1.4 a longer second version'), {}],
  ])('a byte replace of %s keeps a concurrent alt — and applies its own bytes and size', async (_label, name, mime, before, after, dims) => {
    const asset = await upload(name, mime, before);
    interleave(meanwhile); // lands during the encode / sanitize / move
    const res = await replaceBytes(asset.id, name, mime, after);
    expect(res.statusCode, res.body).toBe(200);
    const now = await stored(asset.id);
    expect(now.alt).toBe('Written meanwhile');
    expect(now).toMatchObject(dims);
    if (mime === 'application/pdf') expect(now.bytes).toBe(after.length);
    expect((res.json() as { item: MediaAsset }).item.alt).toBe('Written meanwhile'); // the echo is the stored record
  });

  it('an in-place transform keeps a concurrent rename — and applies its own pixels', async () => {
    const asset = await upload('photo.png', 'image/png', makePng(40, 20, [10, 120, 90]));
    interleave((a) => ({ ...a, filename: 'Harbour.png' })); // lands during the rotate
    const res = await inject('POST', `/media/${asset.id}/transform`, { rotate: 90 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(asset.id)).toMatchObject({ filename: 'Harbour.png', width: 20, height: 40 });
  });

  it('a write landing between the RECORD read and its write is re-applied — the file work is not redone', async () => {
    const asset = await upload('photo.png', 'image/png', makePng(40, 20, [10, 120, 90]));
    const moves = vi.spyOn(MediaStorage.prototype, 'storeFileFromPath');
    interleave(meanwhile, 1); // the second read is the guarded record read, AFTER the bytes were stored
    const res = await replaceBytes(asset.id, 'photo.png', 'image/png', makePng(30, 60, [200, 30, 30]));
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(asset.id)).toMatchObject({ alt: 'Written meanwhile', width: 30, height: 60 });
    // One move of the new bytes into place, however many times the record write had to be re-applied.
    expect(moves.mock.calls.filter(([, id]) => id === asset.id)).toHaveLength(1);
  });
});

// Renaming or moving a FOLDER re-files every asset under it. It read the whole library once and wrote
// each asset back from that list — so an alt, a rename or a move of one of those assets made in between
// was reverted, a move OUT of the folder included (the asset was dragged back under the new name).
describe('folder rename / move — each asset re-filed through the guard', () => {
  /** On the route's LIST of the library (the read a re-file starts from), run `write` before it returns. */
  function afterMediaList(write: (repo: ContentRepository, ctx: ProjectContext, listed: MediaAsset[]) => Promise<void>): void {
    const original = ContentRepository.prototype.list;
    let fired = false;
    vi.spyOn(ContentRepository.prototype, 'list').mockImplementation(async function (this: ContentRepository, ...args) {
      const rows = await original.apply(this, args);
      if (!fired && args[1] === 'media') {
        fired = true;
        await write(this, args[0], rows as MediaAsset[]);
      }
      return rows; // the STALE list the route re-files from
    });
  }
  const renameFolder = (from: string, to: string) => inject('POST', '/media/folders/rename', { from, to });

  async function uploadInto(folder: string, name: string): Promise<MediaAsset> {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media?folder=${encodeURIComponent(folder)}`,
      cookies: { sw_session: t },
      ...filePart(name, 'image/png', PNG_1X1),
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { item: MediaAsset }).item;
  }

  it('an alt and a rename made meanwhile survive the re-file', async () => {
    const a = await uploadInto('trips', 'a.png');
    const b = await uploadInto('trips/2024', 'b.png');
    afterMediaList(async (repo, ctx, listed) => {
      const byId = new Map(listed.map((m) => [m.id, m]));
      await repo.put(ctx, 'media', a.id, { ...byId.get(a.id)!, alt: 'Written meanwhile' });
      await repo.put(ctx, 'media', b.id, { ...byId.get(b.id)!, filename: 'Renamed meanwhile.png' });
    });
    const res = await renameFolder('trips', 'travel');
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(a.id)).toMatchObject({ folder: 'travel', alt: 'Written meanwhile' });
    expect(await stored(b.id)).toMatchObject({ folder: 'travel/2024', filename: 'Renamed meanwhile.png' });
    // …and the per-asset report, like bulk-move's.
    const body = res.json() as { ok: boolean; moved?: string[]; failed?: unknown[] };
    expect(body.ok).toBe(true);
    expect([...(body.moved ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect(body.failed).toEqual([]);
  });

  it('an asset moved OUT of the folder meanwhile stays where it was put — and is not reported as moved', async () => {
    const a = await uploadInto('trips', 'a.png');
    const b = await uploadInto('trips', 'b.png');
    afterMediaList(async (repo, ctx, listed) => {
      await repo.put(ctx, 'media', b.id, { ...listed.find((m) => m.id === b.id)!, folder: 'elsewhere' });
    });
    const res = await renameFolder('trips', 'travel');
    expect(res.statusCode, res.body).toBe(200);
    expect((await stored(a.id)).folder).toBe('travel');
    expect((await stored(b.id)).folder).toBe('elsewhere');
    expect(res.json()).toMatchObject({ moved: [a.id], failed: [] });
  });

  it('a write landing between the guarded read and its write is re-applied on top', async () => {
    const a = await uploadInto('trips', 'a.png');
    interleave((m) => ({ ...m, alt: 'Written meanwhile' })); // on the re-file's own versioned read
    const res = await renameFolder('trips', 'travel');
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(a.id)).toMatchObject({ folder: 'travel', alt: 'Written meanwhile' });
  });

  it('an asset it can never get ahead of is reported in `failed`, and the rest are still re-filed', async () => {
    const a = await uploadInto('trips', 'a.png');
    const b = await uploadInto('trips', 'b.png');
    interleave((m, n) => (m.id === a.id ? { ...m, alt: `meanwhile ${n}` } : m), 'every');
    const res = await renameFolder('trips', 'travel');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: boolean; moved: string[]; failed: Array<{ id: string; error: string }> };
    expect(body.ok).toBe(false); // a PARTIAL re-file must not read as success to a caller that checks `ok`
    expect(body.moved).toEqual([b.id]);
    expect(body.failed).toEqual([{ id: a.id, error: expect.stringMatching(/retry the same call/) }]);
    expect((await stored(a.id)).folder).toBe('trips'); // left in place, never written from a stale read
    expect((await stored(b.id)).folder).toBe('travel');
  });
});
