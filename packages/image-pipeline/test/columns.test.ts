import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { composeColumns, imageSize, COLUMN_GUTTER_PX } from '../src/columns.js';

/** A solid JPEG of the given size and colour. */
const solid = (width: number, height: number, r: number, g: number, b: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).jpeg({ quality: 90 }).toBuffer();

/** The RGB at (x, y) of an encoded image. */
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

const near = (got: [number, number, number], want: [number, number, number]): boolean => got.every((v, i) => Math.abs(v - want[i]!) <= 12);

describe('composeColumns', () => {
  it('lays the parts out left to right with a gutter between them, top-aligned', async () => {
    const parts = [await solid(100, 300, 255, 0, 0), await solid(100, 300, 0, 0, 255), await solid(100, 120, 0, 160, 0)];
    const out = await composeColumns(parts);
    expect(out.width).toBe(3 * 100 + 2 * COLUMN_GUTTER_PX);
    expect(out.height).toBe(300); // the tallest column; a short last one is padded, never stretched
    expect(await imageSize(out.buffer)).toEqual({ width: out.width, height: out.height });
    expect(near(await pixel(out.buffer, 50, 150), [255, 0, 0])).toBe(true);
    expect(near(await pixel(out.buffer, 100 + COLUMN_GUTTER_PX + 50, 150), [0, 0, 255])).toBe(true);
    // The gutter is a visible divider, so the model reads three columns rather than one wide page.
    const gutter = await pixel(out.buffer, 100 + COLUMN_GUTTER_PX / 2, 150);
    expect(near(gutter, [255, 0, 0]) || near(gutter, [0, 0, 255])).toBe(false);
    // Below the short third column: padding, not its content.
    expect(near(await pixel(out.buffer, 2 * (100 + COLUMN_GUTTER_PX) + 50, 250), [0, 160, 0])).toBe(false);
    expect(near(await pixel(out.buffer, 2 * (100 + COLUMN_GUTTER_PX) + 50, 60), [0, 160, 0])).toBe(true);
  });

  it('hands a single part back untouched — nothing to tile, nothing to re-encode', async () => {
    const one = await solid(80, 90, 10, 20, 30);
    const out = await composeColumns([one]);
    expect(out.buffer).toBe(one);
    expect(out).toMatchObject({ width: 80, height: 90 });
  });

  it('refuses an empty list', async () => {
    await expect(composeColumns([])).rejects.toThrow(/at least one/);
  });
});
