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
});
