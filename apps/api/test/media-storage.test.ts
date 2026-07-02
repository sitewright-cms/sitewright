import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStorage } from '../src/media/storage.js';

let root: string;
let storage: MediaStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-media-'));
  storage = new MediaStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('MediaStorage', () => {
  it('stages an upload, then reads/deletes servable files', async () => {
    const { assetDir, inputPath } = await storage.stageUpload('proj1', 'asset1', Buffer.from('raw'));
    expect(assetDir).toContain(join('proj1', 'asset1'));
    // Simulate the pipeline writing a variant, then read it back through the API.
    await writeFile(join(assetDir, 'asset1-800.webp'), Buffer.from('img'));
    await storage.clearUpload(inputPath);
    const bytes = await storage.read('proj1', 'asset1', 'asset1-800.webp');
    expect(bytes.toString()).toBe('img');
    await storage.remove('proj1', 'asset1');
    await expect(storage.read('proj1', 'asset1', 'asset1-800.webp')).rejects.toBeTruthy();
  });

  it('rejects path traversal and invalid file names on serve', () => {
    expect(() => storage.resolveServePath('p', 'a', '../../etc/passwd')).toThrow();
    expect(() => storage.resolveServePath('p', 'a', 'a/b.webp')).toThrow();
    expect(() => storage.resolveServePath('p', 'a', 'evil.sh')).toThrow();
    expect(() => storage.resolveServePath('p', 'a', '..')).toThrow();
  });

  it('rejects invalid id segments', () => {
    expect(() => storage.resolveServePath('../p', 'a', 'asset1-1.jpg')).toThrow();
    expect(() => storage.resolveServePath('p', 'a/b', 'asset1-1.jpg')).toThrow();
  });

  it('accepts a well-formed servable path inside the asset dir', () => {
    const p = storage.resolveServePath('proj1', 'asset1', 'asset1-400.avif');
    expect(p).toContain(join('proj1', 'asset1', 'asset1-400.avif'));
  });

  it('stores and reads a raw (non-image) file', async () => {
    await storage.storeFile('proj1', 'asset2', 'brochure.pdf', Buffer.from('%PDF-1.4'));
    const bytes = await storage.readStored('proj1', 'asset2', 'brochure.pdf');
    expect(bytes.toString()).toBe('%PDF-1.4');
    await storage.remove('proj1', 'asset2');
    await expect(storage.readStored('proj1', 'asset2', 'brochure.pdf')).rejects.toBeTruthy();
  });

  it('confines raw stored paths against traversal + separators', () => {
    expect(() => storage.resolveStoredPath('p', 'a', '../../etc/passwd')).toThrow();
    expect(() => storage.resolveStoredPath('p', 'a', 'a/b.pdf')).toThrow();
    expect(() => storage.resolveStoredPath('p', 'a', '..')).toThrow();
    // A broad extension is allowed for stored files (unlike the strict image serve path).
    expect(storage.resolveStoredPath('p', 'a', 'doc.pdf')).toContain(join('p', 'a', 'doc.pdf'));
  });

  it('prunes derived thumbnails but keeps the retained original', async () => {
    await storage.storeFile('p', 'a', 'photo.png', Buffer.from('ORIGINAL'));
    for (const t of ['photo-sm.webp', 'photo-md.webp', 'photo-xl.webp', 'photo-lg.avif']) {
      await storage.storeFile('p', 'a', t, Buffer.from('thumb'));
    }
    const removed = await storage.pruneAssetThumbnails('p', 'a', 'photo.png');
    expect(removed).toBe(4);
    // The original survives; every derived thumbnail is gone.
    expect((await storage.readStored('p', 'a', 'photo.png')).toString()).toBe('ORIGINAL');
    await expect(storage.readStored('p', 'a', 'photo-xl.webp')).rejects.toBeTruthy();
    // Idempotent: a second prune removes nothing; a missing asset dir returns 0.
    expect(await storage.pruneAssetThumbnails('p', 'a', 'photo.png')).toBe(0);
    expect(await storage.pruneAssetThumbnails('p', 'missing', 'x.png')).toBe(0);
    // Safety: an empty/undefined keepOriginal NEVER sweeps (else it would delete the original too).
    expect(await storage.pruneAssetThumbnails('p', 'a', '')).toBe(0);
    expect((await storage.readStored('p', 'a', 'photo.png')).toString()).toBe('ORIGINAL');
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
