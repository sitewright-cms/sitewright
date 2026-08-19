import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { readUprightSize, renderPlaceholder, rotateImage } from '../src/orientation.js';

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

describe('rotateImage', () => {
  /** 400×200: left half red, right half blue — so a rotation is checkable from the PIXELS. */
  async function halves(): Promise<Buffer> {
    return sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .composite([
        {
          input: await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer(),
          left: 200,
          top: 0,
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  const sample = async (buf: Buffer, fx: number, fy: number) => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const i = (Math.floor(info.height * fy) * info.width + Math.floor(info.width * fx)) * info.channels;
    return { r: data[i]!, b: data[i + 2]! };
  };

  it('turns 90° clockwise: the LEFT edge becomes the TOP, and the dimensions transpose', async () => {
    const r = await rotateImage(await halves(), 90);
    expect(r.width).toBe(200);
    expect(r.height).toBe(400);
    const top = await sample(r.buffer, 0.5, 0.15);
    const bottom = await sample(r.buffer, 0.5, 0.85);
    expect(top.r).toBeGreaterThan(top.b);
    expect(bottom.b).toBeGreaterThan(bottom.r);
  });

  it('turns 270° the other way', async () => {
    const r = await rotateImage(await halves(), 270);
    expect(r.width).toBe(200);
    expect(r.height).toBe(400);
    const top = await sample(r.buffer, 0.5, 0.15);
    expect(top.b).toBeGreaterThan(top.r); // the RIGHT edge is now the top
  });

  it('180° keeps the dimensions and swaps the sides', async () => {
    const r = await rotateImage(await halves(), 180);
    expect(r.width).toBe(400);
    expect(r.height).toBe(200);
    const left = await sample(r.buffer, 0.15, 0.5);
    expect(left.b).toBeGreaterThan(left.r);
  });

  it('normalises an EXIF-tagged source at the same time, and leaves NO tag behind', async () => {
    // Tagged `6` (a browser paints it turned 90° CW already) and then asked for another 90°: the two
    // must COMPOSE, and the output must carry no orientation of its own — a stale tag would make every
    // future reader turn it a third time.
    const src = await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 10, g: 90, b: 180 } } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const r = await rotateImage(src, 90);
    expect(r.width).toBe(400); // upright 200×400, turned 90° → 400×200
    expect(r.height).toBe(200);
    const meta = await sharp(r.buffer).metadata();
    expect(meta.orientation).toBeUndefined();
  });

  it('keeps the source format (a JPEG stays a JPEG, a PNG stays a PNG with its alpha)', async () => {
    expect((await rotateImage(await halves(), 90)).format).toBe('jpeg');
    const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = await rotateImage(png, 90);
    expect(r.format).toBe('png');
    expect((await sharp(r.buffer).metadata()).hasAlpha).toBe(true);
  });

  it('rejects a turn that is not a quarter, and an animated source', async () => {
    await expect(rotateImage(await halves(), 45 as unknown as 90)).rejects.toThrow(/90, 180 or 270/);
    await expect(rotateImage(ANIMATED_GIF_2X2_2F, 90)).rejects.toThrow(/animated/);
  });
});
