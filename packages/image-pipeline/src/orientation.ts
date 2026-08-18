import sharp from 'sharp';

/**
 * EXIF orientation — reading it, and rendering the LQIP that depends on it.
 *
 * A camera that is held sideways does not rotate its sensor: it writes the pixels as they were
 * captured and records an `Orientation` tag saying how to turn them. Browsers apply that tag, so the
 * stored original always LOOKS upright. sharp does not apply it unless asked, and drops metadata on
 * encode — which is why every pipeline here opts in explicitly, and why a library stored before it
 * did needs the repair this module's probe drives.
 */

const MAX_INPUT_PIXELS = 100_000_000;

/** Orientation values 5–8 swap the axes; 1–4 (upright / mirrored) leave them alone. */
export interface UprightSize {
  /** The raw EXIF tag: 1 = upright, 2–8 = some rotation and/or mirror, `undefined` = no tag. */
  orientation: number | undefined;
  /** Width AS DISPLAYED — transposed for a 90° tag. */
  width: number;
  /** Height AS DISPLAYED. */
  height: number;
  /** True when the tag transposes the axes (orientation 5–8). */
  transposed: boolean;
}

/**
 * The size a browser will actually paint `input` at, plus the tag that decides it.
 *
 * Reads the header only — sharp decodes no pixels for `metadata()` — so this is cheap enough to run
 * across a library of tens of thousands of images. Returns `null` when the dimensions can't be read.
 */
export async function readUprightSize(input: Buffer | string): Promise<UprightSize | null> {
  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const rawWidth = meta.width ?? 0;
  // `pageHeight` is ONE frame of an animated source; animated containers carry no orientation tag.
  const rawHeight = meta.pageHeight ?? meta.height ?? 0;
  if (rawWidth <= 0 || rawHeight <= 0) return null;
  const animated = (meta.pages ?? 1) > 1;
  const width = animated ? rawWidth : (meta.autoOrient?.width ?? rawWidth);
  const height = animated ? rawHeight : (meta.autoOrient?.height ?? rawHeight);
  return {
    orientation: meta.orientation,
    width,
    height,
    transposed: width === rawHeight && height === rawWidth && width !== height,
  };
}

/**
 * The inline blurred placeholder (LQIP) shown while the real image loads — oriented, because it is
 * stretched into the upright box and a sideways blur behind an upright photo is plainly visible.
 */
export async function renderPlaceholder(input: Buffer | string): Promise<string> {
  const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true })
    .resize(20)
    .blur(20)
    .webp({ quality: 40 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

/** A quarter-turn, clockwise. 180 flips; 90/270 transpose the stored dimensions. */
export type QuarterTurn = 90 | 180 | 270;

export interface RotatedImage {
  buffer: Buffer;
  /** Width of the rotated file, in its own pixels. */
  width: number;
  /** Height of the rotated file. */
  height: number;
  /** The format actually written — the source format, or `webp` where the source cannot be re-encoded. */
  format: string;
}

/** Formats we can re-encode a rotation into without changing what the file IS. */
const REENCODE: Record<string, 'jpeg' | 'png' | 'webp' | 'tiff'> = {
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
  tiff: 'tiff',
};

/**
 * Turn an image a quarter at a time and re-encode it in place.
 *
 * ★ Why this has to exist. EXIF orientation only helps when the tag is THERE. Plenty of real libraries
 * hold photographs whose pixels are sideways and whose tag was stripped by whatever produced them — a
 * CMS, an export, a messaging app. Nothing in the metadata says so, `autoOrient` has nothing to apply,
 * and the only remaining fix is to turn the pixels. Doing that in place (same asset, same stored name)
 * is what keeps every existing reference — `<img src>`, `{{sw-image}}`, a gallery folder listing —
 * pointing at the corrected file instead of leaving the author to re-link each one.
 *
 * The rotation is applied on top of any EXIF orientation (`autoOrient`), so a tagged image is
 * normalised at the same time and the result never depends on a tag again. Metadata is not carried
 * over: keeping a now-wrong Orientation tag would make every future reader rotate it a second time.
 */
export async function rotateImage(input: Buffer | string, turn: QuarterTurn): Promise<RotatedImage> {
  if (turn !== 90 && turn !== 180 && turn !== 270) {
    throw new Error('invalid rotation: must be 90, 180 or 270');
  }
  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const animated = (meta.pages ?? 1) > 1;
  if (animated) throw new Error('cannot rotate an animated image');
  const target = REENCODE[meta.format ?? ''] ?? 'webp';
  const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true }).rotate(turn);
  const encoded =
    target === 'jpeg' ? pipeline.jpeg({ quality: 90 })
      : target === 'png' ? pipeline.png({ compressionLevel: 9 })
        : target === 'tiff' ? pipeline.tiff()
          : pipeline.webp({ quality: 90 });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, format: target };
}
