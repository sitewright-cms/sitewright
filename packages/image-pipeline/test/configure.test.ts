import { describe, it, expect, afterAll } from 'vitest';
import sharp from 'sharp';
import { configureImagePipeline, imagePipelineLimitsFor } from '../src/configure.js';

const GIB = 1024 ** 3;

/**
 * libvips keeps its own operation cache, and nothing configured it: measured on a running container
 * it sat at the stock `{memory: 50, files: 20, items: 100}` and held that memory AFTER image work
 * finished. On a small container that is a permanent slice of the budget bought for a speed-up that
 * mostly helps repeated work on the SAME source image — which is not this workload, where a variant
 * is generated once and then served from the on-disk thumbnail cache.
 */
describe('imagePipelineLimitsFor', () => {
  it('disables the cache entirely on a small container', () => {
    expect(imagePipelineLimitsFor(512 * 1024 * 1024).cacheMb).toBe(0);
  });

  it('keeps a small cache in the mid range', () => {
    expect(imagePipelineLimitsFor(2 * GIB).cacheMb).toBe(16);
  });

  it('allows a larger cache on a roomy instance — but never the stock 50MB', () => {
    const roomy = imagePipelineLimitsFor(8 * GIB).cacheMb;
    expect(roomy).toBe(32);
    expect(roomy, 'the default we are overriding').toBeLessThan(50);
  });

  it('scales monotonically with the ceiling', () => {
    const sizes = [256 * 1024 * 1024, 1 * GIB, 4 * GIB].map((b) => imagePipelineLimitsFor(b).cacheMb);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});

describe('configureImagePipeline', () => {
  it('applies a bounded cache to sharp', () => {
    configureImagePipeline({ cacheMb: 16 });
    const cache = sharp.cache();
    expect(cache.memory.max).toBe(16);
    expect(cache.files.max).toBe(8);
    expect(cache.items.max).toBe(50);
  });

  it('turns the cache OFF at zero rather than setting a zero-sized one', () => {
    configureImagePipeline({ cacheMb: 0 });
    // sharp.cache(false) reports 0 for every dimension — nothing is retained between operations.
    expect(sharp.cache().memory.max).toBe(0);
  });

  it('is idempotent — calling it twice leaves the same limits', () => {
    configureImagePipeline({ cacheMb: 32 });
    const first = sharp.cache();
    configureImagePipeline({ cacheMb: 32 });
    expect(sharp.cache().memory.max).toBe(first.memory.max);
  });
});

afterAll(() => {
  // Leave sharp as we found it, so a cache this suite shrank cannot slow or skew another suite in
  // the same process.
  sharp.cache({ memory: 50, files: 20, items: 100 });
});

describe('generateThumbnail from a PATH', () => {
  it('produces the same image whether given bytes or a file path', async () => {
    // The path form is what keeps a source image (up to 50MB) out of the heap while serving a
    // variant — sharp reads it itself. It must be equivalent, not merely "also work".
    const { generateThumbnail } = await import('../src/thumbnail.js');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // A real 4x4 PNG, so sharp has something with actual dimensions to resize.
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();

    const dir = await mkdtemp(join(tmpdir(), 'thumb-'));
    const file = join(dir, 'src.png');
    try {
      await writeFile(file, png);
      const fromBuffer = await generateThumbnail(png, { width: 2 });
      const fromPath = await generateThumbnail(file, { width: 2 });
      expect(fromPath.buffer.length).toBe(fromBuffer.buffer.length);
      expect(fromPath.width).toBe(fromBuffer.width);
      expect(fromPath.height).toBe(fromBuffer.height);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws on a missing path, the way a bad buffer would', async () => {
    const { generateThumbnail } = await import('../src/thumbnail.js');
    await expect(generateThumbnail('/nonexistent/nope.png', { width: 2 })).rejects.toThrow();
  });
});
