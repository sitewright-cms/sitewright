import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Instance-level cache of self-hosted Google Fonts. Layout: `<root>/<fontId>/<weight>.woff2`,
// shared across projects (a family is downloaded once). Both segments are charset-validated and
// the resolved path is confined to the cache root, so traversal is impossible.

/** A path-safe font id (schema FontId / family slug). Exported so routes validate at their boundary. */
export const FONT_ID = /^[A-Za-z0-9_-]+$/;
/** A cache file name: `<weight>.woff2`, weight 100–900. Exported so routes share one definition. */
export const WOFF2_FILE = /^[1-9]00\.woff2$/;

export class FontStore {
  constructor(private readonly root: string) {}

  private dir(fontId: string): string {
    if (!FONT_ID.test(fontId)) throw new Error('invalid font id');
    return join(this.root, fontId);
  }

  /** Absolute, confined path for a font file (or throws on an invalid/escaping segment). */
  private filePath(fontId: string, file: string): string {
    if (!WOFF2_FILE.test(file)) throw new Error('invalid font file');
    const dir = resolve(this.dir(fontId));
    const full = resolve(dir, file);
    if (!full.startsWith(dir + sep)) throw new Error('font path escapes its directory');
    return full;
  }

  /** Whether a weight is already cached (so we never re-download). */
  async has(fontId: string, file: string): Promise<boolean> {
    try {
      await access(this.filePath(fontId, file));
      return true;
    } catch {
      return false;
    }
  }

  async write(fontId: string, file: string, data: Buffer): Promise<void> {
    const target = this.filePath(fontId, file); // validates before mkdir
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to the cache root
    await mkdir(this.dir(fontId), { recursive: true, mode: 0o750 });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated + confined above
    await writeFile(target, data);
  }

  /** Reads a cached woff2, or throws (ENOENT) if absent. */
  async read(fontId: string, file: string): Promise<Buffer> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated + confined above
    return readFile(this.filePath(fontId, file));
  }
}
