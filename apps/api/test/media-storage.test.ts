import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStorage } from '../src/media/storage.js';

// A 6-char base62 id selects the FLAT layout (<proj>/<id>-<file>); anything else is the LEGACY
// per-asset-folder layout (<proj>/<id>/<file>), still supported for un-migrated assets.
const SHORT = 'a1B2c3';
const LEGACY = 'legacy00uuid00id';

let root: string;
let storage: MediaStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-media-'));
  storage = new MediaStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('MediaStorage — flat (short id) layout', () => {
  it('stores every file directly in the project dir as <id>-<name> (no per-asset folder)', async () => {
    await storage.storeFile('proj1', SHORT, 'photo.png', Buffer.from('IMG'));
    expect(existsSync(join(root, 'proj1', `${SHORT}-photo.png`))).toBe(true);
    expect(existsSync(join(root, 'proj1', SHORT))).toBe(false);
    expect((await storage.readStored('proj1', SHORT, 'photo.png')).toString()).toBe('IMG');
  });

  it('stageUpload targets the shared project dir + a <id>.upload temp', async () => {
    const { assetDir, inputPath } = await storage.stageUpload('proj1', SHORT, Buffer.from('raw'));
    expect(assetDir).toBe(join(root, 'proj1'));
    expect(inputPath).toBe(join(root, 'proj1', `${SHORT}.upload`));
    await storage.clearUpload(inputPath);
    expect(existsSync(inputPath)).toBe(false);
  });

  it('resolveServePath returns the flat <proj>/<id>-<file> path', () => {
    expect(storage.resolveServePath('proj1', SHORT, 'x-400.avif')).toContain(join('proj1', `${SHORT}-x-400.avif`));
  });

  it('remove deletes only THIS asset’s <id>-* files, leaving siblings untouched', async () => {
    const OTHER = 'z9Y8x7';
    await storage.storeFile('proj1', SHORT, 'a.webp', Buffer.from('a'));
    await storage.storeFile('proj1', OTHER, 'b.webp', Buffer.from('b'));
    await storage.remove('proj1', SHORT);
    await expect(storage.readStored('proj1', SHORT, 'a.webp')).rejects.toBeTruthy();
    expect((await storage.readStored('proj1', OTHER, 'b.webp')).toString()).toBe('b');
  });

  it('prunes derived thumbnails but keeps the retained original', async () => {
    await storage.storeFile('proj1', SHORT, 'photo.png', Buffer.from('ORIGINAL'));
    for (const t of ['photo-sm.webp', 'photo-md.webp', 'photo-xl.webp', 'photo-lg.avif']) {
      await storage.storeFile('proj1', SHORT, t, Buffer.from('thumb'));
    }
    expect(await storage.pruneAssetThumbnails('proj1', SHORT, 'photo.png')).toBe(4);
    expect((await storage.readStored('proj1', SHORT, 'photo.png')).toString()).toBe('ORIGINAL');
    await expect(storage.readStored('proj1', SHORT, 'photo-xl.webp')).rejects.toBeTruthy();
    // Idempotent, and a sibling asset's files are never counted.
    expect(await storage.pruneAssetThumbnails('proj1', SHORT, 'photo.png')).toBe(0);
  });

  it('copyAsset duplicates the source files under a new flat id', async () => {
    await storage.storeFile('proj1', SHORT, 'photo.png', Buffer.from('ORIGINAL'));
    await storage.storeFile('proj1', SHORT, 'photo-sm.webp', Buffer.from('thumb'));
    const DUP = 'Dup123';
    await storage.copyAsset('proj1', SHORT, DUP);
    expect((await storage.readStored('proj1', DUP, 'photo.png')).toString()).toBe('ORIGINAL');
    expect((await storage.readStored('proj1', DUP, 'photo-sm.webp')).toString()).toBe('thumb');
  });
});

describe('MediaStorage — legacy (foldered) layout', () => {
  it('stores files under a per-asset folder <proj>/<id>/<file>', async () => {
    await storage.storeFile('proj1', LEGACY, 'photo.png', Buffer.from('IMG'));
    expect(existsSync(join(root, 'proj1', LEGACY, 'photo.png'))).toBe(true);
    expect((await storage.readStored('proj1', LEGACY, 'photo.png')).toString()).toBe('IMG');
  });

  it('resolveServePath returns the foldered <proj>/<id>/<file> path', () => {
    expect(storage.resolveServePath('proj1', LEGACY, 'x-400.avif')).toContain(join('proj1', LEGACY, 'x-400.avif'));
  });

  it('remove deletes the whole per-asset folder', async () => {
    await storage.storeFile('proj1', LEGACY, 'a.webp', Buffer.from('a'));
    await storage.remove('proj1', LEGACY);
    expect(existsSync(join(root, 'proj1', LEGACY))).toBe(false);
  });

  it('prunes derived thumbnails but keeps the original', async () => {
    await storage.storeFile('proj1', LEGACY, 'photo.png', Buffer.from('ORIGINAL'));
    for (const t of ['photo-sm.webp', 'photo-lg.avif']) await storage.storeFile('proj1', LEGACY, t, Buffer.from('thumb'));
    expect(await storage.pruneAssetThumbnails('proj1', LEGACY, 'photo.png')).toBe(2);
    expect((await storage.readStored('proj1', LEGACY, 'photo.png')).toString()).toBe('ORIGINAL');
    await expect(storage.readStored('proj1', LEGACY, 'photo-lg.avif')).rejects.toBeTruthy();
  });
});

describe('MediaStorage — guards (both layouts)', () => {
  it('rejects path traversal + invalid servable file names', () => {
    for (const id of [SHORT, LEGACY]) {
      expect(() => storage.resolveServePath('p', id, '../../etc/passwd')).toThrow();
      expect(() => storage.resolveServePath('p', id, 'a/b.webp')).toThrow();
      expect(() => storage.resolveServePath('p', id, 'evil.sh')).toThrow();
      expect(() => storage.resolveServePath('p', id, '..')).toThrow();
    }
  });

  it('rejects invalid project-slug / id segments', () => {
    expect(() => storage.resolveServePath('../p', SHORT, 'x-1.jpg')).toThrow();
    expect(() => storage.resolveServePath('p', 'a/b', 'x-1.jpg')).toThrow();
  });

  it('confines raw stored paths against traversal + separators (broad extension allowed)', () => {
    for (const id of [SHORT, LEGACY]) {
      expect(() => storage.resolveStoredPath('p', id, '../../etc/passwd')).toThrow();
      expect(() => storage.resolveStoredPath('p', id, 'a/b.pdf')).toThrow();
      expect(() => storage.resolveStoredPath('p', id, '..')).toThrow();
      expect(storage.resolveStoredPath('p', id, 'doc.pdf')).toBeTruthy();
    }
  });

  it('pruneAssetThumbnails never sweeps with an empty keepOriginal; a missing asset returns 0', async () => {
    await storage.storeFile('p', SHORT, 'photo.png', Buffer.from('ORIGINAL'));
    expect(await storage.pruneAssetThumbnails('p', SHORT, '')).toBe(0);
    expect((await storage.readStored('p', SHORT, 'photo.png')).toString()).toBe('ORIGINAL');
    expect(await storage.pruneAssetThumbnails('p', 'zzZZ99', 'x.png')).toBe(0); // missing (flat) asset
    expect(await storage.pruneAssetThumbnails('p', 'missing-legacy-id', 'x.png')).toBe(0);
  });

  it('sanitizes arbitrary upload names into a path-safe stored name', () => {
    expect(MediaStorage.safeStoredName('My Report (final).PDF')).toBe('My-Report-final.pdf');
    // Internal dots collapse (stored names carry exactly one dot, before the extension).
    expect(MediaStorage.safeStoredName('weird..name.tar.gz')).toBe('weird-name-tar.gz');
    expect(MediaStorage.safeStoredName('noext')).toBe('noext.bin');
    expect(MediaStorage.safeStoredName('!!!.zip')).toBe('file.zip');
    // Pathological / unsafe inputs still yield a STORED_FILE-valid name.
    expect(MediaStorage.safeStoredName('../../etc/passwd')).toBe('file.bin');
    expect(/^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/.test(MediaStorage.safeStoredName('.gitignore'))).toBe(true);
  });
});
