import type { MediaAsset } from '@sitewright/schema';

export type SortKey = 'name' | 'type' | 'size';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** A subfolder of the current folder, carrying its recursive total size. */
export interface FolderEntry {
  seg: string;
  path: string;
  bytes: number;
}

/** The Type-column sort value for an asset (image → format, font → 'font', else MIME type). */
export function assetType(m: MediaAsset): string {
  return m.kind === 'image' ? m.format : m.kind === 'font' ? 'font' : m.contentType;
}

/** Total bytes of every asset filed directly in `path` or any descendant folder. */
export function folderBytes(assets: readonly MediaAsset[], path: string): number {
  const prefix = `${path}/`;
  let total = 0;
  for (const a of assets) if (a.folder === path || a.folder.startsWith(prefix)) total += a.bytes;
  return total;
}

/** Case-insensitive substring match — the asset/folder name search (empty query matches all). */
export function matchesName(query: string, name: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || name.toLowerCase().includes(q);
}

const flip = (dir: SortDir): number => (dir === 'asc' ? 1 : -1);

/** Sorts assets by the active column, with the filename as a stable tiebreaker. */
export function sortAssets(assets: readonly MediaAsset[], { key, dir }: SortState): MediaAsset[] {
  const m = flip(dir);
  return [...assets].sort((a, b) => {
    const primary =
      key === 'size'
        ? a.bytes - b.bytes
        : key === 'type'
          ? assetType(a).localeCompare(assetType(b))
          : a.filename.localeCompare(b.filename);
    // Direction flips the primary key only; the filename tiebreak stays ascending (stable UX).
    return primary !== 0 ? m * primary : a.filename.localeCompare(b.filename);
  });
}

/** Sorts folder entries: by total size for the `size` column, else by name (name + type columns). */
export function sortFolders(folders: readonly FolderEntry[], { key, dir }: SortState): FolderEntry[] {
  const m = flip(dir);
  return [...folders].sort((a, b) => {
    const primary = key === 'size' ? a.bytes - b.bytes : a.seg.localeCompare(b.seg);
    return primary !== 0 ? m * primary : a.seg.localeCompare(b.seg);
  });
}
