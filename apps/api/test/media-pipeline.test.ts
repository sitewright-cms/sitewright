import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// ---------------------------------------------------------------------------
// Self-contained, valid PNG generator (node builtins only).
//
// `sharp` is a transitive dep of @sitewright/image-pipeline and is NOT resolvable
// from the api package, so we cannot `import sharp` here. Instead we hand-build
// real PNGs (8-bit truecolour, zlib-deflated raw scanlines). The image pipeline's
// `sharp` decodes these for real, so this exercises the genuine optimize path
// (variant widths, LQIP, jpeg fallback, dimension metadata) at the HTTP layer.
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** Builds a valid solid-colour PNG of the given dimensions. */
function makePng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (RGB)
  // 10-12 (compression, filter, interlace) left 0
  const row = Buffer.alloc(1 + width * 3); // leading filter byte (0 = None) + RGB pixels
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWPIPELINEBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail]),
  };
}

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-media-pipeline-'));
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

async function setup(email: string) {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }),
  );
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug: `s-${Math.random().toString(36).slice(2, 8)}` },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId, base: `/projects/${projectId}` };
}

interface MediaVariant {
  format: 'avif' | 'webp';
  width: number;
  height: number;
  path: string;
}
interface MediaAsset {
  id: string;
  filename: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  placeholder?: string;
  hasAlpha: boolean;
  animated: boolean;
  original: string;
  url: string;
}

async function upload(base: string, t: string, name: string, mime: string, content: Buffer) {
  return app.inject({
    method: 'POST',
    url: `${base}/media`,
    cookies: { sw_session: t },
    ...multipart(name, mime, content),
  });
}

describe('media pipeline (HTTP layer)', () => {
  // (1) An upload stores the RETAINED ORIGINAL (source of truth) + LQIP + dimension metadata, with NO
  // eager variants. The media route then serves on-demand responsive thumbnails: `?size` (default xl)
  // → WebP/AVIF, `?size=original` → the raw original inline.
  it('stores the retained original + LQIP and serves on-demand responsive thumbnails', async () => {
    const { t, base } = await setup('a@acme.test');
    const png = makePng(1000, 500, [200, 30, 30]);

    const up = await upload(base, t, 'banner.png', 'image/png', png);
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: MediaAsset }).item;

    // Source dimension metadata is preserved (drives width/height attrs → no CLS).
    expect(asset.width).toBe(1000);
    expect(asset.height).toBe(500);
    expect(asset.format).toBe('png'); // stored original's own format
    expect(asset.hasAlpha).toBe(false);
    expect(asset.animated).toBe(false);
    expect(asset.bytes).toBe(png.length);

    // The retained original is stored (verbatim); NO eager variant fan-out.
    expect(asset).not.toHaveProperty('variants');
    expect(asset).not.toHaveProperty('fallback');
    expect(asset.original).toBe('banner.png');

    // LQIP placeholder is an inline webp data URI.
    expect(asset.placeholder).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);

    // The delivery URL is the id-bearing route ending in the ORIGINAL name (bare ⇒ xl thumbnail).
    const projId = asset.url.split('/')[2];
    expect(asset.url).toBe(`/media/${projId}/${asset.id}/banner.png`);

    // Bare delivery URL ⇒ compressed `xl` WebP (default), generated on demand.
    const xl = await app.inject({ method: 'GET', url: asset.url });
    expect(xl.statusCode).toBe(200);
    expect(xl.headers['content-type']).toBe('image/webp');
    expect(xl.rawPayload.length).toBeGreaterThan(0);

    // `?size=sm` ⇒ another WebP (500 ≤ source 1000, so never upscaled).
    const sm = await app.inject({ method: 'GET', url: `${asset.url}?size=sm` });
    expect(sm.statusCode).toBe(200);
    expect(sm.headers['content-type']).toBe('image/webp');

    // `?format=avif` opts into AVIF.
    const avif = await app.inject({ method: 'GET', url: `${asset.url}?size=lg&format=avif` });
    expect(avif.statusCode).toBe(200);
    expect(avif.headers['content-type']).toBe('image/avif');

    // `?size=original` serves the raw original PNG inline (verbatim bytes).
    const orig = await app.inject({ method: 'GET', url: `${asset.url}?size=original` });
    expect(orig.statusCode).toBe(200);
    expect(orig.headers['content-type']).toBe('image/png');
    expect(orig.rawPayload.length).toBe(png.length);

    // An unknown size token falls back to the default (xl) instead of erroring.
    const bad = await app.inject({ method: 'GET', url: `${asset.url}?size=whatever` });
    expect(bad.statusCode).toBe(200);
    expect(bad.headers['content-type']).toBe('image/webp');
  });

  // (1b) A tiny source is never upscaled: an `xl` (2400) request of a 120px image still serves a valid
  // (clamped) WebP.
  it('serves a clamped thumbnail for a source narrower than the requested size (no upscale)', async () => {
    const { t, base } = await setup('a@acme.test');
    const png = makePng(120, 90, [10, 120, 200]);

    const up = await upload(base, t, 'thumb.png', 'image/png', png);
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: MediaAsset }).item;

    expect(asset.width).toBe(120);
    expect(asset.height).toBe(90);
    expect(asset.original).toBe('thumb.png');
    const xl = await app.inject({ method: 'GET', url: asset.url });
    expect(xl.statusCode).toBe(200);
    expect(xl.headers['content-type']).toBe('image/webp');
  });

  // (2) SVG is intentionally excluded for SSRF reasons; a text file with an image
  // content-type is also rejected. Both surface as 400 (unsupported/invalid image).
  it('rejects an SVG upload (SSRF-excluded format) with 400', async () => {
    const { t, base } = await setup('a@acme.test');
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    const res = await upload(base, t, 'logo.svg', 'image/svg+xml', svg);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-image payload sent with an image content-type (400)', async () => {
    const { t, base } = await setup('a@acme.test');
    const res = await upload(base, t, 'fake.png', 'image/png', Buffer.from('not really a png at all'));
    expect(res.statusCode).toBe(400);
  });

  // (3a) An image exceeding the decoded pixel limit (MAX_INPUT_PIXELS = 50MP) is
  // rejected. 8000x7000 = 56MP; the solid-colour PNG deflates to ~0.2 MiB so it
  // is well under the 15 MiB multipart limit and reaches the pipeline's check.
  it('rejects an image over the decoded pixel limit (8000x7000 > 50MP) with 400', async () => {
    const { t, base } = await setup('a@acme.test');
    const huge = makePng(8000, 7000, [5, 5, 5]);
    expect(huge.length).toBeLessThan(15 * 1024 * 1024); // safely under the multipart cap
    const res = await upload(base, t, 'enormous.png', 'image/png', huge);
    expect(res.statusCode).toBe(400);
  });

  // (3b) A file larger than the multipart upload limit (15 MiB) is rejected with
  // 413 by @fastify/multipart's truncation, before the pipeline ever runs. We pad
  // a tiny valid PNG header with incompressible random bytes to exceed the cap.
  it('rejects an upload exceeding the 15 MiB multipart limit with 413', async () => {
    const { t, base } = await setup('a@acme.test');
    // 16 MiB of random (incompressible) bytes — content is irrelevant since the
    // size limit trips during streaming, before any image decode.
    const oversized = Buffer.alloc(16 * 1024 * 1024);
    for (let i = 0; i < oversized.length; i += 4096) oversized[i] = (i * 31) & 0xff;
    const res = await upload(base, t, 'huge.png', 'image/png', oversized);
    expect(res.statusCode).toBe(413);
  });

  // (4) Listing returns uploaded assets for the owner; a second tenant cannot
  // list (or otherwise read) another org's project media (cross-tenant 403).
  it('lists uploaded assets for the owner and forbids cross-tenant listing', async () => {
    const a = await setup('a@acme.test');
    const b = await setup('b@globex.test');

    const up1 = await upload(a.base, a.t, 'one.png', 'image/png', makePng(500, 400, [1, 2, 3]));
    const up2 = await upload(a.base, a.t, 'two.png', 'image/png', makePng(640, 480, [9, 8, 7]));
    expect(up1.statusCode).toBe(201);
    expect(up2.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: `${a.base}/media`, cookies: { sw_session: a.t } });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: MediaAsset[] }).items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.filename).sort()).toEqual(['one.png', 'two.png']);

    // Cross-tenant: B (member of Globex only) cannot list Acme's project media.
    const crossList = await app.inject({
      method: 'GET',
      url: `${a.base}/media`,
      cookies: { sw_session: b.t },
    });
    expect(crossList.statusCode).toBe(403);

    // Cross-tenant: B cannot upload into Acme's project either.
    const crossUp = await upload(a.base, b.t, 'evil.png', 'image/png', makePng(300, 200, [0, 0, 0]));
    expect(crossUp.statusCode).toBe(403);

    // Cross-tenant: B cannot delete Acme's asset.
    const crossDel = await app.inject({
      method: 'DELETE',
      url: `${a.base}/media/${items[0]!.id}`,
      cookies: { sw_session: b.t },
    });
    expect(crossDel.statusCode).toBe(403);
  });

  // (5) The owner can delete their media: the DB row goes away (list shrinks) and
  // the served binaries 404 afterwards.
  it('lets the owner delete media, removing both the record and the binaries', async () => {
    const { t, base } = await setup('a@acme.test');
    const up = await upload(base, t, 'gone.png', 'image/png', makePng(900, 600, [44, 55, 66]));
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: MediaAsset }).item;

    // Binary is fetchable before deletion.
    const before = await app.inject({ method: 'GET', url: asset.url });
    expect(before.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `${base}/media/${asset.id}`,
      cookies: { sw_session: t },
    });
    expect(del.statusCode).toBe(204);

    // Record removed from the listing.
    const list = await app.inject({ method: 'GET', url: `${base}/media`, cookies: { sw_session: t } });
    expect((list.json() as { items: MediaAsset[] }).items).toHaveLength(0);

    // Binaries removed from disk (public serve 404s).
    const after = await app.inject({ method: 'GET', url: asset.url });
    expect(after.statusCode).toBe(404);
  });
});
