// Intake for a PROJECT export zip (manifest.json + bundle.json + media/<assetId>/…). Validates the
// envelope + bundle before any project is created, and extracts media binaries to disk with the same
// zip-bomb / zip-slip defenses as the website-import upload path (bounded decompression, path
// normalization, per-entry + total byte caps).
import JSZip from 'jszip';
import {
  ExportManifestSchema,
  ProjectExportBundleSchema,
  PROJECT_EXPORT_FORMAT,
  type ExportManifest,
  type ProjectExportBundle,
} from '@sitewright/schema';
import { UploadError, normalizeZipPath, decompressBounded } from './upload.js';
import type { MediaStorage } from '../media/storage.js';

export interface ProjectZipLimits {
  /** Max entries scanned in the archive. */
  maxEntries: number;
  /** Per-entry uncompressed byte cap (a single media file / the JSON docs). */
  maxEntryBytes: number;
  /** Total uncompressed media byte budget across the archive (zip-bomb guard). */
  maxTotalBytes: number;
}

export const DEFAULT_PROJECT_ZIP_LIMITS: ProjectZipLimits = {
  maxEntries: 100_000,
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 600 * 1024 * 1024,
};

const decoder = new TextDecoder('utf-8');

export interface ParsedProjectZip {
  manifest: ExportManifest;
  bundle: ProjectExportBundle;
  /** The loaded archive, retained so media binaries can be extracted after the project is created. */
  zip: JSZip;
}

/**
 * Loads a project export zip and validates its `manifest.json` + `bundle.json` (bounded, so a bomb
 * can't blow up here). Throws {@link UploadError} on any client-fixable problem (bad zip, missing
 * docs, non-JSON, schema mismatch, newer format). Does NOT touch the filesystem or DB.
 */
export async function readProjectZip(
  buffer: Buffer,
  limits: ProjectZipLimits = DEFAULT_PROJECT_ZIP_LIMITS,
): Promise<ParsedProjectZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new UploadError('not a valid zip archive');
  }
  if (Object.keys(zip.files).length > limits.maxEntries) {
    throw new UploadError('archive has too many entries');
  }
  const manifestFile = zip.file('manifest.json');
  const bundleFile = zip.file('bundle.json');
  if (!manifestFile || !bundleFile) {
    throw new UploadError('not a Sitewright project export (missing manifest.json or bundle.json)');
  }

  const manifestBytes = await decompressBounded(manifestFile, limits.maxEntryBytes);
  const bundleBytes = await decompressBounded(bundleFile, limits.maxEntryBytes);
  if (!manifestBytes || !bundleBytes) throw new UploadError('manifest.json / bundle.json is too large');

  let manifestJson: unknown;
  let bundleJson: unknown;
  try {
    manifestJson = JSON.parse(decoder.decode(manifestBytes));
    bundleJson = JSON.parse(decoder.decode(bundleBytes));
  } catch {
    throw new UploadError('manifest.json / bundle.json is not valid JSON');
  }

  const manifest = ExportManifestSchema.safeParse(manifestJson);
  if (!manifest.success) throw new UploadError('invalid export manifest');
  if (manifest.data.exportFormat > PROJECT_EXPORT_FORMAT) {
    throw new UploadError('this export was made by a newer version of Sitewright');
  }
  const bundle = ProjectExportBundleSchema.safeParse(bundleJson);
  if (!bundle.success) throw new UploadError('invalid project bundle');

  return { manifest: manifest.data, bundle: bundle.data, zip };
}

/**
 * Extracts every `media/<assetId>/<rel>` entry to `MEDIA_ROOT/<newSlug>/<assetId>/<rel>`, bounded
 * (per-entry + total) and zip-slip-safe (path normalized, then `importAssetFile` re-validates and
 * confines). Returns the number of files written. `onProgress(done)` ticks per file.
 */
export async function extractProjectMedia(
  zip: JSZip,
  storage: MediaStorage,
  newSlug: string,
  limits: ProjectZipLimits = DEFAULT_PROJECT_ZIP_LIMITS,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const names = Object.keys(zip.files).filter((n) => {
    const entry = zip.files[n];
    return n.startsWith('media/') && entry !== undefined && !entry.dir;
  });
  let total = 0;
  let done = 0;
  for (const name of names) {
    const norm = normalizeZipPath(name); // rejects traversal / absolute / backslash → null
    if (!norm || !norm.startsWith('media/')) continue;
    const rest = norm.slice('media/'.length); // <assetId>/<rel…>
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) continue; // need assetId AND a file rel
    const assetId = rest.slice(0, slash);
    const rel = rest.slice(slash + 1);

    const file = zip.file(name);
    if (!file) continue;
    const data = await decompressBounded(file, limits.maxEntryBytes);
    if (!data) throw new UploadError('a media file exceeds the per-entry size limit');
    total += data.length;
    if (total > limits.maxTotalBytes) throw new UploadError('archive media exceeds the total size limit');
    await storage.importAssetFile(newSlug, assetId, rel, Buffer.from(data));
    done += 1;
    onProgress?.(done, names.length);
  }
  return done;
}
