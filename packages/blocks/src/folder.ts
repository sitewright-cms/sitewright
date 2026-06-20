// {{#sw-folder}} support: select + project a project's media files for iteration in a page template
// (image galleries, file lists). The render context carries a SLIM media projection (RenderMedia, no
// LQIP/variants/bytes) so the per-render IPC payload stays light; the helper itself lives in template.ts.
import type { MediaAsset } from '@sitewright/schema';

/** The lean media projection placed on the render context — the only fields {{#sw-folder}} needs. */
export interface RenderMedia {
  /** Virtual folder path the asset is filed under ('' = root). */
  folder: string;
  kind: 'image' | 'file' | 'font';
  filename: string;
  /** `/media/<slug>/<id>/<file>` — rebased to `_assets/…` at publish (build.ts), live in preview. */
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export type FolderKind = 'image' | 'file' | 'all';
export type FolderSort = 'name' | 'name-desc';

/** Slim a project's media list for the render context (drops placeholder / variants / bytes / etc.). */
export function mediaForRender(media: readonly MediaAsset[]): RenderMedia[] {
  // `stylesheet`/`script` assets are importer implementation details (linked CSS/JS), not pickable media.
  return media
    .filter((a): a is Exclude<MediaAsset, { kind: 'stylesheet' | 'script' }> => a.kind !== 'stylesheet' && a.kind !== 'script')
    .map((a) => {
      const out: RenderMedia = { folder: a.folder, kind: a.kind, filename: a.filename, url: a.url };
      if (a.kind === 'image') {
        if (typeof a.alt === 'string') out.alt = a.alt;
        out.width = a.width;
        out.height = a.height;
      }
      return out;
    });
}

/** Trim leading/trailing slashes from a folder-path argument; non-strings → '' (the root). */
function normFolder(path: unknown): string {
  return typeof path === 'string' ? path.replace(/^\/+|\/+$/g, '') : '';
}

/**
 * Select the media filed under `path` — the EXACT folder, or its descendants when `recursive` — filtered
 * by kind and sorted by filename. `path` '' (or non-string) = the media root. Subfolder paths like
 * `"documents/projectA"` are matched verbatim. Fonts are never folder content (not gallery/file material).
 */
export function selectFolderAssets(
  media: readonly RenderMedia[],
  path: unknown,
  opts: { kind?: FolderKind; recursive?: boolean; sort?: FolderSort } = {},
): RenderMedia[] {
  const folder = normFolder(path);
  const recursive = opts.recursive === true;
  const kind: FolderKind = opts.kind === 'file' || opts.kind === 'all' ? opts.kind : 'image';
  const inFolder = (f: string): boolean =>
    recursive ? folder === '' || f === folder || f.startsWith(`${folder}/`) : f === folder;
  const matchesKind = (a: RenderMedia): boolean => (kind === 'all' ? a.kind !== 'font' : a.kind === kind);
  const out = (media ?? []).filter((a) => inFolder(a.folder) && matchesKind(a));
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  if (opts.sort === 'name-desc') out.reverse();
  return out;
}

/** The shape bound to the block body for each iterated asset (`this` inside {{#sw-folder}}). */
export interface FolderItem {
  url: string;
  filename: string;
  kind: 'image' | 'file' | 'font';
  alt: string;
  width?: number;
  height?: number;
}

export function projectFolderItem(a: RenderMedia): FolderItem {
  const item: FolderItem = { url: a.url, filename: a.filename, kind: a.kind, alt: a.alt ?? '' };
  if (typeof a.width === 'number') item.width = a.width;
  if (typeof a.height === 'number') item.height = a.height;
  return item;
}
