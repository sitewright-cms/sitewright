import type { Dirent, Stats } from 'node:fs';
import { lstat, opendir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * How much the data folder holds, for the System-Settings "Storage & backups" panel. Sizes are the files' own
 * sizes in bytes (what a file listing shows), summed over every file under the folder.
 */
export interface DataFolderUsage {
  /** Everything under the data folder: database, statistics, snapshots, media, builds and anything else. */
  totalBytes: number;
  /** Uploaded files and their generated variants (`media/`). */
  mediaBytes: number;
  /** Made again when needed: published builds, previews and import captures (`sites/`, `preview/`, `source-refs/`). */
  buildsBytes: number;
  /** The walk stopped at its time or entry limit: each figure is then at least what it says. */
  partial: boolean;
}

/**
 * A large instance has hundreds of thousands of files: the walk answers within `deadlineMs` and looks at no more than
 * `maxEntries`, reporting what it counted so far as `partial`.
 */
export const DATA_USAGE_LIMITS = { deadlineMs: 10_000, maxEntries: 2_000_000 } as const;

/** How long one walk's figures are handed to later callers, counted from when it began. */
export const DATA_FOLDER_REUSE_MS = 30_000;

/** The sub-folders `config.ts` derives from the data folder (keep the two in step). */
const MEDIA_DIR = 'media';
const BUILD_DIRS = new Set(['sites', 'preview', 'source-refs']);

/** Sizes read at once within one folder: enough to keep the disk busy, few enough to keep file handles low. */
const STAT_BATCH = 64;

interface Budget {
  readonly deadline: number;
  readonly maxEntries: number;
  entries: number;
  partial: boolean;
}

function spent(budget: Budget): boolean {
  if (budget.entries >= budget.maxEntries || Date.now() >= budget.deadline) budget.partial = true;
  return budget.partial;
}

/**
 * The bytes of every file under `root`. A link inside the tree is not followed (it may point back up the tree, or
 * off the volume), and a folder that vanishes or cannot be read mid-walk counts as empty.
 */
async function treeBytes(root: string, budget: Budget): Promise<number> {
  let bytes = 0;
  const dirs = [root];
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    let batch: Dirent[] = [];
    try {
      // Listed in pieces, not all at once: one project's media folder can hold hundreds of thousands of files, and
      // the limits must stop the walk inside it. Leaving the loop early closes the folder.
      for await (const entry of await opendir(dir, { bufferSize: STAT_BATCH })) {
        batch.push(entry);
        if (batch.length < STAT_BATCH) continue;
        if (spent(budget)) return bytes;
        bytes += await batchBytes(dir, batch, dirs, budget);
        batch = [];
      }
    } catch {
      // The folder vanished or cannot be read: what was listed of it still counts.
    }
    if (batch.length > 0) {
      if (spent(budget)) return bytes;
      bytes += await batchBytes(dir, batch, dirs, budget);
    }
  }
  return bytes;
}

/** The bytes of the files in one batch of a folder's entries; its sub-folders are queued on `dirs`. */
async function batchBytes(dir: string, batch: readonly Dirent[], dirs: string[], budget: Budget): Promise<number> {
  budget.entries += batch.length;
  const sizes = await Promise.all(
    batch.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(path);
        return 0;
      }
      if (!entry.isFile()) return 0;
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the trusted data dir
        return (await lstat(path)).size;
      } catch {
        return 0; // raced away
      }
    }),
  );
  return sizes.reduce((sum, n) => sum + n, 0);
}

/**
 * Walks the data folder once and sums it by area. A link directly in the data folder IS followed: that is the
 * documented way to keep one sub-folder (say `media`) on another disk, and its bytes are still the instance's.
 */
export async function dataFolderUsage(
  dataDir: string,
  limits: { deadlineMs: number; maxEntries: number } = DATA_USAGE_LIMITS,
): Promise<DataFolderUsage> {
  const budget: Budget = { deadline: Date.now() + limits.deadlineMs, maxEntries: limits.maxEntries, entries: 0, partial: false };
  let top: Dirent[];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the trusted data dir
    top = await readdir(dataDir, { withFileTypes: true });
  } catch {
    return { totalBytes: 0, mediaBytes: 0, buildsBytes: 0, partial: false };
  }
  let totalBytes = 0;
  let mediaBytes = 0;
  let buildsBytes = 0;
  for (const entry of top) {
    if (spent(budget)) break;
    budget.entries += 1;
    const path = join(dataDir, entry.name);
    let info: Stats;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the trusted data dir
      info = await stat(path);
    } catch {
      continue; // a dangling link, or raced away
    }
    const bytes = info.isDirectory() ? await treeBytes(path, budget) : info.isFile() ? info.size : 0;
    totalBytes += bytes;
    if (entry.name === MEDIA_DIR) mediaBytes += bytes;
    else if (BUILD_DIRS.has(entry.name)) buildsBytes += bytes;
  }
  return { totalBytes, mediaBytes, buildsBytes, partial: budget.partial };
}
