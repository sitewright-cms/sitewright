// Upload intake: turn an uploaded ZIP (a static-site export) or a single HTML file into the same
// CapturedSite the crawler produces. Pages and in-zip assets are keyed under the synthetic UPLOAD_BASE
// so the engine's relative-URL resolution + asset lookup work identically to a crawl. Hardened against
// path-traversal and zip bombs (entry count + per-entry + total uncompressed-byte caps).
import JSZip from 'jszip';
import { assetKey, UPLOAD_BASE, type AssetKind, type CapturedAsset, type CapturedPage, type CapturedSite } from '@sitewright/site-import';

export interface UploadLimits {
  /** Max entries scanned in the archive. */
  maxEntries: number;
  /** Per-entry uncompressed byte cap (entries over this are skipped). */
  maxEntryBytes: number;
  /** Total uncompressed byte budget across the archive (zip-bomb guard). */
  maxTotalBytes: number;
  /** Max HTML pages taken from the archive. */
  maxHtmlPages: number;
}

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxEntries: 5000,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxHtmlPages: 200,
};

/** A client-fixable upload problem (bad archive / traversal / bomb / unsupported file). */
export class UploadError extends Error {}

const HTML_EXT = /\.x?html?$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|tiff?)$/i;
const CSS_EXT = /\.css$/i;
const decoder = new TextDecoder('utf-8');

/**
 * A JSZip entry's stored uncompressed size from the archive central directory (JSZip 3.x internal
 * `_data.uncompressedSize`). ATTACKER-CONTROLLED — used only as a cheap fast-fail; the binding guard is
 * {@link decompressBounded}, which aborts decompression once the real output exceeds the byte cap.
 */
function declaredSize(file: JSZip.JSZipObject): number | undefined {
  const data = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : undefined;
}

interface StreamLike {
  on: (event: string, cb: (arg?: unknown) => void) => StreamLike;
  resume: () => void;
  pause: () => void;
}

/**
 * Decompress a zip entry but STOP once the output exceeds `maxBytes` (returns null) — so a bomb entry
 * (even one lying about its size) can't allocate beyond the cap. JSZip's `internalStream` is pull-driven
 * by `resume()`; pausing on overflow halts both memory growth and further inflate work.
 */
function decompressBounded(file: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    const finish = (v: Uint8Array | null): void => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    // `internalStream` is a documented JSZip method but absent from its published types — cast to use it.
    const stream = (file as unknown as { internalStream: (t: string) => StreamLike }).internalStream('uint8array');
    stream.on('data', (chunk) => {
      if (done) return;
      const c = chunk as Uint8Array;
      total += c.length;
      if (total > maxBytes) {
        stream.pause();
        finish(null);
        return;
      }
      chunks.push(c);
    });
    stream.on('error', () => finish(null));
    stream.on('end', () => {
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      finish(out);
    });
    stream.resume();
  });
}

/** Normalize an in-zip path; null if it escapes the root (traversal) or is absolute/backslashed. */
export function normalizeZipPath(name: string): string | null {
  if (name.includes('\\') || name.startsWith('/')) return null;
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

/**
 * The page's synthetic source URL — its DIRECTORY (trailing slash), so relative `<img src>`/`<a href>`
 * resolve against the same location the asset lives at in the zip. `dir/index.html` → `dir/` (and the
 * replacer keeps the slash), root `index.html` → `` → UPLOAD_BASE; a non-index file keeps its name.
 */
function pageUrlFor(zipPath: string): string {
  const stripped = zipPath.replace(/(?:^|\/)index\.x?html?$/i, (m) => (m.startsWith('/') ? '/' : ''));
  return UPLOAD_BASE + stripped;
}

function isZip(buffer: Buffer, filename: string): boolean {
  if (/\.zip$/i.test(filename)) return true;
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
}

function isHtmlFile(buffer: Buffer, filename: string): boolean {
  if (HTML_EXT.test(filename)) return true;
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

export interface UploadResult {
  site: CapturedSite;
  warnings: string[];
}

export async function buildCapturedSiteFromUpload(buffer: Buffer, filename: string, limits: UploadLimits = DEFAULT_UPLOAD_LIMITS): Promise<UploadResult> {
  if (isZip(buffer, filename)) return fromZip(buffer, filename, limits);
  if (isHtmlFile(buffer, filename)) {
    return {
      site: { baseUrl: UPLOAD_BASE, pages: [{ sourceUrl: UPLOAD_BASE, html: decoder.decode(buffer) }], assets: new Map(), origin: { kind: 'upload', label: filename || 'upload.html' } },
      warnings: [],
    };
  }
  throw new UploadError('unsupported file: upload a .zip site export or a single .html file');
}

async function fromZip(buffer: Buffer, filename: string, limits: UploadLimits): Promise<UploadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new UploadError('could not read the ZIP archive');
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > limits.maxEntries) throw new UploadError(`archive has too many entries (> ${limits.maxEntries})`);

  // Pre-flight: reject traversal, and a CHEAP fast-fail on the declared total (honest archives). The
  // real bomb guard is per-entry decompressBounded below — declared sizes are attacker-controlled.
  let declaredTotal = 0;
  for (const f of files) {
    if (normalizeZipPath(f.name) === null) throw new UploadError(`unsafe path in archive: ${f.name}`);
    declaredTotal += declaredSize(f) ?? 0;
  }
  if (declaredTotal > limits.maxTotalBytes) throw new UploadError('archive is too large when uncompressed');

  const warnings: string[] = [];
  const pages: CapturedPage[] = [];
  const assets = new Map<string, CapturedAsset>();
  let decompressed = 0;

  const read = async (f: JSZip.JSZipObject): Promise<Uint8Array | null> => {
    // Cap THIS entry at the smaller of the per-entry cap and the remaining total budget; decompress with
    // a hard byte ceiling (see decompressBounded) so a single lying-metadata bomb can't spike memory.
    const cap = Math.min(limits.maxEntryBytes, limits.maxTotalBytes - decompressed);
    if (cap <= 0) {
      warnings.push(`skipped entry beyond the uncompressed budget: ${f.name}`);
      return null;
    }
    const bytes = await decompressBounded(f, cap);
    if (!bytes) {
      warnings.push(`skipped oversized entry: ${f.name}`);
      return null;
    }
    decompressed += bytes.length;
    return bytes;
  };

  for (const f of files) {
    const path = normalizeZipPath(f.name)!;
    if (HTML_EXT.test(path)) {
      if (pages.length >= limits.maxHtmlPages) {
        warnings.push(`skipped page beyond the limit: ${path}`);
        continue;
      }
      const bytes = await read(f);
      if (bytes) pages.push({ sourceUrl: pageUrlFor(path), html: decoder.decode(bytes) });
    } else if (IMAGE_EXT.test(path) || CSS_EXT.test(path)) {
      const bytes = await read(f);
      if (!bytes) continue;
      const kind: AssetKind = CSS_EXT.test(path) ? 'css' : 'image';
      const key = assetKey(path, UPLOAD_BASE);
      if (key) assets.set(key, { sourceRef: key, kind, bytes });
    }
    // Other files (fonts, JS, etc.) are intentionally ignored — the engine never uses them.
  }

  if (pages.length === 0) throw new UploadError('no HTML pages found in the archive');
  return { site: { baseUrl: UPLOAD_BASE, pages, assets, origin: { kind: 'upload', label: filename || 'upload.zip' } }, warnings };
}
