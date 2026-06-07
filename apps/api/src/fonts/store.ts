import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// On-disk store of self-hosted fonts. Layout: `<root>/<fontId>/<weight>[-italic].<ext>`. Used both
// for the INSTANCE Google cache (root = FONT_ROOT, shared across projects so a family downloads once)
// and for PROJECT-scoped uploaded fonts (root = FONT_ROOT/_projects/<projectId>). Both path segments
// are charset-validated and the resolved path is confined to the root, so traversal is impossible.

/** A path-safe font id (schema FontId / family slug). Exported so routes validate at their boundary. */
export const FONT_ID = /^[A-Za-z0-9_-]+$/;
/** A font file name: `<weight>[-italic].<ext>` (woff2/woff/ttf/otf). Exported so routes share it. */
export const FONT_FILE = /^[1-9]00(-italic)?\.(woff2|woff|ttf|otf)$/;

export class FontStore {
  constructor(private readonly root: string) {}

  private dir(fontId: string): string {
    if (!FONT_ID.test(fontId)) throw new Error('invalid font id');
    return join(this.root, fontId);
  }

  /** Absolute, confined path for a font file (or throws on an invalid/escaping segment). */
  private filePath(fontId: string, file: string): string {
    if (!FONT_FILE.test(file)) throw new Error('invalid font file');
    const dir = resolve(this.dir(fontId));
    const full = resolve(dir, file);
    if (!full.startsWith(dir + sep)) throw new Error('font path escapes its directory');
    return full;
  }

  /** Whether a file is already stored (so a google weight never re-downloads). */
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

  /** Reads a stored font file, or throws (ENOENT) if absent. */
  async read(fontId: string, file: string): Promise<Buffer> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated + confined above
    return readFile(this.filePath(fontId, file));
  }
}
