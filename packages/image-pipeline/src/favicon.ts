import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Favicon / PWA icon set — derived from ONE square master image.
//
// A project supplies a single Corporate-Identity `icon` (≥512px square); the publish step calls
// `generateFaviconSet` to produce every file the platforms actually need — because one delivered
// file can't serve them all: formats differ (PNG for apple-touch, ICO for legacy), sizes differ
// (180 for iOS, 192/512 for the manifest, 32 for the tab), and apple-touch + maskable icons must
// be OPAQUE (iOS composites alpha onto black) with the glyph inside the maskable safe zone.
//
// Output (all PNG unless noted): favicon-32.png, apple-touch-icon.png (180, opaque),
// icon-192.png, icon-512.png (manifest "any"), icon-512-maskable.png (opaque, safe-zone padded),
// and favicon.ico (a PNG-in-ICO wrapper, universally supported). Input may be any raster sharp
// reads (PNG/JPEG/WebP); NEVER pass untrusted SVG (see rasterize.ts).
// ---------------------------------------------------------------------------

export interface FaviconFile {
  /** Output filename (no directory). */
  readonly name: string;
  readonly data: Buffer;
}

export interface FaviconSetOptions {
  /** Opaque background for apple-touch + maskable (alpha is flattened onto it). Default `#ffffff`. */
  readonly background?: string;
}

/** A single `render()` config kept tiny so the set stays in lockstep with the manifest emitter. */
export const FAVICON_FILES = {
  ico: 'favicon.ico',
  png32: 'favicon-32.png',
  apple: 'apple-touch-icon.png',
  png192: 'icon-192.png',
  png512: 'icon-512.png',
  maskable: 'icon-512-maskable.png',
} as const;

/** Sanitize the background to an OPAQUE value sharp accepts (3/6-digit hex or a CSS keyword); fall
 *  back to white. 8-digit `#RRGGBBAA` is rejected — a translucent flatten bg would break the
 *  opacity guarantee for the apple-touch + maskable icons. */
function safeBackground(bg: string | undefined): string {
  const v = (bg ?? '').trim();
  return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^[a-zA-Z]+$/.test(v) ? v : '#ffffff';
}

/** Square cover-resize → PNG. `flatten` composites any alpha onto `bg` (for opaque-required slots). */
function square(source: Buffer, size: number, bg: string, flatten: boolean): Promise<Buffer> {
  let pipe = sharp(source).resize(size, size, { fit: 'cover' });
  if (flatten) pipe = pipe.flatten({ background: bg });
  return pipe.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Maskable icon (Android adaptive). The masking crop only clips the EDGES, so the behaviour depends
 * on the master:
 *  - an OPAQUE, full-bleed master (its own background already reaches the edges) → just resize; the
 *    background fills the mask and the centred glyph is safe. Padding would needlessly shrink it
 *    inside a border.
 *  - a TRANSPARENT, glyph-only master → shrink the glyph into the ~80% safe zone and pad onto an
 *    opaque bg, so the mask can never clip the artwork.
 */
async function maskable(source: Buffer, size: number, bg: string): Promise<Buffer> {
  const { hasAlpha } = await sharp(source).metadata();
  if (!hasAlpha) {
    return sharp(source).resize(size, size, { fit: 'cover' }).flatten({ background: bg }).png({ compressionLevel: 9 }).toBuffer();
  }
  const inner = Math.round(size * 0.8);
  // Split the remaining border so inner + padA + padB === size EXACTLY (robust for any size, not
  // just 512 — `round(pad)*2` could over/undershoot by a pixel and change the output dimensions).
  const total = size - inner;
  const padA = Math.floor(total / 2);
  const padB = total - padA;
  return sharp(source)
    .resize(inner, inner, { fit: 'cover' })
    .flatten({ background: bg })
    .extend({ top: padA, bottom: padB, left: padA, right: padB, background: bg })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Wrap a single PNG as a Vista+ "PNG-in-ICO" (the ICO container may embed a PNG directly; supported
 * by every browser that still reads `.ico`). One 32×32 entry is enough — modern browsers prefer the
 * `<link rel="icon" type="image/png">` anyway; the `.ico` is the legacy / root-auto-request fallback.
 */
export function pngToIco(png: Buffer, dimension = 32): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // image type: 1 = icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(dimension >= 256 ? 0 : dimension, 0); // width  (0 ⇒ 256)
  entry.writeUInt8(dimension >= 256 ? 0 : dimension, 1); // height (0 ⇒ 256)
  entry.writeUInt8(0, 2); // palette count (0 = no palette)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image data size
  entry.writeUInt32LE(6 + 16, 12); // image data offset (after header + this single entry)
  return Buffer.concat([header, entry, png]);
}

/** Produce the full favicon/PWA icon set from a single square master image. */
export async function generateFaviconSet(source: Buffer, opts: FaviconSetOptions = {}): Promise<FaviconFile[]> {
  const bg = safeBackground(opts.background);
  const [png32, apple, png192, png512, png512Maskable] = await Promise.all([
    square(source, 32, bg, false),
    square(source, 180, bg, true), // apple-touch must be opaque
    square(source, 192, bg, false),
    square(source, 512, bg, false),
    maskable(source, 512, bg),
  ]);
  return [
    { name: FAVICON_FILES.ico, data: pngToIco(png32) },
    { name: FAVICON_FILES.png32, data: png32 },
    { name: FAVICON_FILES.apple, data: apple },
    { name: FAVICON_FILES.png192, data: png192 },
    { name: FAVICON_FILES.png512, data: png512 },
    { name: FAVICON_FILES.maskable, data: png512Maskable },
  ];
}
