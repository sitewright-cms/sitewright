import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

// Integration: persistent media folders + file/folder operations. Folders are first-class
// records (survive reload, empty or not); rename/move/copy/delete cascade to the assets
// filed under them.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-media-ops-'));
  app = await createApp({ db: await makeTestDb(), mediaRoot });
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
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'pw-secret-1' } });
  const t = token(reg);
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
  it('deletes the folder, its subfolders, and every asset (binary 404s after)', async () => {
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
    // The deleted asset's binary is gone.
    expect((await app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(404);
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
