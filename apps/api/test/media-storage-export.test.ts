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

describe('MediaStorage.assetFilePaths', () => {
  it('enumerates nested files (forward-slash rel), skipping .upload inputs', async () => {
    const dir = join(root, 'site', 'asset1');
    await mkdir(join(dir, 'file'), { recursive: true });
    await writeFile(join(dir, 'original-800.webp'), 'a');
    await writeFile(join(dir, 'file', 'doc.pdf'), 'b');
    await writeFile(join(dir, 'asset1.upload'), 'transient'); // must be excluded

    const files = await storage.assetFilePaths('site', 'asset1');
    const rels = files.map((f) => f.rel).sort();
    expect(rels).toEqual(['file/doc.pdf', 'original-800.webp']);
    // abs paths point at the real on-disk files.
    expect(files.every((f) => f.abs.startsWith(dir))).toBe(true);
  });

  it('returns [] when the asset has no on-disk directory (ENOENT)', async () => {
    expect(await storage.assetFilePaths('site', 'ghost')).toEqual([]);
  });

  it('returns [] when the asset path is not a directory (ENOTDIR)', async () => {
    await mkdir(join(root, 'site'), { recursive: true });
    await writeFile(join(root, 'site', 'asset1'), 'not a dir');
    expect(await storage.assetFilePaths('site', 'asset1')).toEqual([]);
  });

  it('rejects an invalid slug/asset segment before touching disk', async () => {
    await expect(storage.assetFilePaths('../evil', 'asset1')).rejects.toThrow();
  });

  it('omits top-level skipNames (thumbnail cache) but keeps the original + nested files', async () => {
    const dir = join(root, 'site', 'img1');
    await mkdir(join(dir, 'file'), { recursive: true });
    await writeFile(join(dir, 'photo.png'), 'orig'); // retained original → keep
    await writeFile(join(dir, 'photo-sm.webp'), 't1'); // top-level derived thumbnail → skip
    await writeFile(join(dir, 'photo-xl.avif'), 't2'); // top-level derived thumbnail → skip
    await writeFile(join(dir, 'file', 'photo.png'), 'raw'); // nested → keep
    // A NESTED file whose basename collides with a skip name must still be kept (depth-0-only skip).
    await writeFile(join(dir, 'file', 'photo-sm.webp'), 'nested');

    const skip = new Set(['photo-sm.webp', 'photo-xl.avif']);
    const rels = (await storage.assetFilePaths('site', 'img1', skip)).map((f) => f.rel).sort();
    expect(rels).toEqual(['file/photo-sm.webp', 'file/photo.png', 'photo.png']);
  });

  it('without skipNames enumerates everything (unchanged back-compat)', async () => {
    const dir = join(root, 'site', 'img2');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'photo.png'), 'orig');
    await writeFile(join(dir, 'photo-sm.webp'), 't1');
    const rels = (await storage.assetFilePaths('site', 'img2')).map((f) => f.rel).sort();
    expect(rels).toEqual(['photo-sm.webp', 'photo.png']);
  });
});
