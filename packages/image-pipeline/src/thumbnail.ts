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
  input: Buffer,
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

  const pipe = sharp(input, { ...SHARP_OPTIONS, animated: readAnimated }).resize({
    width,
    withoutEnlargement: true,
  });
  const encoded = format === 'avif' ? pipe.avif({ quality }) : pipe.webp({ quality });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });

  // `info.height` on an animated buffer is the stacked page height; derive the true single-frame
  // height from the source aspect ratio so it is always correct regardless of animation.
  const srcW = meta.width ?? info.width;
  const srcFrameH = meta.pageHeight ?? meta.height ?? info.height;
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
