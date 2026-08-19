import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { transformImage } from '../src/transform.js';

/**
 * The image EDIT pipeline: turning a picture and cutting a rectangle out of it.
 *
 * The API-level tests drive this through the HTTP route, which is the right place to prove the two
 * SAVE destinations behave differently. This file covers what that cannot reach cheaply: the refusal
 * paths, and the exact geometry each operation produces.
 */

/** `w`×`h` of a flat colour, as a PNG. */
async function png(w: number, h: number, rgb: { r: number; g: number; b: number } = { r: 20, g: 120, b: 200 }): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();
}

/** A 2×2 GIF89a of two frames (red, then blue) — sharp has no animated-GIF encoder, so it is literal. */
const ANIMATED_GIF_2X2_2F = Buffer.from(
  'R0lGODlhAgACAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACAwSAAgAh+QQACgAAACwAAAAAAgACAAACA0ySAgA7',
  'base64',
);

/** A 4×2 PNG: left half red, right half green. Enough to tell WHICH pixels a crop kept. */
async function halves(): Promise<Buffer> {
  const red = { r: 255, g: 0, b: 0 };
  const green = { r: 0, g: 192, b: 0 };
  return sharp({ create: { width: 4, height: 2, channels: 3, background: red } })
    .composite([{ input: await sharp({ create: { width: 2, height: 2, channels: 3, background: green } }).png().toBuffer(), left: 2, top: 0 }])
    .png()
    .toBuffer();
}

/** The RGB of the pixel at (x, y). */
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

describe('transformImage — geometry', () => {
  it('a quarter-turn transposes the dimensions; a half-turn does not', async () => {
    expect(await transformImage(await png(40, 20), { rotate: 90 })).toMatchObject({ width: 20, height: 40 });
    expect(await transformImage(await png(40, 20), { rotate: 270 })).toMatchObject({ width: 20, height: 40 });
    expect(await transformImage(await png(40, 20), { rotate: 180 })).toMatchObject({ width: 40, height: 20 });
  });

  it('a crop yields exactly the requested box', async () => {
    const out = await transformImage(await png(40, 20), { crop: { left: 5, top: 5, width: 10, height: 10 } });
    expect(out).toMatchObject({ width: 10, height: 10 });
  });

  it('★ ROTATE happens FIRST — the crop is measured against the turned image', async () => {
    // 4×2 (red | green) turned a quarter clockwise is 2×4 with RED on top and GREEN below. Cropping
    // the bottom half must therefore give green. If the crop ran first it would be out of bounds on
    // the un-turned image, or on a larger source it would cut the wrong region entirely.
    const out = await transformImage(await halves(), { rotate: 90, crop: { left: 0, top: 2, width: 2, height: 2 } });
    expect(out).toMatchObject({ width: 2, height: 2 });
    const [r, g] = await pixel(out.buffer, 1, 1);
    expect(g).toBeGreaterThan(140);
    expect(r).toBeLessThan(90);
  });

  it('a crop with no rotation keeps the region it names', async () => {
    const out = await transformImage(await halves(), { crop: { left: 2, top: 0, width: 2, height: 2 } });
    const [r, g] = await pixel(out.buffer, 1, 1);
    expect(g).toBeGreaterThan(140);
    expect(r).toBeLessThan(90);
  });
});

describe('transformImage — format', () => {
  it('keeps the source format by default, and honours an explicit one', async () => {
    expect(await transformImage(await png(20, 10), { rotate: 90 })).toMatchObject({ format: 'png' });
    expect(await transformImage(await png(20, 10), { rotate: 90, format: 'webp' })).toMatchObject({ format: 'webp' });
    expect(await transformImage(await png(20, 10), { rotate: 90, format: 'jpeg' })).toMatchObject({ format: 'jpeg' });
  });

  it('falls back to webp for a source format it cannot re-encode in kind', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).gif().toBuffer();
    expect(await transformImage(gif, { rotate: 90 })).toMatchObject({ format: 'webp' });
  });

  it('a format change ALONE is a valid operation (a re-encode with no geometry change)', async () => {
    const out = await transformImage(await png(20, 10), { format: 'webp' });
    expect(out).toMatchObject({ width: 20, height: 10, format: 'webp' });
  });
});

describe('transformImage — what it refuses, and why', () => {
  it('refuses a call with no operation at all', async () => {
    await expect(transformImage(await png(10, 10), {})).rejects.toThrow(/no image operation/);
  });

  it('refuses a rotation that is not a quarter turn', async () => {
    await expect(transformImage(await png(10, 10), { rotate: 45 as 90 })).rejects.toThrow(/must be 90, 180 or 270/);
  });

  it('refuses an ANIMATED source rather than silently flattening it to frame one', async () => {
    await expect(transformImage(ANIMATED_GIF_2X2_2F, { rotate: 90 })).rejects.toThrow(/animated/);
  });

  it('refuses a fractional or negative crop — a box arrives from a browser and is not trusted', async () => {
    const src = await png(40, 20);
    await expect(transformImage(src, { crop: { left: 0.5, top: 0, width: 10, height: 10 } })).rejects.toThrow(/whole, non-negative/);
    await expect(transformImage(src, { crop: { left: -1, top: 0, width: 10, height: 10 } })).rejects.toThrow(/whole, non-negative/);
  });

  it('refuses an EMPTY crop', async () => {
    await expect(transformImage(await png(40, 20), { crop: { left: 0, top: 0, width: 0, height: 5 } })).rejects.toThrow(/must not be empty/);
    await expect(transformImage(await png(40, 20), { crop: { left: 0, top: 0, width: 5, height: 0 } })).rejects.toThrow(/must not be empty/);
  });

  it('★ refuses an out-of-bounds crop and NAMES the size it was measured against', async () => {
    // sharp's own error for this is a bare "extract_area" that says nothing about which edge was
    // wrong. The size in the message is the whole point: it tells the caller what the box had to fit.
    await expect(transformImage(await png(40, 20), { crop: { left: 0, top: 0, width: 999, height: 10 } })).rejects.toThrow(
      /outside the image \(40×20/,
    );
    await expect(transformImage(await png(40, 20), { crop: { left: 35, top: 0, width: 10, height: 10 } })).rejects.toThrow(/outside the image/);
  });

  it('★ bounds a crop against the ROTATED size, so a legal box is not rejected', async () => {
    // 40×20 turned is 20×40. A 20×40 crop is the whole turned image and must be ACCEPTED; measured
    // against the un-turned 40×20 it would look 20px too tall.
    await expect(transformImage(await png(40, 20), { rotate: 90, crop: { left: 0, top: 0, width: 20, height: 40 } })).resolves.toMatchObject({
      width: 20,
      height: 40,
    });
    // …and the same box without the rotation is correctly refused.
    await expect(transformImage(await png(40, 20), { crop: { left: 0, top: 0, width: 20, height: 40 } })).rejects.toThrow(/outside the image/);
  });

  it('★ measures an EXIF-tagged source by how it DISPLAYS, not how it is stored', async () => {
    // A sideways-tagged photo stores 40×20 but every viewer paints it 20×40. A crop box drawn over
    // what the author sees must be validated against that, or a legitimate selection is refused.
    const tagged = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await expect(transformImage(tagged, { crop: { left: 0, top: 0, width: 20, height: 40 } })).resolves.toMatchObject({ width: 20, height: 40 });
  });
});
