import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipFile, type ZipEntry } from './zip-writer.js';

/** One asset's on-disk files (absolute paths), keyed by the asset id used in the zip. */
export interface ExportMediaAsset {
  assetId: string;
  files: { rel: string; abs: string }[];
}

/**
 * Enumerates each asset's on-disk files with BOUNDED concurrency — a project can hold up to
 * `EXPORT_BUNDLE_CAPS.media` (20k) assets, so a naive `Promise.all` would fan out tens of
 * thousands of simultaneous `readdir`s and exhaust file descriptors. Batches of `concurrency`
 * keep the fan-out flat while still overlapping I/O.
 */
export async function collectExportMedia(
  enumerate: (assetId: string) => Promise<{ rel: string; abs: string }[]>,
  assetIds: readonly string[],
  concurrency = 64,
): Promise<ExportMediaAsset[]> {
  const out: ExportMediaAsset[] = [];
  for (let i = 0; i < assetIds.length; i += concurrency) {
    const batch = assetIds.slice(i, i + concurrency);
    const files = await Promise.all(batch.map((assetId) => enumerate(assetId)));
    batch.forEach((assetId, j) => out.push({ assetId, files: files[j] ?? [] }));
  }
  return out;
}

export interface ExportZipInputs {
  /** Serialized to `manifest.json` (pretty-printed for human inspection). */
  manifest: unknown;
  /** Serialized to `bundle.json` (the complete ProjectExportBundle). */
  bundle: unknown;
  /** Media binaries streamed under `media/<assetId>/<rel>` (never buffered whole). */
  media: ExportMediaAsset[];
  /** Hard cap on the produced archive size; generation aborts if exceeded. */
  maxBytes: number;
}

export interface ExportZipResult {
  /** Path to the finished archive on disk (in a private temp dir). */
  path: string;
  /** Final archive size in bytes. */
  bytes: number;
  /** Removes the temp dir + archive; call once the response has been flushed. */
  cleanup: () => Promise<void>;
}

/** Thrown when generation would exceed `maxBytes` — the route maps this to HTTP 413. */
export class ExportSizeLimitError extends Error {
  constructor(maxBytes: number) {
    super(`project export exceeds the ${maxBytes}-byte archive size limit`);
    this.name = 'ExportSizeLimitError';
  }
}

/**
 * Builds a project export zip by STREAMING it to a private temp file — media files are read from disk
 * as the archive is written and compressed by Node's zlib off the event loop (see zip-writer.ts), so
 * neither the inputs nor the finished archive are ever held whole in memory. The writer aborts the
 * moment the archive would exceed `maxBytes`. The caller streams {@link ExportZipResult.path} to the
 * client, then invokes `cleanup`.
 */
export async function buildProjectExportZip(inputs: ExportZipInputs): Promise<ExportZipResult> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-export-'));
  const path = join(dir, 'project.zip');
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };

  try {
    const entries: ZipEntry[] = [
      { name: 'manifest.json', data: JSON.stringify(inputs.manifest, null, 2) },
      { name: 'bundle.json', data: JSON.stringify(inputs.bundle) },
    ];
    for (const asset of inputs.media) {
      // abs paths come from the confined media enumerator.
      for (const file of asset.files) entries.push({ name: `media/${asset.assetId}/${file.rel}`, path: file.abs });
    }
    const bytes = await writeZipFile(entries, path, inputs.maxBytes, () => new ExportSizeLimitError(inputs.maxBytes));
    return { path, bytes, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
