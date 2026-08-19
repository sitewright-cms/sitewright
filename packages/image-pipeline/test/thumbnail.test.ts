import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { generateThumbnail, pngToLosslessWebp } from '../src/thumbnail.js';

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
    // libvips reports AVIF as the HEIF container format (sharp 0.35's metadata format union no longer
    // lists 'avif', so match against both rather than a === that the types flag as impossible).
    expect(['heif', 'avif']).toContain(meta.format);
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

  // A phone photographed in portrait stores LANDSCAPE pixels plus an EXIF orientation tag; every
  // browser applies that tag, so the ORIGINAL looks upright. sharp does not apply it unless asked,
  // and it strips metadata on encode — so an unrotated thumbnail is both sideways AND has lost the
  // tag that would have let the browser fix it. Result: the original is upright and every derived
  // size is on its side.
  describe('EXIF orientation', () => {
    for (const [orientation, label] of [
      [6, 'rotate 90° CW'],
      [8, 'rotate 90° CCW'],
    ] as const) {
      it(`applies orientation ${orientation} (${label}) — dimensions swap`, async () => {
        const src = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 20, g: 120, b: 200 } } })
          .jpeg()
          .withMetadata({ orientation })
          .toBuffer();
        const r = await generateThumbnail(src, { width: 500 });
        expect(r.width).toBe(500);
        expect(r.height).toBe(889); // round(500 * 1600/900) — the UPRIGHT aspect, not 281
        const meta = await sharp(r.buffer).metadata();
        expect(meta.width).toBe(500);
        expect(meta.height).toBe(889);
      });
    }

    it('rotates the PIXELS, not just the reported size', async () => {
      // Left half red, right half blue. Under orientation 6 (90° CW) the left edge becomes the TOP,
      // so an upright render is red-on-top. A dimension check alone would pass on a mere transpose.
      const src = await sharp({
        create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .composite([
          {
            input: await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer(),
            left: 200,
            top: 0,
          },
        ])
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();
      const r = await generateThumbnail(src, { width: 100 });
      const { data, info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
      const px = (x: number, y: number): [number, number, number] => {
        const i = (y * info.width + x) * info.channels;
        return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      };
      const [tr, , tb] = px(Math.floor(info.width / 2), Math.floor(info.height * 0.15));
      const [br, , bb] = px(Math.floor(info.width / 2), Math.floor(info.height * 0.85));
      expect(tr).toBeGreaterThan(tb); // top is red
      expect(bb).toBeGreaterThan(br); // bottom is blue
    });

    it('leaves an upright image (orientation 1) untouched', async () => {
      const src = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 20, g: 120, b: 200 } } })
        .jpeg()
        .withMetadata({ orientation: 1 })
        .toBuffer();
      const r = await generateThumbnail(src, { width: 500 });
      expect(r.width).toBe(500);
      expect(r.height).toBe(281);
    });
  });
});

describe('pngToLosslessWebp', () => {
  it('transcodes a screenshot PNG to a lossless WebP, preserving dimensions', async () => {
    const png = await sharp({ create: { width: 120, height: 40, channels: 3, background: { r: 2, g: 139, b: 192 } } }).png().toBuffer();
    const r = await pngToLosslessWebp(png);
    expect(r.width).toBe(120);
    expect(r.height).toBe(40);
    // RIFF/WEBP container magic
    expect(r.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(r.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const meta = await sharp(r.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(120);
  });
});
