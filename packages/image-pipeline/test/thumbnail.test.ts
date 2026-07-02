import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { generateThumbnail } from '../src/thumbnail.js';

let landscape: Buffer = Buffer.alloc(0); // 1600x900 opaque
let small: Buffer = Buffer.alloc(0); // 800x600 opaque
let alpha: Buffer = Buffer.alloc(0); // 600x400 with transparency

beforeAll(async () => {
  landscape = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 20, g: 120, b: 200 } } })
    .png()
    .toBuffer();
  small = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer();
  alpha = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
});

describe('generateThumbnail', () => {
  it('encodes a WebP at the requested width, aspect-preserved', async () => {
    const r = await generateThumbnail(landscape, { width: 500 });
    expect(r.format).toBe('webp');
    expect(r.width).toBe(500);
    expect(r.height).toBe(281); // round(500 * 900/1600)
    const meta = await sharp(r.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(500);
  });

  it('encodes AVIF when asked', async () => {
    const r = await generateThumbnail(landscape, { width: 800, format: 'avif' });
    expect(r.format).toBe('avif');
    expect(r.width).toBe(800);
    const meta = await sharp(r.buffer).metadata();
    // libvips reports AVIF as the HEIF container format.
    expect(meta.format === 'heif' || meta.format === 'avif').toBe(true);
    expect(meta.width).toBe(800);
  });

  it('NEVER upscales beyond the source width (xl of a small image clamps to source)', async () => {
    const r = await generateThumbnail(small, { width: 2400 });
    expect(r.width).toBe(800);
    const meta = await sharp(r.buffer).metadata();
    expect(meta.width).toBe(800);
  });

  it('preserves transparency in the WebP output', async () => {
    const r = await generateThumbnail(alpha, { width: 300 });
    const meta = await sharp(r.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('rejects invalid width and quality', async () => {
    await expect(generateThumbnail(landscape, { width: 0 })).rejects.toThrow(/width/);
    await expect(generateThumbnail(landscape, { width: 500, quality: 0 })).rejects.toThrow(/quality/);
  });
});
