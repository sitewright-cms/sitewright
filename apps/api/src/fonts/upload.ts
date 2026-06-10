// Font-file validation for self-hosting (local uploads + Google downloads). Fonts are stored as
// `kind:'font'` media assets; this module only decides whether a payload is a real font + its
// format. Validation is by MAGIC BYTES (the client extension/mimetype is never trusted), so a
// disguised executable/HTML can never be stored or served as a font.

export type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';

/** A latin woff2 is ~20–80 KiB; ttf/otf can be larger. 5 MiB covers a heavy face with room to spare. */
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

/** Container extension per detected format (the stored file is `<family-slug>-<weight>[-italic].<ext>`). */
export const FONT_EXT: Record<FontFormat, string> = { woff2: 'woff2', woff: 'woff', ttf: 'ttf', otf: 'otf' };

/**
 * Detect the font container from its MAGIC BYTES. Returns null for anything that isn't a supported
 * sfnt/woff font, so a disguised executable/HTML/SVG is rejected before it can be stored or served.
 */
export function detectFontFormat(buf: Buffer): FontFormat | null {
  if (buf.length < 4) return null;
  const tag = buf.subarray(0, 4).toString('latin1');
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf'; // OpenType with CFF outlines
  if (tag === 'true' || tag === 'ttcf') return 'ttf'; // TrueType / TrueType collection
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) return 'ttf'; // sfnt 1.0
  return null;
}
