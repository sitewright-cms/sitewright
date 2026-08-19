import sharp, { type Metadata } from 'sharp';
import { MAX_INPUT_PIXELS, type QuarterTurn } from './orientation.js';

/**
 * Editing an image's PIXELS: turning it, and cutting a rectangle out of it.
 *
 * This generalises what {@link rotateImage} did alone. Rotation arrived first, for a specific defect
 * (photographs whose EXIF tag had been stripped), and was written as a one-operation function. Crop
 * needs the same surrounding machinery — decode once, refuse the cases sharp cannot honour, re-encode
 * in a format that does not change what the file IS — so the shape is now "a list of operations"
 * rather than a second near-copy of the first.
 */

/** A rectangle to keep, in the pixel coordinates of the image AFTER any rotation in the same call. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageTransform {
  /** Clockwise quarter-turn, applied FIRST. */
  rotate?: QuarterTurn;
  /**
   * Rectangle to keep, applied AFTER the rotation.
   *
   * ★ The order is fixed and it matters: a crop box drawn in an editor is in the coordinates of the
   * image the author is LOOKING at, which is the rotated one. Applying the crop first would cut a
   * different region for every turn, so an editor that rotated and then dragged a box would save
   * something the author never selected.
   */
  crop?: CropRect;
  /** Re-encode as this format instead of the source's. `webp` is what the image editor exports. */
  format?: TransformFormat;
}

export type TransformFormat = 'jpeg' | 'png' | 'webp' | 'tiff';

export interface TransformedImage {
  buffer: Buffer;
  width: number;
  height: number;
  /** The format actually written. */
  format: TransformFormat;
}

/** Formats we can re-encode into without changing what the file IS. Anything else becomes webp. */
const REENCODE: Record<string, TransformFormat> = {
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
  tiff: 'tiff',
};

/** Integer, non-negative, finite — a crop box arrives from a browser and is not to be trusted. */
function isWholePixel(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Apply an edit to an image and re-encode it.
 *
 * Refuses rather than guesses:
 *  · an ANIMATED source (sharp would silently flatten it to its first frame),
 *  · a crop that is empty or reaches outside the image (sharp throws a bare "extract_area" error,
 *    which tells an author nothing about which edge was wrong),
 *  · a no-op call with no operations at all.
 *
 * Applied on top of any EXIF orientation (`autoOrient`), so a tagged image is normalised at the same
 * time and the result never depends on the tag again. Metadata is deliberately NOT carried over —
 * keeping a now-wrong Orientation tag would make every future reader turn the pixels a second time.
 */
export async function transformImage(input: Buffer | string, ops: ImageTransform): Promise<TransformedImage> {
  const { rotate, crop, format } = ops;
  if (rotate === undefined && crop === undefined && format === undefined) {
    throw new Error('no image operation requested');
  }
  if (rotate !== undefined && rotate !== 90 && rotate !== 180 && rotate !== 270) {
    throw new Error('invalid rotation: must be 90, 180 or 270');
  }

  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if ((meta.pages ?? 1) > 1) throw new Error('cannot edit an animated image');

  // The size the crop box is measured against: the ORIENTED image, turned by `rotate`. `autoOrient`
  // means an EXIF-tagged source is already upright here, so this is what the author sees.
  const oriented = orientedSize(meta);
  const turned = rotate === 90 || rotate === 270 ? { width: oriented.height, height: oriented.width } : oriented;

  if (crop) {
    if (![crop.left, crop.top, crop.width, crop.height].every(isWholePixel)) {
      throw new Error('crop must be whole, non-negative pixels');
    }
    if (crop.width === 0 || crop.height === 0) throw new Error('crop must not be empty');
    if (turned.width > 0 && turned.height > 0) {
      if (crop.left + crop.width > turned.width || crop.top + crop.height > turned.height) {
        throw new Error(`crop is outside the image (${turned.width}×${turned.height} after rotation)`);
      }
    }
  }

  const target: TransformFormat = format ?? REENCODE[meta.format ?? ''] ?? 'webp';
  let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
  if (rotate !== undefined) pipeline = pipeline.rotate(rotate);
  // extract() after rotate() operates on the rotated raster — the order the interface promises.
  if (crop) pipeline = pipeline.extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height });

  const encoded =
    target === 'jpeg' ? pipeline.jpeg({ quality: 90 })
      : target === 'png' ? pipeline.png({ compressionLevel: 9 })
        : target === 'tiff' ? pipeline.tiff()
          : pipeline.webp({ quality: 90 });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, format: target };
}

/**
 * The image's size as it DISPLAYS, i.e. with EXIF orientation applied.
 *
 * `meta.width`/`meta.height` are the raw stored dimensions, which for a sideways-tagged photo are
 * transposed relative to what any viewer shows. A crop box drawn over the displayed image would then
 * be validated against the wrong axes and a legitimate selection rejected as out of bounds.
 */
function orientedSize(meta: Metadata): { width: number; height: number } {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // EXIF orientations 5–8 are the transposing ones (90°/270° with or without a mirror).
  const o = meta.orientation ?? 1;
  return o >= 5 && o <= 8 ? { width: height, height: width } : { width, height };
}
