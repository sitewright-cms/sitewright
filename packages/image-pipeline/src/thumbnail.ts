import sharp from 'sharp';
import type { ThumbFormat } from './sizes.js';

// Originals can be large (retina photos, 2400px+), so allow a higher pixel ceiling than the
// old fixed-variant path. Still bounded to stop a decompression bomb.
const MAX_INPUT_PIXELS = 100_000_000; // ~100 MP decoded (per frame)
const SHARP_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS } as const;

// Per-format default quality. AVIF's quality scale is more aggressive than WebP's, so a lower
// number yields comparable perceptual quality at a smaller size.
const DEFAULT_QUALITY: Record<ThumbFormat, number> = { webp: 74, avif: 55 };

export interface ThumbnailResult {
  buffer: Buffer;
  /** Encoded width in px (== requested width, or the source width if smaller — never upscaled). */
  width: number;
  /** Encoded single-frame height in px (aspect-preserved). */
  height: number;
  format: ThumbFormat;
}

/**
 * Generate ONE responsive thumbnail from an original image buffer.
 *
 * - Never upscales (`withoutEnlargement`): a requested width larger than the source clamps to
 *   the source width, so `xl` (2400) of an 800px image is 800px, not a blurry 2400px.
 * - WebP output preserves alpha AND animation: an animated GIF/WebP → animated WebP.
 * - AVIF is encoded static-only (single frame); an animated source requested as AVIF collapses to
 *   its first frame (callers should prefer WebP for animated media — see the serve route).
 *
 * The caller confines/writes the buffer and applies a concurrency limit; this function is pure
 * compute over an in-memory buffer (no disk I/O).
 */
export async function generateThumbnail(
  /**
   * The source image — bytes, or a PATH to read them from.
   *
   * A path lets sharp stream the original off disk instead of the caller holding it in the heap.
   * Measured: serving 20 distinct images cold cost ~184MB, ~9MB each, because the source buffer, the
   * decode and the encoded output were all resident at once — and an original may be up to 50MB.
   * sharp validates and reads the file itself, so a missing or unreadable path throws exactly as a
   * bad buffer would.
   */
  input: Buffer | string,
  opts: { width: number; format?: ThumbFormat; quality?: number },
): Promise<ThumbnailResult> {
  const { width } = opts;
  if (!Number.isInteger(width) || width < 1 || width > 10_000) {
    throw new Error('invalid thumbnail width: must be a positive integer <= 10000');
  }
  const format: ThumbFormat = opts.format ?? 'webp';
  const quality = opts.quality ?? DEFAULT_QUALITY[format];
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error('invalid quality: must be an integer 1-100');
  }

  const meta = await sharp(input, SHARP_OPTIONS).metadata();
  const animated = (meta.pages ?? 1) > 1;
  // Read all frames only for the animated WebP path; AVIF (and static sources) stay single-frame.
  const readAnimated = animated && format === 'webp';

  // ★ `autoOrient` applies the source's EXIF Orientation tag before anything else.
  //
  // A phone photographed in portrait writes LANDSCAPE pixels plus `Orientation: 6`. Browsers honour
  // that tag, so the stored original looks upright — but sharp ignores it unless asked AND strips
  // metadata on encode, so an unrotated thumbnail is sideways *and* has lost the tag that would have
  // let the browser correct it. Every derived size then contradicts the original it came from.
  const pipe = sharp(input, { ...SHARP_OPTIONS, animated: readAnimated, autoOrient: true }).resize({
    width,
    withoutEnlargement: true,
  });
  const encoded = format === 'avif' ? pipe.avif({ quality }) : pipe.webp({ quality });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });

  // `info.height` on an animated buffer is the stacked page height; derive the true single-frame
  // height from the source aspect ratio so it is always correct regardless of animation. The aspect
  // must come from the ORIENTED dimensions (`meta.autoOrient`), which is where the transposition
  // lands for a rotated source — `meta.width`/`meta.height` are still the raw, sideways ones.
  const srcW = meta.autoOrient?.width ?? meta.width ?? info.width;
  const rawFrameH = meta.pageHeight ?? meta.height ?? info.height;
  // For an animated source `pageHeight` is the true frame height and EXIF orientation never applies
  // (GIF/animated WebP carry no orientation tag), so prefer it whenever the source is multi-frame.
  const srcFrameH = animated ? rawFrameH : (meta.autoOrient?.height ?? rawFrameH);
  const height = srcW > 0 ? Math.max(1, Math.round(info.width * (srcFrameH / srcW))) : info.height;

  return { buffer: data, width: info.width, height, format };
}

/**
 * Transcode a screenshot PNG (Chromium can only emit PNG/JPEG) to LOSSLESS WebP — smaller than PNG and,
 * unlike JPEG, artifact-free, so a high-res fidelity crop keeps crisp gradient stops / skew edges / thin
 * shadows intact for a visual compare. Pure compute over an in-memory buffer; the input-pixel bomb guard
 * is the same as {@link generateThumbnail}.
 */
export async function pngToLosslessWebp(png: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png, SHARP_OPTIONS).webp({ lossless: true }).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}
