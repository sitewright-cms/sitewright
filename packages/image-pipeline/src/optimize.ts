import { mkdir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';
import type { ImageVariant, OptimizedImage, OptimizeOptions } from './types.js';

const DEFAULT_WIDTHS = [400, 800, 1200];
const DEFAULT_FORMATS: Array<'avif' | 'webp'> = ['avif', 'webp'];
const DEFAULT_QUALITY = 70;

/**
 * Optimizes a source image into responsive AVIF/WebP variants plus a JPEG
 * fallback and an inline LQIP placeholder, writing the files into `outDir` and
 * returning a manifest. The source is never upscaled; only target widths up to
 * the intrinsic width are produced.
 */
export async function optimizeImage(
  inputPath: string,
  outDir: string,
  options: OptimizeOptions = {},
): Promise<OptimizedImage> {
  const widths = options.widths ?? DEFAULT_WIDTHS;
  const formats = options.formats ?? DEFAULT_FORMATS;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const metadata = await sharp(inputPath).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`could not read image dimensions: ${inputPath}`);
  }

  await mkdir(outDir, { recursive: true });
  const { name } = parse(inputPath);
  const ratio = sourceHeight / sourceWidth;

  const targetWidths = widths.filter((w) => w <= sourceWidth);
  if (targetWidths.length === 0) targetWidths.push(sourceWidth);

  const variants: ImageVariant[] = [];
  for (const format of formats) {
    for (const width of targetWidths) {
      const fileName = `${name}-${width}.${format}`;
      const resized = sharp(inputPath).resize(width);
      const encoded = format === 'avif' ? resized.avif({ quality }) : resized.webp({ quality });
      await encoded.toFile(join(outDir, fileName));
      variants.push({ format, width, height: Math.round(width * ratio), path: fileName });
    }
  }

  const fallbackWidth = Math.max(...targetWidths);
  const fallback = `${name}-${fallbackWidth}.jpg`;
  await sharp(inputPath).resize(fallbackWidth).jpeg({ quality }).toFile(join(outDir, fallback));

  const placeholderBuffer = await sharp(inputPath)
    .resize(20)
    .blur()
    .webp({ quality: 40 })
    .toBuffer();
  const placeholder = `data:image/webp;base64,${placeholderBuffer.toString('base64')}`;

  return { width: sourceWidth, height: sourceHeight, placeholder, variants, fallback };
}
