import type { Dirent } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isShortAssetId } from '../id.js';

// Id segments are generated/validated identifiers; servable files are produced by
// the image pipeline. Both charsets exclude `/`, `.` (except the extension) and
// `\`, so a value can never escape its directory. A project slug (`[a-z0-9-]+`) is a
// strict subset of SEGMENT, so it is a valid top-level namespace.
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const SERVABLE_FILE = /^[A-Za-z0-9_-]+\.(avif|webp|jpg)$/;
// A stored RAW file name: a sanitized base + a short original extension. Superset of
// SERVABLE_FILE; still no slashes or dot-segments, so it stays confined to its asset dir.
const STORED_FILE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/;

/**
 * Tenant/project-scoped media storage on the local filesystem (single-container default).
 *
 * Two on-disk layouts coexist, chosen per asset by its id shape (`isShortAssetId`):
 *  - FLAT (new, short 6-char base62 id): every file lives directly in the project dir as
 *    `<root>/<slug>/<id>-<file>`. All of a project's assets share ONE folder — fewer directories to
 *    walk/deploy, and the layout the operator-browsed mount shows.
 *  - LEGACY (old `randomUUID()` id): `<root>/<slug>/<id>/<file>` (a folder per asset), the
 *    pre-migration layout. Still read/served so un-migrated assets keep working during the migration.
 *
 * The project's immutable slug is the human-readable top namespace (mirrors the public `/media/<slug>/…`
 * URL). All public-facing inputs are charset-validated, and serve paths are additionally confined to
 * the project directory as defense-in-depth against traversal.
 */
export class MediaStorage {
  constructor(private readonly root: string) {}

  /** The project's media root dir (the flat namespace for its assets). */
  private projectDir(projectSlug: string): string {
    if (!SEGMENT.test(projectSlug)) throw new Error('invalid media project slug');
    return join(this.root, projectSlug);
  }

  /** Legacy per-asset directory (`<root>/<slug>/<id>/`) — only for long (uuid) ids. */
  private assetDir(projectSlug: string, assetId: string): string {
    if (!SEGMENT.test(projectSlug) || !SEGMENT.test(assetId)) {
      throw new Error('invalid media id segment');
    }
    return join(this.projectDir(projectSlug), assetId);
  }

  /** A flat asset file's on-disk basename: `<id>-<file>` (short id is base62 — no interior hyphen). */
  private flatName(assetId: string, file: string): string {
    return `${assetId}-${file}`;
  }

  /**
   * Absolute on-disk path for ONE file of an asset, validating the id segment and confining the
   * result to the project directory. Picks the flat or legacy layout by the id shape. The `file`
   * charset is validated by the public callers (`resolveStoredPath`/`resolveServePath`).
   */
  private assetFilePath(projectSlug: string, assetId: string, file: string): string {
    if (!SEGMENT.test(assetId)) throw new Error('invalid media id segment');
    if (isShortAssetId(assetId)) {
      const dir = resolve(this.projectDir(projectSlug));
      const name = this.flatName(assetId, file);
      const full = resolve(dir, name);
      // The flat name contains no `/` (id is base62, file is charset-validated), so it must land
      // directly in the project dir — this equality/prefix pair rejects any traversal attempt.
      if (full !== join(dir, name) || !full.startsWith(dir + sep)) {
        throw new Error('resolved media path escapes its directory');
      }
      return full;
    }
    const dir = resolve(this.assetDir(projectSlug, assetId));
    const full = resolve(dir, file);
    if (full !== join(dir, file) || !full.startsWith(dir + sep)) {
      throw new Error('resolved media path escapes its directory');
    }
    return full;
  }

  /**
   * Creates the destination dir and writes the raw upload to a temp input file. Returns the dir a
   * subsequent `storeOriginal` should write into, plus the temp input path. For a flat (short-id)
   * asset the dir is the shared project dir and the caller passes a `<id>-`-prefixed `storedName` so
   * the optimized original lands as `<slug>/<id>-<name>`; for a legacy id it is the per-asset dir.
   */
  async stageUpload(
    projectSlug: string,
    assetId: string,
    data: Buffer,
  ): Promise<{ assetDir: string; inputPath: string }> {
    if (!SEGMENT.test(assetId)) throw new Error('invalid media id segment');
    const dir = isShortAssetId(assetId) ? this.projectDir(projectSlug) : this.assetDir(projectSlug, assetId);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await mkdir(dir, { recursive: true, mode: 0o750 });
    // `.upload` is not a servable extension (stripped by the pipeline's basename derivation), so it can
    // never be fetched; a flat temp is `<slug>/<id>.upload` (unique per asset id).
    const inputPath = join(dir, `${assetId}.upload`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await writeFile(inputPath, data);
    return { assetDir: dir, inputPath };
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

  /** Writes a raw (non-image) upload (`<id>-<storedName>` flat, or `<id>/<storedName>` legacy). */
  async storeFile(projectSlug: string, assetId: string, storedName: string, data: Buffer): Promise<void> {
    if (!STORED_FILE.test(storedName)) throw new Error('invalid stored file name');
    const dir = isShortAssetId(assetId) ? this.projectDir(projectSlug) : this.assetDir(projectSlug, assetId);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await mkdir(dir, { recursive: true, mode: 0o750 });
    const target = this.resolveStoredPath(projectSlug, assetId, storedName);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated path
    await writeFile(target, data);
  }

  /** Resolves a stored raw-file path (broader charset than servable images), confined to its dir. */
  resolveStoredPath(projectSlug: string, assetId: string, file: string): string {
    if (!STORED_FILE.test(file)) throw new Error('invalid stored file name');
    return this.assetFilePath(projectSlug, assetId, file);
  }

  /**
   * Reads any stored file by its (broad) stored name — raw uploads AND image variants. Used by the
   * attachment-only raw serve route and by the publish copier (NOT the inline image route, which
   * keeps the strict image-servable `read`).
   */
  async readStored(projectSlug: string, assetId: string, file: string): Promise<Buffer> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated + confined above
    return readFile(this.resolveStoredPath(projectSlug, assetId, file));
  }

  /** Resolves a servable file path, throwing on any invalid or escaping input. */
  resolveServePath(projectSlug: string, assetId: string, file: string): string {
    if (!SERVABLE_FILE.test(file)) throw new Error('invalid media file name');
    return this.assetFilePath(projectSlug, assetId, file);
  }

  /** Reads a servable file (throws on traversal or if missing). */
  async read(projectSlug: string, assetId: string, file: string): Promise<Buffer> {
    // resolveServePath validates every segment and confines the result to the project dir.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated + confined above
    return readFile(this.resolveServePath(projectSlug, assetId, file));
  }

  /**
   * Lists an asset's on-disk files as `{ file, abs }`, where `file` is the LOGICAL name (the flat
   * `<id>-` prefix stripped, or the legacy relative path). Skips the transient `.upload` input.
   * `[]` if the asset has no files yet. The single place the two layouts are enumerated.
   */
  private async listAssetFiles(projectSlug: string, assetId: string): Promise<{ file: string; abs: string }[]> {
    if (!SEGMENT.test(assetId)) throw new Error('invalid media id segment');
    if (isShortAssetId(assetId)) {
      const dir = this.projectDir(projectSlug);
      const prefix = `${assetId}-`;
      let entries: Dirent[];
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated dir
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      return entries
        .filter((e) => e.isFile() && e.name.startsWith(prefix) && !e.name.endsWith('.upload'))
        .map((e) => ({ file: e.name.slice(prefix.length), abs: join(dir, e.name) }));
    }
    // Legacy: walk the per-asset dir; `file` is the POSIX relative path (handles the `file/<name>` nest).
    const dir = this.assetDir(projectSlug, assetId);
    const out: { file: string; abs: string }[] = [];
    const walk = async (current: string): Promise<void> => {
      let entries: Dirent[];
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated dir
        entries = await readdir(current, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (current === dir && (code === 'ENOENT' || code === 'ENOTDIR')) return;
        throw err;
      }
      for (const entry of entries) {
        const abs = join(current, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.isFile() && !entry.name.endsWith('.upload')) {
          out.push({ file: relative(dir, abs).split(sep).join('/'), abs });
        }
      }
    };
    await walk(dir);
    return out;
  }

  /** Deletes ALL of an asset's files (idempotent). Flat: every `<id>-*` in the project dir. Legacy: the dir. */
  async remove(projectSlug: string, assetId: string): Promise<void> {
    if (isShortAssetId(assetId)) {
      for (const { abs } of await this.listAssetFiles(projectSlug, assetId)) {
        await rm(abs, { force: true });
      }
      // Also drop a stranded temp input, if any.
      await rm(join(this.projectDir(projectSlug), `${assetId}.upload`), { force: true });
      return;
    }
    await rm(this.assetDir(projectSlug, assetId), { recursive: true, force: true });
  }

  /** Deletes a SINGLE stored file of an asset (idempotent; path-confined). */
  async removeFile(projectSlug: string, assetId: string, file: string): Promise<void> {
    await rm(this.resolveStoredPath(projectSlug, assetId, file), { force: true });
  }

  /**
   * Copies an asset's files to a NEW asset id (same project) — the binaries of a duplicated asset. The
   * destination is always a fresh short (flat) id, so each source file is written as `<toId>-<file>`;
   * the source may be either layout. Logical file names are unchanged (an image's `url`/`original`
   * carry no id, so they stay valid — the serve route keys off the URL's id segment).
   */
  async copyAsset(projectSlug: string, fromAssetId: string, toAssetId: string): Promise<void> {
    if (!SEGMENT.test(toAssetId)) throw new Error('invalid media id segment');
    for (const { file, abs } of await this.listAssetFiles(projectSlug, fromAssetId)) {
      // A legacy `file/<name>` flattens to `<name>` under the new flat id; a plain name is unchanged.
      const logical = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file;
      const target = this.assetFilePath(projectSlug, toAssetId, logical);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined, validated paths
      await mkdir(dirname(target), { recursive: true, mode: 0o750 });
      await cp(abs, target);
    }
  }

  /** Deletes a project's entire media directory (idempotent). Used on project delete. */
  async removeProject(projectSlug: string): Promise<void> {
    await rm(this.projectDir(projectSlug), { recursive: true, force: true });
  }

  /**
   * Deletes every DERIVED, on-demand thumbnail of an asset — every file EXCEPT the retained
   * `keepOriginal` (the DB-known source of truth). Returns the count removed. Driven by the DB (the
   * caller passes the original LOGICAL name) so it can never mistake an original for a thumbnail; the
   * removed files are regenerated on the next request. Best-effort per file; nothing to prune ⇒ 0.
   */
  async pruneAssetThumbnails(projectSlug: string, assetId: string, keepOriginal: string): Promise<number> {
    // Refuse to sweep with no original to keep — otherwise the guard below never matches and we would
    // delete the retained original along with the thumbnails.
    if (!keepOriginal) return 0;
    let removed = 0;
    for (const { file, abs } of await this.listAssetFiles(projectSlug, assetId)) {
      if (file === keepOriginal) continue; // never delete the retained original
      try {
        await rm(abs, { force: true });
        removed += 1;
      } catch {
        /* best-effort: skip an entry we can't remove */
      }
    }
    return removed;
  }

  /**
   * Enumerates an asset's files as `{ rel, abs }` pairs for a project export — `rel` is the LOGICAL
   * name (forward slashes), so the archive layout is independent of the on-disk flat/legacy split.
   * `skipNames` (logical basenames) are omitted — a project export passes an image asset's DERIVED,
   * regenerable thumbnail names so the archive ships the retained ORIGINAL only.
   */
  async assetFilePaths(
    projectSlug: string,
    assetId: string,
    skipNames?: ReadonlySet<string>,
  ): Promise<{ rel: string; abs: string }[]> {
    return (await this.listAssetFiles(projectSlug, assetId))
      .filter(({ file }) => !skipNames?.has(file))
      .map(({ file, abs }) => ({ rel: file, abs }));
  }

  /**
   * Writes ONE file of an asset during a project-zip import. The relative path (from the zip,
   * ATTACKER-CONTROLLED) is defended against zip-slip: every segment must be a safe token (no
   * empty / `.` / `..` / charset escapes / dotfiles), and the resolved path is confined. A flat
   * (short-id) asset writes `<slug>/<id>-<name>` (a single logical segment); a legacy id keeps the
   * one legitimate `file/<name>` nesting.
   */
  async importAssetFile(
    projectSlug: string,
    assetId: string,
    rel: string,
    data: Buffer,
  ): Promise<void> {
    if (!SEGMENT.test(assetId)) throw new Error('invalid media id segment');
    const parts = rel.split('/');
    const maxParts = isShortAssetId(assetId) ? 1 : 3;
    if (parts.length === 0 || parts.length > maxParts) throw new Error('invalid media entry path');
    for (const part of parts) {
      // Reject empty / dot-segments AND any dotfile (`.htaccess`, `.env`).
      if (part === '' || part.startsWith('.') || !/^[A-Za-z0-9_.-]+$/.test(part)) {
        throw new Error('invalid media entry segment');
      }
    }
    if (isShortAssetId(assetId)) {
      // Flat: a single logical file → `<slug>/<id>-<name>`. `parts[0]` is charset-validated above.
      const dir = resolve(this.projectDir(projectSlug));
      const name = this.flatName(assetId, parts[0]!);
      const target = resolve(dir, name);
      if (target !== join(dir, name) || !target.startsWith(dir + sep)) {
        throw new Error('media entry escapes its directory');
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined + validated path
      await mkdir(dir, { recursive: true, mode: 0o750 });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined + validated path
      await writeFile(target, data);
      return;
    }
    const dir = resolve(this.assetDir(projectSlug, assetId));
    const full = resolve(dir, ...parts);
    if (full !== join(dir, ...parts) || !full.startsWith(dir + sep)) {
      throw new Error('media entry escapes its directory');
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined + validated path
    await mkdir(dirname(full), { recursive: true, mode: 0o750 });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined + validated path
    await writeFile(full, data);
  }

  /**
   * Copies an ENTIRE project's media tree to another project slug (used when a project is
   * duplicated in-instance). Layout-agnostic — it copies whatever files/folders exist. A missing
   * source yields an empty target dir; the target is expected to be a fresh project's (non-existent) dir.
   */
  async copyProjectMedia(fromSlug: string, toSlug: string): Promise<void> {
    if (!SEGMENT.test(fromSlug) || !SEGMENT.test(toSlug)) {
      throw new Error('invalid media project slug');
    }
    const from = join(this.root, fromSlug);
    const to = join(this.root, toSlug);
    await cp(from, to, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return; // source project has no media → nothing to copy
      throw err;
    });
  }
}
