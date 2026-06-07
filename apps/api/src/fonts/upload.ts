import { randomBytes } from 'node:crypto';
import { SelfHostedFontSchema, type SelfHostedFont } from '@sitewright/schema';
import type { FontStore } from './store.js';

// Local (user-uploaded) font handling. Unlike Google fonts (fetched into the shared instance cache),
// these are licensed binaries stored PER PROJECT. An upload is validated by MAGIC BYTES (not the
// client-supplied content-type/extension), size-capped, then written into the project font store; the
// returned SelfHostedFont record (source 'local') is added to typography.fonts + the slot by the editor.

export class FontUploadError extends Error {}

/** A latin woff2 is ~20–80 KiB; ttf/otf can be larger. 5 MiB covers a heavy face with room to spare. */
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';
const EXT: Record<FontFormat, string> = { woff2: 'woff2', woff: 'woff', ttf: 'ttf', otf: 'otf' };

/**
 * Detect the font container from its MAGIC BYTES (the source of truth — the upload's extension /
 * mimetype is never trusted). Returns null for anything that isn't a supported sfnt/woff font, so a
 * disguised executable/HTML/SVG can never be stored or served as a font.
 */
export function detectFontFormat(buf: Buffer): FontFormat | null {
  if (buf.length < 4) return null;
  const tag = buf.subarray(0, 4).toString('latin1');
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf'; // OpenType with CFF outlines
  if (tag === 'true' || tag === 'ttcf') return 'ttf'; // TrueType / TrueType collection
  // TrueType sfnt version 0x00010000
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) return 'ttf';
  return null;
}

export interface LocalFontInput {
  family: string;
  fallback: SelfHostedFont['fallback'];
  weight: number;
  style: 'normal' | 'italic';
  data: Buffer;
}

/**
 * Validate (magic bytes + size) an uploaded font, store it in the PROJECT font store under a freshly
 * generated id (`up-<hex>`, never a google family slug), and return the `SelfHostedFont` record
 * (source `local`, one file). Re-validates through the schema so a bad weight/family fails here.
 */
export async function storeLocalFont(store: FontStore, input: LocalFontInput): Promise<SelfHostedFont> {
  if (input.data.length > MAX_FONT_BYTES) throw new FontUploadError('font exceeds size limit');
  const format = detectFontFormat(input.data);
  if (!format) throw new FontUploadError('unrecognized font file');

  const id = `up-${randomBytes(6).toString('hex')}`;
  // eslint-disable-next-line security/detect-object-injection -- `format` is a validated FontFormat enum literal, not user-controlled
  const file = `${input.weight}${input.style === 'italic' ? '-italic' : ''}.${EXT[format]}`;
  const parsed = SelfHostedFontSchema.safeParse({
    id,
    family: input.family,
    fallback: input.fallback,
    source: 'local',
    files: [{ weight: input.weight, style: input.style, format, file }],
  });
  if (!parsed.success) throw new FontUploadError('invalid font metadata');

  await store.write(id, file, input.data);
  return parsed.data;
}
