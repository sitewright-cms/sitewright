import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { reapDeletedMedia } from '../src/repo/maintenance.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let db: Database;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-recycle-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function cookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
function multipart(content: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}
async function setup(): Promise<{ c: string; base: string; slug: string }> {
  const email = `rc-${Math.random().toString(36).slice(2)}@e2e.test`;
  const slug = `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const c = cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: c }, payload: { name: 'S', slug } });
  return { c, base: `/projects/${(proj.json() as { project: { id: string } }).project.id}`, slug };
}
async function upload(base: string, c: string): Promise<string> {
  const up = await app.inject({ method: 'POST', url: `${base}/media`, cookies: { sw_session: c }, ...multipart(PNG_1X1) });
  return (up.json() as { item: { id: string } }).item.id;
}
// A new asset stores FLAT as `<mediaRoot>/<slug>/<id>-<name>` (no per-asset folder), so a binary is
// present iff some file in the project dir starts with `<id>-`.
function hasBinary(mediaRoot: string, slug: string, id: string): boolean {
  try {
    return readdirSync(join(mediaRoot, slug)).some((f) => f.startsWith(`${id}-`));
  } catch {
    return false;
  }
}

describe('media recycle bin', () => {
  it('soft-delete hides from the list + shows in the bin; restore brings it back', async () => {
    const { c, base } = await setup();
    const cookies = { sw_session: c };
    const id = await upload(base, c);

    await app.inject({ method: 'DELETE', url: `${base}/media/${id}`, cookies });
    // hidden from the live list, present in the Recycle Bin with a deletedAt timestamp.
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
    const binned = ((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: Array<{ id: string; deletedAt: number }> };
    expect(binned.items).toHaveLength(1);
    expect(binned.items[0]!.id).toBe(id);
    expect(typeof binned.items[0]!.deletedAt).toBe('number');

    // restore → back in the live list, gone from the bin.
    expect((await app.inject({ method: 'POST', url: `${base}/media/${id}/restore`, cookies })).statusCode).toBe(204);
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(1);
    expect((((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('purge permanently removes the row + the binary', async () => {
    const { c, base, slug } = await setup();
    const cookies = { sw_session: c };
    const id = await upload(base, c);
    expect(hasBinary(mediaRoot, slug, id)).toBe(true);

    await app.inject({ method: 'DELETE', url: `${base}/media/${id}`, cookies }); // soft-delete first
    expect((await app.inject({ method: 'DELETE', url: `${base}/media/${id}/purge`, cookies })).statusCode).toBe(204);
    // gone from the bin AND the disk binary removed.
    expect((((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
    expect(hasBinary(mediaRoot, slug, id)).toBe(false);
  });

  it('empty the recycle bin purges every binned asset (rows + binaries) but leaves live assets', async () => {
    const { c, base, slug } = await setup();
    const cookies = { sw_session: c };
    const a = await upload(base, c);
    const b = await upload(base, c);
    const live = await upload(base, c); // never binned — must survive
    await app.inject({ method: 'DELETE', url: `${base}/media/${a}`, cookies });
    await app.inject({ method: 'DELETE', url: `${base}/media/${b}`, cookies });

    const res = await app.inject({ method: 'DELETE', url: `${base}/media/deleted`, cookies });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { purged: number }).purged).toBe(2);
    // bin empty, both binaries gone.
    expect((((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
    expect(hasBinary(mediaRoot, slug, a)).toBe(false);
    expect(hasBinary(mediaRoot, slug, b)).toBe(false);
    // the LIVE asset + its binary are untouched (empty-bin is bin-only).
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: Array<{ id: string }> }).items.some((x) => x.id === live)).toBe(true);
    expect(hasBinary(mediaRoot, slug, live)).toBe(true);
  });

  it('purge refuses a LIVE (never-binned) asset — the bin + recovery window cannot be skipped', async () => {
    const { c, base, slug } = await setup();
    const cookies = { sw_session: c };
    const id = await upload(base, c);

    // Purging without first soft-deleting must 404 and leave the row + binary intact.
    expect((await app.inject({ method: 'DELETE', url: `${base}/media/${id}/purge`, cookies })).statusCode).toBe(404);
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: Array<{ id: string }> }).items.some((a) => a.id === id)).toBe(true);
    expect(hasBinary(mediaRoot, slug, id)).toBe(true);
  });

  it('a binned asset cannot be renamed or copied (only restored)', async () => {
    const { c, base } = await setup();
    const cookies = { sw_session: c };
    const id = await upload(base, c);
    await app.inject({ method: 'DELETE', url: `${base}/media/${id}`, cookies }); // soft-delete

    // rename (PATCH) and copy both reach only LIVE media → 404 while binned.
    expect((await app.inject({ method: 'PATCH', url: `${base}/media/${id}`, cookies, payload: { filename: 'renamed.png' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${base}/media/${id}/copy`, cookies, payload: {} })).statusCode).toBe(404);
    // still exactly one binned item, no live copy resurrected.
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
    expect((((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(1);
  });

  it('folder delete soft-deletes the contained assets (recoverable), never permanent', async () => {
    const { c, base, slug } = await setup();
    const cookies = { sw_session: c };
    const id = await upload(base, c);
    await app.inject({ method: 'PATCH', url: `${base}/media/${id}`, cookies, payload: { folder: 'photos' } }); // file it under a folder

    // delete the whole folder → the asset goes to the bin (binary retained), the folder leaves the tree.
    expect((await app.inject({ method: 'DELETE', url: `${base}/media/folders`, cookies, payload: { path: 'photos' } })).statusCode).toBe(204);
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
    const binned = ((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: Array<{ id: string }> };
    expect(binned.items.some((a) => a.id === id)).toBe(true);
    expect(hasBinary(mediaRoot, slug, id)).toBe(true); // binary retained → recoverable

    // restore → back in the live library, re-materialized under its original folder path.
    expect((await app.inject({ method: 'POST', url: `${base}/media/${id}/restore`, cookies })).statusCode).toBe(204);
    const live = ((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: Array<{ id: string; folder: string }> };
    expect(live.items.find((a) => a.id === id)?.folder).toBe('photos');
  });

  it('the reaper purges binned media older than the retention window (row + binary)', async () => {
    const { c, base, slug } = await setup();
    const cookies = { sw_session: c };
    const id = await upload(base, c);
    await app.inject({ method: 'DELETE', url: `${base}/media/${id}`, cookies }); // soft-delete (deletedAt ≈ now)

    const removed: string[] = [];
    // retentionDays = -1 → cutoff is in the future, so the just-binned asset is past retention.
    await reapDeletedMedia(db, { remove: async (_slug, assetId) => void removed.push(assetId) }, new Date(), -1);

    expect(removed).toContain(id);
    expect((((await app.inject({ method: 'GET', url: `${base}/media/deleted`, cookies })).json()) as { items: unknown[] }).items).toHaveLength(0);
    // A live asset (not binned) is left untouched by the reaper.
    const id2 = await upload(base, c);
    await reapDeletedMedia(db, { remove: async () => {} }, new Date(), -1);
    expect((((await app.inject({ method: 'GET', url: `${base}/media`, cookies })).json()) as { items: Array<{ id: string }> }).items.some((a) => a.id === id2)).toBe(true);
    expect(hasBinary(mediaRoot, slug, id2)).toBe(true);
  });
});
