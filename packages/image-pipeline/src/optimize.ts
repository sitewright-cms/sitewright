import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';
import type { ImageVariant, OptimizedImage, OptimizeOptions } from './types.js';

const DEFAULT_WIDTHS = [400, 800, 1200];
const DEFAULT_FORMATS: Array<'avif' | 'webp'> = ['avif', 'webp'];
const DEFAULT_QUALITY = 70;

// Resource limits — defensive even though inputs are build-time/trusted today,
// because this pipeline will process user-uploaded media.
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB on-disk
const MAX_INPUT_PIXELS = 50_000_000; // ~50 MP decoded
const SHARP_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS } as const;

// Raster formats only. SVG is intentionally excluded: librsvg resolves remote
// references inside SVG, which is an SSRF vector for untrusted input.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff']);

function assertValidOptions(options: OptimizeOptions): void {
  for (const width of options.widths ?? []) {
    if (!Number.isInteger(width) || width < 1 || width > 10_000) {
      throw new Error('invalid width: must be a positive integer <= 10000');
    }
  }
  const { quality } = options;
  if (quality !== undefined && (!Number.isInteger(quality) || quality < 1 || quality > 100)) {
    throw new Error('invalid quality: must be an integer 1-100');
  }
}

/**
 * Optimizes a source image into responsive AVIF/WebP variants plus a JPEG
 * fallback and an inline LQIP placeholder, writing the files into `outDir` and
 * returning a manifest. The source is never upscaled.
 *
 * Caller responsibilities for untrusted input: confine `outDir` to an allowed
 * root (this function does not), namespace `outDir` per source to avoid filename
 * collisions, and apply a concurrency limit.
 */
export async function optimizeImage(
  inputPath: string,
  outDir: string,
  options: OptimizeOptions = {},
): Promise<OptimizedImage> {
  assertValidOptions(options);
  const widths = options.widths ?? DEFAULT_WIDTHS;
  const formats = options.formats ?? DEFAULT_FORMATS;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const { size } = await stat(inputPath);
  if (size > MAX_FILE_BYTES) {
    throw new Error('input file exceeds size limit');
  }

  // Read once; reuse the buffer for every encode (no repeated disk I/O, no TOCTOU).
  const input = await readFile(inputPath);

  const metadata = await sharp(input, SHARP_OPTIONS).metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error('unsupported or disallowed image format');
  }
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('could not read image dimensions');
  }
  if (sourceWidth * sourceHeight > MAX_INPUT_PIXELS) {
    throw new Error('image exceeds pixel limit');
  }

  await mkdir(outDir, { recursive: true, mode: 0o750 });
  const { name } = parse(inputPath);

  const filtered = widths.filter((w) => w <= sourceWidth);
  const targetWidths = filtered.length > 0 ? filtered : [sourceWidth];
  const fallbackWidth = Math.max(...targetWidths);

  const variantTasks = formats.flatMap((format) =>
    targetWidths.map(async (width): Promise<ImageVariant> => {
      const path = `${name}-${width}.${format}`;
      const resized = sharp(input, SHARP_OPTIONS).resize(width);
      const encoded = format === 'avif' ? resized.avif({ quality }) : resized.webp({ quality });
      const info = await encoded.toFile(join(outDir, path));
      return { format, width: info.width, height: info.height, path };
    }),
  );

  const fallback = `${name}-${fallbackWidth}.jpg`;
  const fallbackTask = sharp(input, SHARP_OPTIONS)
    .resize(fallbackWidth)
    .jpeg({ quality })
    .toFile(join(outDir, fallback));

  // Strong blur on a tiny image → a smooth LQIP that blends into the real image.
  const lqipTask = sharp(input, SHARP_OPTIONS).resize(20).blur(20).webp({ quality: 40 }).toBuffer();

  const [variants, , placeholderBuffer] = await Promise.all([
    Promise.all(variantTasks),
    fallbackTask,
    lqipTask,
  ]);

  return {
    width: sourceWidth,
    height: sourceHeight,
    placeholder: `data:image/webp;base64,${placeholderBuffer.toString('base64')}`,
    variants,
    fallback,
  };
}
