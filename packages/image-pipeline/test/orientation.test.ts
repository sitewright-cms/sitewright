import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { readUprightSize, renderPlaceholder } from '../src/orientation.js';

/** A 2×2 GIF89a of two frames (red, then blue). Hand-built: sharp has no animated-GIF encoder. */
const ANIMATED_GIF_2X2_2F = Buffer.from(
  'R0lGODlhAgACAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACAwSAAgAh+QQACgAAACwAAAAAAgACAAACA0ySAgA7',
  'base64',
);

/** `w`×`h` raw pixels carrying an EXIF Orientation tag — what a camera held sideways produces. */
async function tagged(w: number, h: number, orientation: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 200 } } })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer();
}

describe('readUprightSize', () => {
  it('reports the TRANSPOSED size for a 90° tag, and says so', async () => {
    const r = await readUprightSize(await tagged(1600, 900, 6));
    expect(r).toEqual({ orientation: 6, width: 900, height: 1600, transposed: true });
  });

  it('reports the raw size for a mirror-only tag (2 and 4 do not swap the axes)', async () => {
    const r = await readUprightSize(await tagged(1600, 900, 2));
    expect(r).toMatchObject({ orientation: 2, width: 1600, height: 900, transposed: false });
  });

  it('reports `undefined` orientation for an untagged image', async () => {
    const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    const r = await readUprightSize(png);
    expect(r).toMatchObject({ orientation: undefined, width: 400, height: 200, transposed: false });
  });

  it('uses the per-FRAME height of an animated source (which carries no orientation tag)', async () => {
    // libvips reads an animated source as its frames STACKED: this 2×2 two-frame GIF measures 2×4,
    // and only `pageHeight` says a frame is 2 tall. Reporting the stacked height would halve every
    // animated GIF's aspect ratio.
    const r = await readUprightSize(ANIMATED_GIF_2X2_2F);
    expect(r?.width).toBe(2);
    expect(r?.height).toBe(2);
    expect(r?.transposed).toBe(false);
  });

  it('throws rather than guessing when the input is not an image', async () => {
    await expect(readUprightSize(Buffer.from('not an image'))).rejects.toThrow();
  });

  it('never claims a SQUARE image is transposed (both pairs match trivially)', async () => {
    const r = await readUprightSize(await tagged(300, 300, 6));
    expect(r?.transposed).toBe(false);
  });
});

describe('renderPlaceholder', () => {
  it('emits an oriented LQIP data URI', async () => {
    const uri = await renderPlaceholder(await tagged(1600, 900, 6));
    expect(uri.startsWith('data:image/webp;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')).metadata();
    expect(meta.height).toBeGreaterThan(meta.width!); // portrait, matching what a browser paints
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(36); // stays tiny enough to inline
  });
});
