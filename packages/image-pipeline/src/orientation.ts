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
