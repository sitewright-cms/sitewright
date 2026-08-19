import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { readUprightSize } from '@sitewright/image-pipeline';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * `POST /media/:id/transform` — the general form of the rotate route: turn and/or cut, in place or
 * into a new asset. It is what the Image Editor studio saves through, and what an agent's
 * `transform_image` tool calls.
 *
 * The two things worth pinning are the ORDER (rotate, then crop, so a box drawn over what the author
 * sees means what they meant) and the two DESTINATIONS behaving differently on purpose.
 */

/** A 64×32 JPEG (left half red, right half blue) carrying EXIF `Orientation: 1`. */
const JPEG_64X32 = Buffer.from(
  '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAAAQAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAEAAAAADoAQAAQAAACAAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAIABAAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABcBAQEBAQAAAAAAAAAAAAAAAAAJBwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCJAMqd+gAJCAqkm0AArwCVqkoACQgKpJtAAP/Z',
  'base64',
);

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-transform-'));
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

async function upload(projectId: string, t: string, filename: string, bytes: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
  );
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media`,
    cookies: { sw_session: t },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  });
  expect(res.statusCode, `upload must succeed: ${res.body}`).toBeLessThan(300);
  return res.json() as { item: { id: string; url: string; width: number; height: number; folder: string } };
}

async function transform(projectId: string, t: string, id: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media/${id}/transform`,
    cookies: { sw_session: t },
    payload,
  });
}

describe('POST /media/:id/transform — in place', () => {
  it('crops the stored original and keeps the URL, so every reference still resolves', async () => {
    const { t, projectId } = await setup('crop@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);
    expect([item.width, item.height]).toEqual([64, 32]);
    // Materialise a thumbnail so there is a stale one to drop.
    expect((await app.inject({ method: 'GET', url: `${item.url}?size=sm` })).statusCode).toBe(200);

    const res = await transform(projectId, t, item.id, { crop: { left: 0, top: 0, width: 32, height: 32 } });
    expect(res.statusCode, res.body).toBe(200);
    const after = (res.json() as { item: { url: string; width: number; height: number } }).item;
    expect([after.width, after.height]).toEqual([32, 32]);
    expect(after.url).toBe(item.url);

    const original = await app.inject({ method: 'GET', url: `${item.url}?size=original` });
    expect(await readUprightSize(original.rawPayload)).toMatchObject({ width: 32, height: 32 });
  });

  it('★ rotates BEFORE cropping — the box is measured against what the author sees', async () => {
    // 64×32 turned a quarter is 32×64. A 32×64 crop is then the WHOLE image and must be accepted;
    // if the crop ran first it would be out of bounds on the un-turned 64×32 and 400.
    const { t, projectId } = await setup('order@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);
    const res = await transform(projectId, t, item.id, {
      rotate: 90,
      crop: { left: 0, top: 32, width: 32, height: 32 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = (res.json() as { item: { width: number; height: number } }).item;
    expect([after.width, after.height]).toEqual([32, 32]);
  });

  it('rejects a crop that reaches outside the image, naming the size it was measured against', async () => {
    const { t, projectId } = await setup('oob@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);
    const res = await transform(projectId, t, item.id, { crop: { left: 0, top: 0, width: 999, height: 10 } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/outside the image \(64×32/);
  });

  it('rejects an empty request, a bad rotation, and a fractional crop', async () => {
    const { t, projectId } = await setup('bad@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);
    expect((await transform(projectId, t, item.id, {})).statusCode).toBe(400);
    expect((await transform(projectId, t, item.id, { rotate: 45 })).statusCode).toBe(400);
    expect(
      (await transform(projectId, t, item.id, { crop: { left: 0.5, top: 0, width: 10, height: 10 } })).statusCode,
    ).toBe(400);
  });

  it('★ refuses an in-place format change — the extension is baked into every URL', async () => {
    const { t, projectId } = await setup('fmt@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);
    const res = await transform(projectId, t, item.id, { rotate: 90, format: 'png' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/without changing its format/);
  });
});

describe('POST /media/:id/transform — saveAs', () => {
  it('writes a NEW asset and leaves the source untouched', async () => {
    const { t, projectId } = await setup('saveas@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);

    const res = await transform(projectId, t, item.id, {
      crop: { left: 0, top: 0, width: 32, height: 32 },
      format: 'webp',
      saveAs: { filename: 'wide-cropped.webp' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = (res.json() as { item: { id: string; url: string; width: number; height: number; folder: string } }).item;
    expect(created.id).not.toBe(item.id);
    expect([created.width, created.height]).toEqual([32, 32]);
    expect(created.url).not.toBe(item.url);

    // The SOURCE is exactly as it was — that is the whole difference from an in-place edit.
    const src = await app.inject({ method: 'GET', url: `${item.url}?size=original` });
    expect(await readUprightSize(src.rawPayload)).toMatchObject({ width: 64, height: 32 });
  });

  it('a save-as MAY change format, and lands in the source folder by default', async () => {
    const { t, projectId } = await setup('saveasfmt@t.test');
    const { item } = await upload(projectId, t, 'wide.jpg', JPEG_64X32);
    const res = await transform(projectId, t, item.id, {
      rotate: 180,
      format: 'webp',
      saveAs: { filename: 'turned.webp' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = (res.json() as { item: { folder: string; filename: string } }).item;
    expect(created.folder).toBe(item.folder);
    expect(created.filename).toBe('turned.webp');
  });
});
