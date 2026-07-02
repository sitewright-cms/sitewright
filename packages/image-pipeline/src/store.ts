import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB on-disk
const MAX_INPUT_PIXELS = 50_000_000; // ~50 MP decoded per frame — a generous ceiling for web originals
// (a retina 2400px photo is only a few MP); guards against a decompression bomb without capping real
// resolution.
const MAX_TOTAL_PIXELS = 100_000_000; // ~100 MP summed across ALL animation frames (bounds animated-WebP
// decode memory: e.g. a 1000-frame 1000×700 sprite = 700 MP → rejected).
const SHARP_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS } as const;

// Raster formats only. SVG is intentionally excluded: librsvg resolves remote references inside
// SVG, which is an SSRF vector for untrusted input.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff']);

// Quality for the re-encoded WebP when the importer caps an oversized original. High, because this
// becomes the retained source-of-truth from which every thumbnail is derived.
const CAPPED_WEBP_QUALITY = 82;

// Canonical file extension per DETECTED sharp format. The stored original's extension is normalised to
// this (NOT trusted from the upload filename) so the serve route can always recognise + thumbnail it
// — an upload named `photo` or `photo.bin` still stores a servable `photo.png`/`photo.jpg`/… .
const FORMAT_EXT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  tiff: 'tiff',
};

/** Metadata for a stored original image (no eager variants). */
export interface StoredImage {
  /** Intrinsic width of the STORED original (post-cap if capped), for `width`/`height` → no CLS. */
  width: number;
  height: number;
  /** Format of the stored file on disk: `jpeg`|`png`|`gif`|`webp`|`avif`|`tiff`. */
  format: string;
  /** Whether the source carries an alpha channel (governs fallback-format choices downstream). */
  hasAlpha: boolean;
  /** Whether the source is multi-frame (animated GIF/WebP). */
  animated: boolean;
  /** Tiny blurred inline data-URI placeholder (LQIP). */
  placeholder: string;
  /** File name actually written under `outDir` (extension may change to `.webp` if capped). */
  storedName: string;
  /** Byte size of the stored file. */
  bytes: number;
}

export interface StoreOriginalOptions {
  /**
   * The sanitized file name to store the original under (must be a bare `<base>.<ext>` with no
   * interior dots — pass `MediaStorage.safeStoredName(filename)`). If a cap is applied the
   * extension is rewritten to `.webp`.
   */
  storedName: string;
  /**
   * Max stored width. If the source is wider it is downscaled to `cap`. The importer/nativizer
   * sets this (2400) to bound a cloned site's footprint; normal uploads leave it unset (uncapped).
   */
  cap?: number;
  /** WebP quality for the re-encode when a cap actually bites. Default 82. */
  cappedQuality?: number;
}

function replaceExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/**
 * Store an uploaded/imported image as the retained ORIGINAL (source of truth) — NO eager
 * responsive variants. Extracts intrinsic dimensions, alpha/animation flags, and an inline LQIP,
 * then writes exactly one file under `outDir`:
 *
 * - By default the original bytes are stored verbatim in their original format (uncapped).
 * - If `cap` is set AND the source is wider, the image is downscaled to `cap` and re-encoded to
 *   WebP (the importer rule: "cap + convert to WebP only when the cap actually bites"). Animation
 *   and alpha are preserved through the WebP re-encode.
 *
 * Thumbnails are generated LATER, on demand, from this stored original (see `generateThumbnail`).
 *
 * Caller responsibilities for untrusted input: confine `outDir` to an allowed root, namespace it
 * per asset, and apply a concurrency limit.
 */
export async function storeOriginal(
  inputPath: string,
  outDir: string,
  options: StoreOriginalOptions,
): Promise<StoredImage> {
  if (options.cap !== undefined && (!Number.isInteger(options.cap) || options.cap < 1 || options.cap > 10_000)) {
    throw new Error('invalid cap: must be a positive integer <= 10000');
  }

  const { size } = await stat(inputPath);
  if (size > MAX_FILE_BYTES) {
    throw new Error('input file exceeds size limit');
  }

  const input = await readFile(inputPath);
  const metadata = await sharp(input, SHARP_OPTIONS).metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error('unsupported or disallowed image format');
  }
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.pageHeight ?? metadata.height ?? 0; // pageHeight = ONE frame's height
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('could not read image dimensions');
  }
  if (sourceWidth * sourceHeight > MAX_INPUT_PIXELS) {
    throw new Error('image exceeds pixel limit');
  }
  // Animated GIF/WebP: the per-frame check above passes for a huge frame COUNT (a 1000-frame sprite
  // sheet compresses tiny), but a later animated-WebP thumbnail decodes every frame at once. Bound the
  // TOTAL decoded pixels across all frames so an animated source can't blow up memory.
  const pages = metadata.pages ?? 1;
  if (sourceWidth * sourceHeight * pages > MAX_TOTAL_PIXELS) {
    throw new Error('image exceeds total (animated) pixel limit');
  }

  const hasAlpha = metadata.hasAlpha === true;
  const animated = pages > 1;

  await mkdir(outDir, { recursive: true, mode: 0o750 });

  const capApplies = options.cap !== undefined && sourceWidth > options.cap;

  let storedName: string;
  let format: string;
  let width: number;
  let height: number;

  if (capApplies) {
    // Downscale + re-encode to WebP (preserving alpha/animation). This becomes the retained source.
    const cap = options.cap!;
    const quality = options.cappedQuality ?? CAPPED_WEBP_QUALITY;
    storedName = replaceExt(options.storedName, 'webp');
    const { data, info } = await sharp(input, { ...SHARP_OPTIONS, animated })
      .resize({ width: cap, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    await writeFile(join(outDir, storedName), data);
    format = 'webp';
    width = info.width;
    height = sourceWidth > 0 ? Math.max(1, Math.round(info.width * (sourceHeight / sourceWidth))) : info.height;
  } else {
    // Store the original bytes verbatim, in their original format — but normalise the file extension
    // to the DETECTED format so the stored name is always a recognisable, servable image name.
    storedName = replaceExt(options.storedName, FORMAT_EXT[metadata.format] ?? metadata.format);
    await writeFile(join(outDir, storedName), input);
    format = metadata.format;
    width = sourceWidth;
    height = sourceHeight;
  }

  // Strong blur on a tiny first frame → a smooth LQIP that blends into the real image.
  const placeholderBuffer = await sharp(input, SHARP_OPTIONS).resize(20).blur(20).webp({ quality: 40 }).toBuffer();

  const { size: bytes } = await stat(join(outDir, storedName));

  return {
    width,
    height,
    format,
    hasAlpha,
    animated,
    placeholder: `data:image/webp;base64,${placeholderBuffer.toString('base64')}`,
    storedName,
    bytes,
  };
}
