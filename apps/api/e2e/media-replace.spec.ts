import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { seedUser } from './helpers.js';

type PwFixture = PlaywrightWorkerArgs['playwright'];

/**
 * `PUT /projects/:id/media/:id/content` — replacing an asset's bytes, over HTTP against a real
 * deployment.
 *
 * What only a deployed container can show, and what these specs are therefore for: that the id and
 * the URL genuinely survive a replace, that the DELIVERY route then serves the NEW bytes to a client
 * holding the old ones (the cache header and the thumbnail cache are both real here, and both were
 * the reason an in-place edit used to be invisible), and that the outgoing file is recoverable.
 *
 * The unit suite (apps/api/test/media-replace.test.ts) covers the branch matrix — every asset kind,
 * the sanitizer, the guards — where the storage layer is injectable.
 */

/** 32×16 solid green JPEG. */
const JPEG_32X16 = Buffer.from(
  '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmARTPAAH/9k=',
  'base64',
);
/** 64×32 JPEG — same FORMAT, different PICTURE, so a replace genuinely changes the bytes. */
const JPEG_64X32 = Buffer.from(
  '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAAAQAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAEAAAAADoAQAAQAAACAAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAIABAAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABcBAQEBAQAAAAAAAAAAAAAAAAAJBwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCJAMqd+gAJCAqkm0AArwCVqkoACQgKpJtAAP/Z',
  'base64',
);
/** 20×20 blue PNG — a different format, for the extension guard. */
const PNG_20X20 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJUlEQVQ4jWNgYPj/n7qYYdRAhtEwZBhNNgyjOYVhtHBgGHHlIQDZvh0OP+rLwQAAAABJRU5ErkJggg==',
  'base64',
);

async function newProject(playwright: PwFixture, baseURL: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ctx = await seedUser(playwright, baseURL, `replace-${stamp}@e2e.test`);
  const proj = await ctx.post(`/projects`, { data: { name: 'Replace', slug: `r${stamp}` } });
  expect(proj.status(), 'creating the project').toBe(201);
  return { ctx, base: `/projects/${(await proj.json()).project.id}` };
}

async function upload(ctx: Awaited<ReturnType<typeof seedUser>>, base: string, name: string, type: string, buf: Buffer) {
  const res = await ctx.post(`${base}/media`, { multipart: { file: { name, mimeType: type, buffer: buf } } });
  expect(res.status(), `uploading ${name}: ${await res.text()}`).toBe(201);
  return (await res.json()).item as { id: string; url: string; bytes: number; width: number; height: number };
}

test('a replaced image keeps its URL and serves the NEW bytes to a client holding the old ones', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  const asset = await upload(ctx, base, 'hero.jpg', 'image/jpeg', JPEG_32X16);
  expect(asset.width).toBe(32);

  // Fetch it the way a page would, and keep the validator — this is the client we must not strand.
  const first = await ctx.get(asset.url);
  expect(first.status()).toBe(200);
  const etag = first.headers().etag;
  expect(etag, 'a mutable asset URL must carry a validator').toBeTruthy();
  expect(first.headers()['cache-control'] ?? '').not.toContain('immutable');
  // While nothing has changed, that validator saves the transfer.
  expect((await ctx.get(asset.url, { headers: { 'if-none-match': etag } })).status()).toBe(304);

  const put = await ctx.put(`${base}/media/${asset.id}/content`, {
    multipart: { file: { name: 'hero.jpg', mimeType: 'image/jpeg', buffer: PNG_20X20 } },
  });
  // A PNG cannot become a .jpg — the extension is part of the URL.
  expect(put.status(), await put.text()).toBe(400);
  expect(await put.text()).toMatch(/extension/i);

  // Now a legitimate replacement: the same format, a genuinely DIFFERENT picture (64×32, not 32×16).
  const ok = await ctx.put(`${base}/media/${asset.id}/content`, {
    multipart: { file: { name: 'hero.jpg', mimeType: 'image/jpeg', buffer: JPEG_64X32 } },
  });
  expect(ok.status(), await ok.text()).toBe(200);
  const receipt = await ok.json();
  expect(receipt.item.id).toBe(asset.id);
  expect(receipt.item.url).toBe(asset.url);
  expect(receipt.item.width, 'the new picture is a different size').toBe(64);
  expect(receipt.previous.width, 'the receipt reports what it was').toBe(32);
  expect(receipt.snapshotId, 'the outgoing bytes must be recoverable').toBeTruthy();

  // ★ The client that cached the old picture must NOT be told it is still fresh. This is the whole
  // reason the delivery route stopped promising `immutable`: the thumbnail behind this URL is
  // regenerated from the new original, so the old validator has to miss.
  const after = await ctx.get(asset.url, { headers: { 'if-none-match': etag } });
  expect(after.status(), 'a stale validator must miss after a replace').toBe(200);
  expect(after.headers().etag, 'and the new body carries a new validator').not.toBe(etag);
});

test('the outgoing file lands in the Recycle Bin, and a binned asset cannot be replaced', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  const asset = await upload(ctx, base, 'logo.jpg', 'image/jpeg', JPEG_32X16);

  const ok = await ctx.put(`${base}/media/${asset.id}/content`, {
    multipart: { file: { name: 'logo.jpg', mimeType: 'image/jpeg', buffer: JPEG_32X16 } },
  });
  expect(ok.status(), await ok.text()).toBe(200);
  const { snapshotId } = await ok.json();

  const bin = await ctx.get(`${base}/media/deleted`);
  expect(bin.status()).toBe(200);
  const binned = (await bin.json()).items as Array<{ id: string; filename: string }>;
  const snapshot = binned.find((i) => i.id === snapshotId);
  expect(snapshot, 'the replaced bytes are in the bin').toBeTruthy();
  expect(snapshot!.filename).toMatch(/replaced/i);
  // Restoring it is the undo — it comes back as its own asset, leaving the live one alone.
  expect((await ctx.post(`${base}/media/${snapshotId}/restore`)).status()).toBeLessThan(300);

  // A binned asset is not replaceable: that would write into a Recycle-Bin row.
  await ctx.delete(`${base}/media/${asset.id}`);
  const onBinned = await ctx.put(`${base}/media/${asset.id}/content`, {
    multipart: { file: { name: 'logo.jpg', mimeType: 'image/jpeg', buffer: JPEG_32X16 } },
  });
  expect(onBinned.status()).toBe(404);
});

test('an agent can replace a large file through a ticket pinned to that asset', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  const asset = await upload(ctx, base, 'photo.jpg', 'image/jpeg', JPEG_32X16);

  // The two-step lane `create_media_replace` drives: mint, then send the bytes to the one-shot URL.
  const mint = await ctx.post(`${base}/media/upload-ticket`, { data: { replaceAssetId: asset.id } });
  expect(mint.status(), await mint.text()).toBe(201);
  const { uploadPath } = await mint.json();

  const sent = await ctx.put(`${uploadPath}?filename=photo.jpg`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: JPEG_32X16,
  });
  expect(sent.status(), await sent.text()).toBe(200);
  const receipt = await sent.json();
  expect(receipt.item.id).toBe(asset.id);
  expect(receipt.item.url).toBe(asset.url);
  expect(receipt.previous.width).toBe(32);

  // SINGLE USE — a replayed ticket is indistinguishable from an unknown one.
  const replay = await ctx.put(`${uploadPath}?filename=photo.jpg`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: JPEG_32X16,
  });
  expect(replay.status()).toBe(404);

  // A ticket for an asset that does not exist is refused at MINT time, where the agent can see it.
  const bad = await ctx.post(`${base}/media/upload-ticket`, { data: { replaceAssetId: 'nope123' } });
  expect(bad.status()).toBe(404);
});
