import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Id segments are generated/validated identifiers; servable files are produced by
// the image pipeline. Both charsets exclude `/`, `.` (except the extension) and
// `\`, so a value can never escape its directory.
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const SERVABLE_FILE = /^[A-Za-z0-9_-]+\.(avif|webp|jpg)$/;
// A stored RAW file name: a sanitized base + a short original extension. Superset of
// SERVABLE_FILE; still no slashes or dot-segments, so it stays confined to its asset dir.
const STORED_FILE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/;

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

  /**
   * Sanitizes an arbitrary upload file name into a path-safe `<base>.<ext>` stored name. The base
   * is reduced to `[A-Za-z0-9_-]` (other chars → `-`, collapsed, trimmed, capped); a missing or
   * unsafe extension falls back to `bin`. Always returns a value that matches STORED_FILE.
   */
  static safeStoredName(filename: string): string {
    const dot = filename.lastIndexOf('.');
    const rawExt = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
    const ext = /^[A-Za-z0-9]{1,12}$/.test(rawExt) ? rawExt : 'bin';
    const rawBase = dot > 0 ? filename.slice(0, dot) : filename;
    const base =
      rawBase
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'file';
    return `${base}.${ext}`;
  }

  /** Writes a raw (non-image) upload under `<root>/<projectId>/<assetId>/<storedName>`. */
  async storeFile(projectId: string, assetId: string, storedName: string, data: Buffer): Promise<void> {
    if (!STORED_FILE.test(storedName)) throw new Error('invalid stored file name');
    const assetDir = this.assetDir(projectId, assetId); // segments are charset-validated
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await mkdir(assetDir, { recursive: true, mode: 0o750 });
    const target = this.resolveStoredPath(projectId, assetId, storedName);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await writeFile(target, data);
  }

  /** Resolves a stored raw-file path (broader charset than servable images), confined to its dir. */
  resolveStoredPath(projectId: string, assetId: string, file: string): string {
    if (!STORED_FILE.test(file)) throw new Error('invalid stored file name');
    const dir = resolve(this.assetDir(projectId, assetId));
    const full = resolve(dir, file);
    if (full !== join(dir, file) || !full.startsWith(dir + sep)) {
      throw new Error('resolved media path escapes its directory');
    }
    return full;
  }

  /**
   * Reads any stored file by its (broad) stored name — raw uploads AND image variants. Used by the
   * attachment-only raw serve route and by the publish copier (NOT the inline image route, which
   * keeps the strict image-servable `read`).
   */
  async readStored(projectId: string, assetId: string, file: string): Promise<Buffer> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated + confined above
    return readFile(this.resolveStoredPath(projectId, assetId, file));
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

  /**
   * Copies an asset's entire directory to a NEW asset id (same project) — the binaries
   * of a duplicated asset. Both ids are charset-validated by `assetDir`; the variant
   * file names within are unchanged (an image's `url`/`variants` stay valid because they
   * carry no asset id — the serve route keys off the path's id segment).
   */
  async copyAsset(projectId: string, fromAssetId: string, toAssetId: string): Promise<void> {
    const from = this.assetDir(projectId, fromAssetId);
    const to = this.assetDir(projectId, toAssetId);
    await cp(from, to, { recursive: true });
  }

  /** Deletes a project's entire media directory (idempotent). Used on project delete. */
  async removeProject(projectId: string): Promise<void> {
    if (!SEGMENT.test(projectId)) throw new Error('invalid media project id');
    await rm(join(this.root, projectId), { recursive: true, force: true });
  }
}
