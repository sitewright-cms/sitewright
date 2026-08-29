import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { makePng } from './png.js';
import { THUMB_SIZES, DEFAULT_SIZE } from '@sitewright/image-pipeline';

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
    expect(asset.url).toBe(`/media/${projId}/${asset.id}-banner.png`);

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

  // (2) SVG is PRESERVED as a sanitized vector image (kind:'image', format:'svg') — never routed
  // through sharp, stored verbatim, served inline under a locked-down CSP.
  it('preserves an SVG upload as a sanitized vector image (201, format svg)', async () => {
    const { t, base } = await setup('a@acme.test');
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><script>steal()</script><rect width="120" height="40"/></svg>',
    );
    const res = await upload(base, t, 'logo.svg', 'image/svg+xml', svg);
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item.kind).toBe('image');
    expect(item.format).toBe('svg');
    expect(item.width).toBe(120);
    expect(item.height).toBe(40);
    expect(item.url).toMatch(/\.svg$/);
    // the stored/served bytes are sanitized — the <script> is gone
    const served = await app.inject({ method: 'GET', url: item.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(served.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(served.body).not.toMatch(/<script/i);
  });

  it('rejects a malformed SVG upload (nothing usable after sanitization) with 400', async () => {
    const { t, base } = await setup('a@acme.test');
    const res = await upload(base, t, 'bad.svg', 'image/svg+xml', Buffer.from('not an svg at all'));
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

  // (3b) An IMAGE over the image pipeline's own 15 MiB budget is still rejected — sharp must not be
  // handed an arbitrarily large buffer. The MULTIPART limit is now 200 MiB (a real background video is
  // tens of megabytes, and the 15 MiB ceiling — sized for an image — quietly became the ceiling for
  // every upload, so the media library could not hold a video at all).
  it('still rejects an oversized IMAGE, while the multipart limit itself now allows video-sized uploads', async () => {
    const { t, base } = await setup('a@acme.test');
    // 16 MiB of incompressible bytes: past the image budget, well under the 200 MiB multipart cap.
    const oversized = Buffer.alloc(16 * 1024 * 1024);
    for (let i = 0; i < oversized.length; i += 4096) oversized[i] = (i * 31) & 0xff;
    const res = await upload(base, t, 'huge.png', 'image/png', oversized);
    // Rejected by the image path, not by multipart truncation — either code is a rejection, and the
    // point is that it does NOT succeed.
    expect([400, 413]).toContain(res.statusCode);
  });

  // (3c) A VIDEO larger than the old 15 MiB image ceiling is accepted and stored as the inline
  // `video` kind. This is the defect that motivated the change: a clone of a site whose hero is a
  // full-viewport autoplay bg_video.webm (15.9 MiB) came back with no video, no video asset, and no
  // warning — there was nowhere to put one.
  it('accepts a video past the old image ceiling and stores it as kind "video"', async () => {
    const { t, base } = await setup('a@acme.test');
    // A 16 MiB buffer with a plausible WebM/EBML magic prefix.
    const vid = Buffer.alloc(16 * 1024 * 1024);
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(vid, 0);
    const res = await upload(base, t, 'bg_video.webm', 'video/webm', vid);
    expect(res.statusCode).toBe(201);
    const item = (res.json() as { item: { kind: string; contentType: string; url: string; bytes: number } }).item;
    expect(item.kind).toBe('video');
    expect(item.contentType).toBe('video/webm');
    expect(item.bytes).toBe(vid.length);

    // …and it SERVES INLINE — a background video has to play, not download.
    const served = await app.inject({ method: 'GET', url: item.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toContain('video/webm');
    expect(served.headers['content-disposition']).toBeUndefined();
    expect(served.headers['accept-ranges']).toBe('bytes');

    // RANGE REQUESTS must actually work. Advertising accept-ranges and then ignoring Range is worse
    // than not advertising it: the browser believes it can seek, asks for a window, gets the whole
    // file with a 200, and SNAPS BACK TO 0 — measured on the first cut of this route.
    const part = await app.inject({ method: 'GET', url: item.url, headers: { range: 'bytes=100-199' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${vid.length}`);
    expect(part.headers['content-length']).toBe('100');
    expect(part.rawPayload.length).toBe(100);

    // an open-ended range runs to the end…
    const tail = await app.inject({ method: 'GET', url: item.url, headers: { range: `bytes=${vid.length - 10}-` } });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.length).toBe(10);

    // …and a nonsensical one is refused with 416 rather than silently serving everything.
    const bad = await app.inject({ method: 'GET', url: item.url, headers: { range: `bytes=${vid.length + 5}-` } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${vid.length}`);
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

    // Soft-delete: hidden from the listing (moved to the Recycle Bin).
    const list = await app.inject({ method: 'GET', url: `${base}/media`, cookies: { sw_session: t } });
    expect((list.json() as { items: MediaAsset[] }).items).toHaveLength(0);

    // The binary is RETAINED (restorable) so the public URL keeps serving until purge/reap.
    const after = await app.inject({ method: 'GET', url: asset.url });
    expect(after.statusCode).toBe(200);
  });

  // (6) A per-project upload cap (website.imageUploadCap) downscales + re-encodes new originals to WebP.
  it('applies the project upload cap to a new upload (settings-driven)', async () => {
    const { t, base } = await setup('cap@acme.test');
    const cookies = { sw_session: t };
    const cur = (await app.inject({ method: 'GET', url: `${base}/content/settings/settings`, cookies })).json() as {
      item: { website?: Record<string, unknown> };
    };
    const item = cur.item;
    item.website = { ...(item.website ?? {}), imageUploadCap: 600 };
    const put = await app.inject({ method: 'PUT', url: `${base}/content/settings/settings`, cookies, payload: item });
    expect(put.statusCode).toBe(200);

    const up = await upload(base, t, 'big.png', 'image/png', makePng(1600, 900, [1, 2, 3]));
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: MediaAsset }).item;
    expect(asset.width).toBe(600); // capped from 1600, never upscaled
    expect(asset.format).toBe('webp'); // cap bit → re-encoded to webp
    expect(asset.original.endsWith('.webp')).toBe(true);
  });

  // (6b) A NEW project is seeded with the cap already set, so an oversized upload is bounded with no
  // configuration at all. This is the case that actually protects a disk: nobody visits Settings before
  // dropping in a phone photo.
  it('applies the DEFAULT cap on a brand-new project, with no settings touched', async () => {
    const { t, base } = await setup('defaultcap@acme.test');
    const up = await upload(base, t, 'huge.png', 'image/png', makePng(3000, 1500, [4, 5, 6]));
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: MediaAsset }).item;
    expect(asset.width).toBe(THUMB_SIZES[DEFAULT_SIZE]); // 3000 → the xl width
    expect(asset.height).toBe(THUMB_SIZES[DEFAULT_SIZE] / 2); // aspect preserved
    expect(asset.format).toBe('webp'); // the cap bit → re-encoded, exactly as an explicit cap does
  });

  // …and an upload UNDER the cap is untouched: the default must not re-encode everything it sees.
  it('leaves an image narrower than the default cap in its original format', async () => {
    const { t, base } = await setup('undercap@acme.test');
    const up = await upload(base, t, 'small.png', 'image/png', makePng(800, 400, [7, 8, 9]));
    const asset = (up.json() as { item: MediaAsset }).item;
    expect(asset.width).toBe(800); // never upscaled
    expect(asset.format).toBe('png'); // cap did not bite → stored verbatim
  });

  // ★ The default is SEEDED STATE, not a schema/runtime default. An existing project whose settings
  // carry no cap stays uncapped — upgrading the platform must not silently start downscaling the
  // originals of every project that predates this.
  it('does not cap a project whose settings carry no cap (seed-only, never retroactive)', async () => {
    const { t, base } = await setup('nocap@acme.test');
    const cookies = { sw_session: t };
    const cur = (await app.inject({ method: 'GET', url: `${base}/content/settings/settings`, cookies })).json() as {
      item: { website?: Record<string, unknown> };
    };
    const item = cur.item;
    const withoutCap = { ...(item.website ?? {}) };
    delete withoutCap.imageUploadCap;
    item.website = withoutCap;
    expect((await app.inject({ method: 'PUT', url: `${base}/content/settings/settings`, cookies, payload: item })).statusCode).toBe(200);

    const up = await upload(base, t, 'uncapped.png', 'image/png', makePng(3000, 1500, [1, 1, 1]));
    const asset = (up.json() as { item: MediaAsset }).item;
    expect(asset.width).toBe(3000); // full resolution retained
    expect(asset.format).toBe('png');
  });

  // (7) Prune clears the on-demand thumbnail cache (regenerable) but keeps every retained original.
  it('clears the thumbnail cache via prune-thumbnails, keeping the original', async () => {
    const { t, base } = await setup('prune@acme.test');
    const cookies = { sw_session: t };
    const up = await upload(base, t, 'p.png', 'image/png', makePng(1000, 500, [9, 9, 9]));
    const asset = (up.json() as { item: MediaAsset }).item;
    // Generate a couple of cached thumbnails via the on-demand serve route.
    await app.inject({ method: 'GET', url: asset.url });
    await app.inject({ method: 'GET', url: `${asset.url}?size=sm` });

    const res = await app.inject({ method: 'POST', url: `${base}/media/prune-thumbnails`, cookies });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { removed: number }).removed).toBeGreaterThanOrEqual(2);
    // The original still serves after prune (thumbnails regenerate on demand).
    const orig = await app.inject({ method: 'GET', url: `${asset.url}?size=original` });
    expect(orig.statusCode).toBe(200);
  });
});
