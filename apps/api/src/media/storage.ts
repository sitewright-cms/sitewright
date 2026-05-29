import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Id segments are generated/validated identifiers; servable files are produced by
// the image pipeline. Both charsets exclude `/`, `.` (except the extension) and
// `\`, so a value can never escape its directory.
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const SERVABLE_FILE = /^[A-Za-z0-9_-]+\.(avif|webp|jpg)$/;

/**
 * Tenant/project-scoped media storage on the local filesystem (single-container
 * default). Layout: `<root>/<projectId>/<assetId>/<file>`. All public-facing
 * inputs are charset-validated, and serve paths are additionally confined to the
 * asset directory as defense-in-depth against traversal.
 */
export class MediaStorage {
  constructor(private readonly root: string) {}

  private assetDir(projectId: string, assetId: string): string {
    if (!SEGMENT.test(projectId) || !SEGMENT.test(assetId)) {
      throw new Error('invalid media id segment');
    }
    return join(this.root, projectId, assetId);
  }

  /** Creates the asset directory and writes the raw upload to a temp input file. */
  async stageUpload(
    projectId: string,
    assetId: string,
    data: Buffer,
  ): Promise<{ assetDir: string; inputPath: string }> {
    const assetDir = this.assetDir(projectId, assetId); // segments are charset-validated
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await mkdir(assetDir, { recursive: true, mode: 0o750 });
    // `.upload` extension is stripped by the pipeline's basename derivation and is
    // not a servable extension, so it can never be fetched.
    const inputPath = join(assetDir, `${assetId}.upload`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await writeFile(inputPath, data);
    return { assetDir, inputPath };
  }

  /** Removes the temp input file after optimization (best-effort). */
  async clearUpload(inputPath: string): Promise<void> {
    await rm(inputPath, { force: true });
  }

  /** Resolves a servable file path, throwing on any invalid or escaping input. */
  resolveServePath(projectId: string, assetId: string, file: string): string {
    if (!SERVABLE_FILE.test(file)) throw new Error('invalid media file name');
    const dir = resolve(this.assetDir(projectId, assetId));
    const full = resolve(dir, file);
    if (full !== join(dir, file) || !full.startsWith(dir + sep)) {
      throw new Error('resolved media path escapes its directory');
    }
    return full;
  }

  /** Reads a servable file (throws on traversal or if missing). */
  async read(projectId: string, assetId: string, file: string): Promise<Buffer> {
    // resolveServePath validates every segment and confines the result to the asset dir.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated + confined above
    return readFile(this.resolveServePath(projectId, assetId, file));
  }

  /** Deletes an asset's entire directory (idempotent). */
  async remove(projectId: string, assetId: string): Promise<void> {
    await rm(this.assetDir(projectId, assetId), { recursive: true, force: true });
  }
}
