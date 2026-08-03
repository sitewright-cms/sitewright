import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  MODEL_IMAGE_MAX_EDGE,
  exceedsModelImageLimit,
  clampedImageSize,
  clampImageForModel,
} from '../src/model-image.js';

const jpeg = (w: number, h: number): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#4477aa' } }).jpeg().toBuffer();

describe('exceedsModelImageLimit', () => {
  it('measures the LONGEST edge, either axis', () => {
    expect(exceedsModelImageLimit(1920, 1080)).toBe(false);
    expect(exceedsModelImageLimit(1920, 8000)).toBe(true); // a full-page capture — the common case
    expect(exceedsModelImageLimit(2560, 1440)).toBe(true); // the widest breakpoint is over on WIDTH alone
    expect(exceedsModelImageLimit(2000, 2000)).toBe(false); // exactly at the cap is allowed
  });
});

describe('clampedImageSize', () => {
  it('leaves an in-limit size alone', () => {
    expect(clampedImageSize(1440, 900)).toEqual({ width: 1440, height: 900 });
  });

  it('preserves aspect ratio and puts the long edge exactly at the cap', () => {
    const s = clampedImageSize(1920, 8000);
    expect(s.height).toBe(MODEL_IMAGE_MAX_EDGE);
    expect(s.width / s.height).toBeCloseTo(1920 / 8000, 3);
  });

  it('clamps on width when the image is wide', () => {
    expect(clampedImageSize(2560, 1440)).toEqual({ width: 2000, height: Math.round(1440 * (2000 / 2560)) });
  });

  it('never rounds the short edge to zero on an extreme aspect ratio', () => {
    // sharp rejects a zero dimension, which would turn a degraded image into NO image.
    expect(clampedImageSize(390, 12000).width).toBeGreaterThanOrEqual(1);
    expect(clampedImageSize(10, 40000).width).toBeGreaterThanOrEqual(1);
  });
});

describe('clampImageForModel', () => {
  it('returns null when nothing needs doing (caller keeps the original bytes)', async () => {
    expect(await clampImageForModel(await jpeg(1440, 900), 1440, 900)).toBeNull();
  });

  it('re-encodes an oversized image, and the BYTES match the reported size', async () => {
    const out = await clampImageForModel(await jpeg(2400, 3000), 2400, 3000);
    expect(out).not.toBeNull();
    expect(out!.height).toBe(MODEL_IMAGE_MAX_EDGE);
    const meta = await sharp(out!.buffer).metadata();
    expect(meta.width).toBe(out!.width);
    expect(meta.height).toBe(out!.height);
    expect(exceedsModelImageLimit(out!.width, out!.height)).toBe(false);
  });

  it('shrinks the payload as well as the dimensions', async () => {
    const src = await jpeg(2400, 4000);
    const out = await clampImageForModel(src, 2400, 4000);
    expect(out!.buffer.length).toBeLessThan(src.length);
  });

  it('returns null rather than throwing on unreadable bytes', async () => {
    // A too-large image is a PROBABLE rejection; a thrown error is a CERTAIN one.
    expect(await clampImageForModel(Buffer.from('not-an-image'), 5000, 5000)).toBeNull();
  });
});

describe('every image an agent receives is inside the model dimension limit', () => {
  it('clamps a REGION crop, which is captured at 2x and was the path that killed two agents', async () => {
    // The region crop caps height at 1500 CSS px — a PAYLOAD bound, which is a different constraint
    // from the model's DIMENSION ceiling and the only one the original code had in mind. At
    // deviceScaleFactor 2 that crop is 3000 physical px, and a full-width crop at the 1440 viewport is
    // 2880. Both exceed 2000, and exceeding it does not degrade the response: it rejects the whole
    // request and ends the session. Run 4 lost an agent at turn 124; run 5 lost another at turn 119 —
    // the second one AFTER a fix that only ever covered `captureUrlShots`.
    const png = await sharp({
      create: { width: 2880, height: 3000, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();
    const webp = await sharp(png).webp({ lossless: true }).toBuffer();

    const out = await clampImageForModel(webp, 2880, 3000, { format: 'webp' });
    expect(out, 'an over-limit crop must come back resized, not untouched').not.toBeNull();
    expect(Math.max(out!.width, out!.height)).toBeLessThanOrEqual(MODEL_IMAGE_MAX_EDGE);
    // Region crops are lossless WebP and must STAY WebP: re-encoding a UI crop as JPEG puts ringing on
    // exactly the hairlines and text edges the crop exists to let an agent judge.
    const meta = await sharp(out!.buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('leaves an already-small crop alone', async () => {
    const webp = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).webp().toBuffer();
    expect(await clampImageForModel(webp, 800, 600, { format: 'webp' })).toBeNull();
  });
});
