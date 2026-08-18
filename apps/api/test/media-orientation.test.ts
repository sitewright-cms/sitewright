import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { readUprightSize, renderPlaceholder } from '@sitewright/image-pipeline';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { content } from '../src/db/schema.js';
import { MediaStorage } from '../src/media/storage.js';
import { repairMediaOrientation } from '../src/repo/media-orientation.js';

// A phone photographed in PORTRAIT writes LANDSCAPE pixels plus an EXIF Orientation tag. Browsers
// apply it, so the original looks upright; sharp does not unless asked, and strips metadata on
// encode — so before the fix the recorded size was the sideways pair and every derived thumbnail was
// sideways WITHOUT the tag that would have let the browser correct it. A hero, a card and a gallery
// tile were all on their side while the media library showed the photo upright.

/**
 * A 64×32 JPEG (left half red, right half blue) carrying an EXIF block with `Orientation: 1`.
 * Embedded rather than generated so this test needs no image library of its own — the api package
 * deliberately has no direct `sharp` dependency.
 */
const JPEG_64X32 = Buffer.from(
  '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAAAQAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAEAAAAADoAQAAQAAACAAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAIABAAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABcBAQEBAQAAAAAAAAAAAAAAAAAJBwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCJAMqd+gAJCAqkm0AArwCVqkoACQgKpJtAAP/Z',
  'base64',
);

/**
 * The same JPEG retagged. IFD0 entry `0x0112` (Orientation) is a 12-byte record — tag, type 3
 * (SHORT), count 1, then the value — so setting one byte after that fixed 8-byte prefix rewrites the
 * tag without touching a single pixel. Exactly what a camera does when it is held sideways.
 */
function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  const entry = Buffer.from([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00]);
  const at = jpeg.indexOf(entry);
  if (at < 0) throw new Error('fixture has no EXIF Orientation entry');
  const out = Buffer.from(jpeg);
  out[at + entry.length] = orientation;
  return out;
}

/** The bytes inside a `data:image/webp;base64,…` LQIP. */
function dataUriBytes(uri: string): Buffer {
  return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
}

/** Raw pixels 64×32 tagged `orientation`; orientations 5–8 make a browser paint it 32×64. */
function rotatedJpeg(orientation: number): Buffer {
  return withOrientation(JPEG_64X32, orientation);
}

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-orient-'));
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
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id, slug };
}

async function upload(projectId: string, t: string, filename: string, content_: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
  );
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media`,
    cookies: { sw_session: t },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content_, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  });
  return res.json() as { item: { id: string; url: string; width: number; height: number; placeholder?: string } };
}

describe('EXIF-rotated uploads', () => {
  it('records the UPRIGHT size and serves UPRIGHT thumbnails', async () => {
    const { t, projectId } = await setup('rot@orient.test');
    const { item } = await upload(projectId, t, 'phone.jpg', rotatedJpeg(6));

    // The record is what `sw-image` writes as the intrinsic size and derives its aspect box from.
    expect(item.width).toBe(32);
    expect(item.height).toBe(64);

    const thumb = await app.inject({ method: 'GET', url: `${item.url}?size=sm` });
    expect(thumb.statusCode).toBe(200);
    const meta = await readUprightSize(thumb.rawPayload);
    expect(meta!.height).toBeGreaterThan(meta!.width); // portrait, as the browser shows the original

    // The LQIP sits behind the real image at the same box — a sideways blur there is visible.
    const lqip = await readUprightSize(Buffer.from(dataUriBytes(item.placeholder ?? '')));
    expect(lqip!.height).toBeGreaterThan(lqip!.width);
  });

  it('leaves an untagged upload exactly as it was', async () => {
    const { t, projectId } = await setup('flat@orient.test');
    const { item } = await upload(projectId, t, 'scan.jpg', rotatedJpeg(1));
    expect(item.width).toBe(64);
    expect(item.height).toBe(32);
  });
});

describe('repairMediaOrientation (one-time repair of media stored before the fix)', () => {
  /** Rewind one asset's record to what the OLD pipeline would have written: the sideways pair. */
  async function regressToLegacy(projectId: string, assetId: string, width: number, height: number) {
    const [row] = await db
      .select()
      .from(content)
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'media'), eq(content.entityId, assetId)));
    await db
      .update(content)
      .set({ data: { ...(row!.data as Record<string, unknown>), width, height } })
      .where(eq(content.id, row!.id));
  }

  async function recordOf(projectId: string, assetId: string) {
    const [row] = await db
      .select()
      .from(content)
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'media'), eq(content.entityId, assetId)));
    return row!.data as { width: number; height: number; placeholder: string };
  }

  it('corrects the recorded size and drops the stale thumbnails', async () => {
    const { t, projectId, slug } = await setup('repair@orient.test');
    const { item } = await upload(projectId, t, 'phone.jpg', rotatedJpeg(6));
    await regressToLegacy(projectId, item.id, 64, 32);

    // Materialise a cached thumbnail, so there is something stale to drop.
    expect((await app.inject({ method: 'GET', url: `${item.url}?size=sm` })).statusCode).toBe(200);

    const storage = new MediaStorage(mediaRoot);
    const report = await repairMediaOrientation(db, storage);

    expect(report.corrected).toBe(1);
    expect(report.thumbsDropped).toBeGreaterThanOrEqual(1);
    expect(report.failed).toBe(0);
    const fixed = await recordOf(projectId, item.id);
    expect(fixed.width).toBe(32);
    expect(fixed.height).toBe(64);

    // The regenerated thumbnail is upright.
    const again = await app.inject({ method: 'GET', url: `${item.url}?size=sm` });
    const meta = await readUprightSize(again.rawPayload);
    expect(meta!.height).toBeGreaterThan(meta!.width);
    expect(slug).toBe('site');
  });

  it('re-renders the LQIP upright too', async () => {
    const { t, projectId } = await setup('lqip@orient.test');
    const { item } = await upload(projectId, t, 'phone.jpg', rotatedJpeg(8));
    // Regress BOTH the dimensions and the placeholder to their pre-fix (sideways) values. Stripping
    // the tag is what makes the placeholder sideways: renderPlaceholder has nothing left to apply.
    const sideways = await renderPlaceholder(withOrientation(JPEG_64X32, 1));
    const [row] = await db
      .select()
      .from(content)
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'media'), eq(content.entityId, item.id)));
    await db
      .update(content)
      .set({
        data: {
          ...(row!.data as Record<string, unknown>),
          width: 64,
          height: 32,
          placeholder: sideways,
        },
      })
      .where(eq(content.id, row!.id));

    await repairMediaOrientation(db, new MediaStorage(mediaRoot));

    const fixed = await recordOf(projectId, item.id);
    const meta = await readUprightSize(Buffer.from(dataUriBytes(fixed.placeholder)));
    expect(meta!.height).toBeGreaterThan(meta!.width);
  });

  it('does not touch an untagged asset, and is safe to run twice', async () => {
    const { t, projectId } = await setup('idem@orient.test');
    const flat = await upload(projectId, t, 'scan.jpg', rotatedJpeg(1));
    const rot = await upload(projectId, t, 'phone.jpg', rotatedJpeg(6));
    await regressToLegacy(projectId, rot.item.id, 64, 32);

    const storage = new MediaStorage(mediaRoot);
    const first = await repairMediaOrientation(db, storage);
    expect(first.corrected).toBe(1);

    const second = await repairMediaOrientation(db, storage);
    expect(second.corrected).toBe(0); // nothing left to write
    expect(second.failed).toBe(0);

    const untouched = await recordOf(projectId, flat.item.id);
    expect(untouched.width).toBe(64);
    expect(untouched.height).toBe(32);
  });

  it('refuses to rewrite a record that disagrees in some OTHER way than a transpose', async () => {
    const { t, projectId } = await setup('guard@orient.test');
    const { item } = await upload(projectId, t, 'phone.jpg', rotatedJpeg(6));
    // Not the transposed pair — e.g. a hand-edited row, or a file swapped under the record.
    await regressToLegacy(projectId, item.id, 123, 456);

    const report = await repairMediaOrientation(db, new MediaStorage(mediaRoot));
    expect(report.corrected).toBe(0);
    const still = await recordOf(projectId, item.id);
    expect(still.width).toBe(123);
    expect(still.height).toBe(456);
  });
});
