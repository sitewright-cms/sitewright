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
});
