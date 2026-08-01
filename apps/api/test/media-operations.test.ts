import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// Integration: persistent media folders + file/folder operations. Folders are first-class
// records (survive reload, empty or not); rename/move/copy/delete cascade to the assets
// filed under them.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-media-ops-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

let slugCounter = 0;
async function setup(email: string) {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: `site-${slugCounter++}` } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}

function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWOPSBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail]),
  };
}

async function uploadImage(t: string, projectId: string, folder = ''): Promise<MediaAsset> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`,
    cookies: { sw_session: t },
    ...multipart('photo.png', 'image/png', PNG_1X1),
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { item: MediaAsset }).item;
}

const listFolders = async (t: string, projectId: string): Promise<MediaFolderRecord[]> =>
  ((await app.inject({ method: 'GET', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t } })).json() as { items: MediaFolderRecord[] }).items;

const listMedia = async (t: string, projectId: string): Promise<MediaAsset[]> =>
  ((await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } })).json() as { items: MediaAsset[] }).items;

describe('bulk media move', () => {
  it('re-files many assets in ONE call and accounts for every id', async () => {
    // Reorganising an imported library one asset at a time is a round-trip each: a real clone made 96
    // move_media calls for one site and hit a rate limit partway, leaving the library half-filed.
    const { t, projectId } = await setup('bulkmove@e2e.test');
    const a = await uploadImage(t, projectId, 'imported');
    const b = await uploadImage(t, projectId, 'imported');
    const c = await uploadImage(t, projectId, 'imported');

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/bulk-move`,
      cookies: { sw_session: t },
      payload: { ids: [a.id, b.id, c.id], folder: 'Gallery' },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { moved: string[]; failed: unknown[]; requested: number; folder: string };
    expect(out.moved).toHaveLength(3);
    expect(out.failed).toHaveLength(0);
    expect(out.requested).toBe(3);

    const all = await listMedia(t, projectId);
    expect(all.every((m) => m.folder === 'Gallery')).toBe(true);
  });

  it('a bad id fails on its own — the rest still move', async () => {
    // The failure mode being replaced is a half-filed library, so one unknown id must not abandon the batch.
    const { t, projectId } = await setup('bulkmove2@e2e.test');
    const good = await uploadImage(t, projectId, 'imported');

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/bulk-move`,
      cookies: { sw_session: t },
      payload: { ids: [good.id, 'no-such-asset'], folder: 'Brand' },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { moved: string[]; failed: Array<{ id: string }>; requested: number };
    expect(out.moved).toEqual([good.id]);
    expect(out.failed.map((f) => f.id)).toEqual(['no-such-asset']);
    expect(out.moved.length + out.failed.length).toBe(out.requested);
    expect((await listMedia(t, projectId)).find((m) => m.id === good.id)?.folder).toBe('Brand');
  });

  it('duplicate ids are de-duplicated, and the batch is bounded', async () => {
    const { t, projectId } = await setup('bulkmove3@e2e.test');
    const one = await uploadImage(t, projectId);
    const dup = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/bulk-move`,
      cookies: { sw_session: t },
      payload: { ids: [one.id, one.id, one.id], folder: 'X' },
    });
    expect((dup.json() as { requested: number }).requested).toBe(1);

    const tooMany = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/bulk-move`,
      cookies: { sw_session: t },
      payload: { ids: Array.from({ length: 201 }, (_, i) => `id${i}`), folder: 'X' },
    });
    expect(tooMany.statusCode).toBe(400);
  });
});

describe('media folders — persistence', () => {
  it('an EMPTY folder persists (the original bug: it used to vanish)', async () => {
    const { t, projectId } = await setup('f1@e2e.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/folders`,
      cookies: { sw_session: t },
      payload: { path: 'Brochures' },
    });
    expect(res.statusCode).toBe(201);
    const folders = await listFolders(t, projectId);
    expect(folders.map((f) => f.path)).toContain('Brochures'); // survives a re-list (== a reload)
  });

  it('creating a nested folder also persists its ancestors', async () => {
    const { t, projectId } = await setup('f2@e2e.test');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: 'A/B/C' } });
    expect((await listFolders(t, projectId)).map((f) => f.path).sort()).toEqual(['A', 'A/B', 'A/B/C']);
  });

  it('rejects an empty path and the root', async () => {
    const { t, projectId } = await setup('f3@e2e.test');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: '' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('media folders — rename / move', () => {
  it('renaming a folder re-roots its (empty) subtree records AND its assets', async () => {
    const { t, projectId } = await setup('r1@e2e.test');
    await uploadImage(t, projectId, 'Old/Sub'); // asset-derived folder (no explicit record)
    await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: 'Old/Empty' } });

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/folders/rename`,
      cookies: { sw_session: t },
      payload: { from: 'Old', to: 'New' },
    });
    expect(res.statusCode).toBe(200);

    // The explicit records (Old + Old/Empty) re-root; no duplicate 'New' is created.
    expect((await listFolders(t, projectId)).map((f) => f.path).sort()).toEqual(['New', 'New/Empty']);
    // The asset (in the implicit 'Old/Sub') follows the rename too.
    expect((await listMedia(t, projectId))[0]!.folder).toBe('New/Sub');
  });

  it('refuses to rename onto an existing folder (no duplicate records)', async () => {
    const { t, projectId } = await setup('r3@e2e.test');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: 'A' } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: 'B' } });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/folders/rename`,
      cookies: { sw_session: t },
      payload: { from: 'B', to: 'A' },
    });
    expect(res.statusCode).toBe(409);
    // Both originals are intact; no duplicate 'A' was created.
    expect((await listFolders(t, projectId)).map((f) => f.path).sort()).toEqual(['A', 'B']);
  });

  it('rejects moving a folder into itself', async () => {
    const { t, projectId } = await setup('r2@e2e.test');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: 'A' } });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/folders/rename`,
      cookies: { sw_session: t },
      payload: { from: 'A', to: 'A/B' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('media folders — copy', () => {
  it('copies the folder subtree and DUPLICATES its assets (distinct ids + binaries)', async () => {
    const { t, projectId } = await setup('c1@e2e.test');
    const original = await uploadImage(t, projectId, 'Src');

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/folders/copy`,
      cookies: { sw_session: t },
      payload: { from: 'Src', to: 'Dst' },
    });
    expect(res.statusCode).toBe(200);

    const media = await listMedia(t, projectId);
    expect(media).toHaveLength(2); // original + copy
    const copy = media.find((a) => a.id !== original.id)!;
    expect(copy.folder).toBe('Dst');
    expect(copy.id).not.toBe(original.id);
    // The copy's url points at its OWN asset dir, and the binary is actually served.
    expect(copy.url).toContain(copy.id);
    const served = await app.inject({ method: 'GET', url: copy.url });
    expect(served.statusCode).toBe(200);
  });
});

describe('media folders — recursive delete', () => {
  it('deletes the folder + subfolders and soft-deletes every asset to the Recycle Bin (binary retained)', async () => {
    const { t, projectId } = await setup('d1@e2e.test');
    const asset = await uploadImage(t, projectId, 'Trash/Sub');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/media/folders`, cookies: { sw_session: t }, payload: { path: 'Trash/Empty' } });
    await uploadImage(t, projectId, 'Keep'); // a sibling that must survive

    const res = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/media/folders`,
      cookies: { sw_session: t },
      payload: { path: 'Trash' },
    });
    expect(res.statusCode).toBe(204);

    // Every record under 'Trash' is gone ('Keep' was asset-derived, never an explicit record).
    expect((await listFolders(t, projectId)).map((f) => f.path)).toEqual([]);
    const media = await listMedia(t, projectId);
    expect(media).toHaveLength(1); // the sibling 'Keep' asset survived
    expect(media[0]!.folder).toBe('Keep');
    // The folder's assets are SOFT-deleted → the Recycle Bin (recoverable): they leave the live
    // library but the binary is RETAINED (still 200), so a restore can bring them back.
    const binned = ((await app.inject({ method: 'GET', url: `/projects/${projectId}/media/deleted`, cookies: { sw_session: t } })).json()) as { items: Array<{ id: string }> };
    expect(binned.items.some((a) => a.id === asset.id)).toBe(true);
    expect((await app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(200);
  });
});

describe('media assets — move / rename / copy', () => {
  it('PATCH moves an asset to another folder and renames its display name', async () => {
    const { t, projectId } = await setup('a1@e2e.test');
    const asset = await uploadImage(t, projectId, 'Inbox');
    const res = await app.inject({
      method: 'PATCH',
      url: `/projects/${projectId}/media/${asset.id}`,
      cookies: { sw_session: t },
      payload: { folder: 'Archive', filename: 'renamed.png' },
    });
    expect(res.statusCode).toBe(200);
    const updated = (res.json() as { item: MediaAsset }).item;
    expect(updated.folder).toBe('Archive');
    expect(updated.filename).toBe('renamed.png');
    expect(updated.id).toBe(asset.id); // identity + binaries unchanged
  });

  it('POST /copy duplicates an asset into the target folder', async () => {
    const { t, projectId } = await setup('a2@e2e.test');
    const asset = await uploadImage(t, projectId, '');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/${asset.id}/copy`,
      cookies: { sw_session: t },
      payload: { folder: 'Copies' },
    });
    expect(res.statusCode).toBe(201);
    const copy = (res.json() as { item: MediaAsset }).item;
    expect(copy.id).not.toBe(asset.id);
    expect(copy.folder).toBe('Copies');
    expect((await app.inject({ method: 'GET', url: copy.url })).statusCode).toBe(200);
  });
});

describe('media operations — tenant isolation', () => {
  it("a non-member cannot operate on another project's folders", async () => {
    const { projectId } = await setup('owner@e2e.test');
    const { t: outsider } = await setup('outsider@e2e.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/folders`,
      cookies: { sw_session: outsider },
      payload: { path: 'Intrusion' },
    });
    expect(res.statusCode).toBe(403);
  });
});
