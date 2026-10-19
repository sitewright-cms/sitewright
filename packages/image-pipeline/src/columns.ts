import sharp from 'sharp';

/**
 * Tile several tall, narrow images side by side into ONE image — how a long MOBILE page is shown to a
 * model without either shrinking it to an unreadable sliver or spending one image per screen.
 *
 * A 390px-wide page captured at half scale is a 195px column; a long one is 6,000px of it. Fitted into
 * the 2,000px many-image ceiling it came back 65px wide, and as separate segments it costs one image
 * per ~3,000 CSS px — and a conversation's IMAGE COUNT is capped too, so every image a preview spends is
 * one fewer the session can afford. Read as columns (top of the page on the left), four segments fit in
 * one image at the scale a desktop segment is shown at.
 */

/** The divider between columns: wide enough to read as a break, so columns are not mistaken for one wide page. */
export const COLUMN_GUTTER_PX = 16;
/** Divider colour — a mid grey distinct from typical page backgrounds (white, near-black). */
const GUTTER = { r: 128, g: 128, b: 128 } as const;
const JPEG_QUALITY = 78;

export interface EncodedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** The pixel size of an encoded image. */
export async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/**
 * Place `parts` left to right, top-aligned, {@link COLUMN_GUTTER_PX} apart, on a gutter-coloured canvas
 * as tall as the tallest part (a shorter last column is padded, never stretched). A single part is
 * returned as-is: there is nothing to tile, so nothing is decoded or re-encoded.
 */
export async function composeColumns(parts: readonly Buffer[]): Promise<EncodedImage> {
  if (parts.length === 0) throw new Error('composeColumns needs at least one image');
  const sizes = await Promise.all(parts.map(imageSize));
  if (parts.length === 1) return { buffer: parts[0]!, ...sizes[0]! };
  const height = Math.max(...sizes.map((s) => s.height));
  let left = 0;
  const placed = parts.map((input, i) => {
    const at = { input, left, top: 0 };
    left += sizes[i]!.width + COLUMN_GUTTER_PX;
    return at;
  });
  const width = left - COLUMN_GUTTER_PX;
  const buffer = await sharp({ create: { width, height, channels: 3, background: GUTTER } })
    .composite(placed)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { buffer, width, height };
}
