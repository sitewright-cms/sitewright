import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * Large uploads go to DISK, never through the heap.
 *
 * Measured before this: a 120MB upload left 107MB resident, because both upload routes read the whole
 * body into a Buffer (`file.toBuffer()` on the multipart route, `parseAs: 'buffer'` on the ticket
 * route's content-type parser). Video and download-only files are the only upload kinds with no small
 * cap — images are 15MB, SVG 4MB, fonts 5MB — so they are the only ones where it cost anything.
 *
 * Streaming introduces a NEW failure mode these tests exist to guard: a temp file that outlives the
 * request. Every exit path has to remove it, including the ones that reject before storing.
 */
// A pass-through spy, so a test can ask whether the app ever read a STAGED upload back into the heap.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

let app: FastifyInstance;
let db: Database;
let mediaRoot: string;

beforeEach(async () => {
  vi.mocked(readFile).mockClear();
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-upload-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  if (app) await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

/** Temp files staged by an in-flight upload; must be empty once a request has settled. */
async function stagedTempFiles(): Promise<string[]> {
  return readdir(join(mediaRoot, '.uploads-tmp')).catch(() => []);
}

/** Reads of a STAGED upload back into the heap since the test began (the spy is cleared per test). */
const stagedReads = (): unknown[] => vi.mocked(readFile).mock.calls.filter(([p]) => String(p).includes('.uploads-tmp'));

async function setup(email = 'up@e2e.test') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: 'Up', slug: `up${Date.now().toString(36)}` },
  });
  const body = proj.json() as { project: { id: string; slug: string } };
  return { t, projectId: body.project.id, slug: body.project.slug };
}

async function mintTicket(t: string, projectId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media/upload-ticket`,
    cookies: { sw_session: t },
    payload: { folder: 'V' },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { uploadPath: string }).uploadPath;
}

describe('large uploads stream to disk', () => {
  it('stores a multi-megabyte video through the ticket and reports its real size', async () => {
    const { t, projectId } = await setup();
    const uploadPath = await mintTicket(t, projectId);
    const bytes = Buffer.alloc(12 * 1024 * 1024, 9); // comfortably past any small cap

    const res = await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=clip.mp4`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    expect(res.statusCode).toBe(201);
    const item = (res.json() as { item: { kind: string; bytes: number; url: string } }).item;
    expect(item.kind, 'a playable extension is stored as video, not a download').toBe('video');
    expect(item.bytes, 'size comes from the file on disk, not a buffer length').toBe(bytes.length);
  });

  it('★ never reads a staged video or download back into the heap', async () => {
    // The font sniff compared the detector's answer to `undefined` while it says `null` for "not a
    // font", so every non-image upload counted as a possible font and was read WHOLE into memory —
    // the stored asset looked identical, and the heap paid the full size anyway.
    const { t, projectId } = await setup();
    for (const filename of ['clip.mp4', 'report.pdf']) {
      const uploadPath = await mintTicket(t, projectId);
      const res = await app.inject({
        method: 'PUT',
        url: `${uploadPath}?filename=${filename}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(1024 * 1024, 5),
      });
      expect(res.statusCode).toBe(201);
    }
    expect(stagedReads(), 'a large upload goes from the temp file straight into place').toEqual([]);
  });

  it('★ refuses an oversized IMAGE/SVG/FONT by its size on disk — before reading a byte of it', async () => {
    // The kinds that are read in (and handed to sharp / the sanitizer) are chosen by the CLIENT: the
    // name says ".png", or the first four bytes say "wOF2". Checked only after readFile, either one put
    // up to the 200MB ticket ceiling into the heap first.
    const { t, projectId } = await setup();
    for (const [filename, bytes, message] of [
      ['huge.png', 15 * 1024 * 1024 + 1, /15MB/],
      ['huge.svg', 4 * 1024 * 1024 + 1, /4MB/],
      ['huge.woff2', 5 * 1024 * 1024 + 1, /size limit/],
    ] as const) {
      const uploadPath = await mintTicket(t, projectId);
      const payload = Buffer.alloc(bytes, 0x20);
      if (filename.endsWith('.woff2')) payload.write('wOF2');
      const res = await app.inject({
        method: 'PUT',
        url: `${uploadPath}?filename=${filename}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload,
      });
      expect(res.statusCode, filename).toBe(413);
      expect((res.json() as { error: string }).error, filename).toMatch(message);
    }
    expect(stagedReads(), 'refused on its size alone').toEqual([]);
    expect(await stagedTempFiles(), 'and the refused bytes are gone').toEqual([]);
  });

  it('a real font under its cap is still read in, detected and stored', async () => {
    const { t, projectId } = await setup();
    const uploadPath = await mintTicket(t, projectId);
    const res = await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=Brand.woff2`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(1024, 1)]),
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { item: { kind: string } }).item.kind).toBe('font');
    expect(stagedReads()).toHaveLength(1);
  });

  it('leaves no temp file behind after a successful upload', async () => {
    const { t, projectId } = await setup();
    const uploadPath = await mintTicket(t, projectId);
    await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=clip.mp4`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(2 * 1024 * 1024, 1),
    });
    expect(await stagedTempFiles(), 'the staged file is renamed into place, not copied and left').toEqual([]);
  });

  it('leaves no temp file behind when the ticket is REJECTED', async () => {
    // The body is already on disk before the handler decides. A rejected ticket that kept its temp
    // file would leak one per attempt — an unauthenticated disk-fill.
    await setup();
    const res = await app.inject({
      method: 'PUT',
      url: '/media-upload/not-a-real-ticket?filename=clip.mp4',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(1024 * 1024, 3),
    });
    expect(res.statusCode).toBe(404);
    expect(await stagedTempFiles(), 'a refused upload must not keep its bytes').toEqual([]);
  });

  it('still rejects an empty upload', async () => {
    const { t, projectId } = await setup();
    const uploadPath = await mintTicket(t, projectId);
    const res = await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=clip.mp4`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(0),
    });
    expect(res.statusCode).toBe(400);
    expect(await stagedTempFiles()).toEqual([]);
  });

  it('still routes a small IMAGE through the optimizer rather than storing it raw', async () => {
    // The streaming path must not accidentally turn images into download-only files: sharp, the SVG
    // sanitizer and the font detector all still need the bytes, so those kinds are read back in.
    const { t, projectId } = await setup();
    const uploadPath = await mintTicket(t, projectId);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=pic.png`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: png,
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { item: { kind: string } }).item.kind, 'images stay images').toBe('image');
    expect(await stagedTempFiles()).toEqual([]);
  });

  it('writes the bytes through unchanged', async () => {
    const { t, projectId, slug } = await setup();
    const uploadPath = await mintTicket(t, projectId);
    const bytes = Buffer.alloc(3 * 1024 * 1024, 42);
    const res = await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=tone.mp4`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    const item = (res.json() as { item: { id: string; storedName: string } }).item;
    const onDisk = await stat(join(mediaRoot, slug, `${item.id}-${item.storedName}`));
    expect(onDisk.size, 'a streamed write must not truncate or transform').toBe(bytes.length);
  });
});
