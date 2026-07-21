import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStorage } from '../src/media/storage.js';

let root: string;
let storage: MediaStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-storage-export-'));
  storage = new MediaStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('MediaStorage.assetFilePaths — legacy (foldered) layout', () => {
  const ID = 'legacy-asset-0001'; // not a 6-char base62 id → per-asset folder

  it('enumerates nested files (forward-slash rel), skipping .upload inputs', async () => {
    const dir = join(root, 'site', ID);
    await mkdir(join(dir, 'file'), { recursive: true });
    await writeFile(join(dir, 'original-800.webp'), 'a');
    await writeFile(join(dir, 'file', 'doc.pdf'), 'b');
    await writeFile(join(dir, `${ID}.upload`), 'transient'); // must be excluded

    const files = await storage.assetFilePaths('site', ID);
    expect(files.map((f) => f.rel).sort()).toEqual(['file/doc.pdf', 'original-800.webp']);
    expect(files.every((f) => f.abs.startsWith(dir))).toBe(true);
  });

  it('returns [] when the asset has no on-disk directory (ENOENT)', async () => {
    expect(await storage.assetFilePaths('site', 'ghost-legacy-id')).toEqual([]);
  });

  it('returns [] when the asset path is not a directory (ENOTDIR)', async () => {
    await mkdir(join(root, 'site'), { recursive: true });
    await writeFile(join(root, 'site', ID), 'not a dir');
    expect(await storage.assetFilePaths('site', ID)).toEqual([]);
  });

  it('omits top-level skipNames (thumbnail cache) but keeps the original + nested files', async () => {
    const dir = join(root, 'site', ID);
    await mkdir(join(dir, 'file'), { recursive: true });
    await writeFile(join(dir, 'photo.png'), 'orig'); // retained original → keep
    await writeFile(join(dir, 'photo-sm.webp'), 't1'); // top-level derived thumbnail → skip
    await writeFile(join(dir, 'photo-xl.avif'), 't2'); // top-level derived thumbnail → skip
    await writeFile(join(dir, 'file', 'photo.png'), 'raw'); // nested → keep
    // A NESTED file whose basename collides with a skip name must still be kept (depth-0-only skip).
    await writeFile(join(dir, 'file', 'photo-sm.webp'), 'nested');

    const skip = new Set(['photo-sm.webp', 'photo-xl.avif']);
    const rels = (await storage.assetFilePaths('site', ID, skip)).map((f) => f.rel).sort();
    expect(rels).toEqual(['file/photo-sm.webp', 'file/photo.png', 'photo.png']);
  });
});

describe('MediaStorage.assetFilePaths — flat (short id) layout', () => {
  const ID = 'a1B2c3';

  it('enumerates <id>-* files as LOGICAL names, skipping .upload + sibling assets', async () => {
    await storage.storeFile('site', ID, 'photo.png', Buffer.from('orig'));
    await storage.storeFile('site', ID, 'photo-sm.webp', Buffer.from('t1'));
    await writeFile(join(root, 'site', `${ID}.upload`), 'transient'); // must be excluded
    await storage.storeFile('site', 'z9Y8x7', 'other.png', Buffer.from('sibling')); // a DIFFERENT asset

    const rels = (await storage.assetFilePaths('site', ID)).map((f) => f.rel).sort();
    expect(rels).toEqual(['photo-sm.webp', 'photo.png']);
  });

  it('omits top-level skipNames (thumbnail cache), keeping the original', async () => {
    await storage.storeFile('site', ID, 'photo.png', Buffer.from('orig'));
    await storage.storeFile('site', ID, 'photo-sm.webp', Buffer.from('t1'));
    await storage.storeFile('site', ID, 'photo-xl.avif', Buffer.from('t2'));
    const rels = (await storage.assetFilePaths('site', ID, new Set(['photo-sm.webp', 'photo-xl.avif']))).map((f) => f.rel).sort();
    expect(rels).toEqual(['photo.png']);
  });

  it('returns [] for a flat asset with no files', async () => {
    expect(await storage.assetFilePaths('site', 'zzZZ99')).toEqual([]);
  });
});

describe('MediaStorage.assetFilePaths — guards', () => {
  it('rejects an invalid slug/asset segment before touching disk', async () => {
    await expect(storage.assetFilePaths('../evil', 'a1B2c3')).rejects.toThrow();
  });
});
