// Pure path math for the VIRTUAL media folder tree. Folder paths are slash-delimited
// (validated by MediaFolderSchema); '' is the root (no record). These helpers back the
// folder create/rename/move/copy/delete operations and are unit-tested in isolation.

/** Whether `itemPath` is AT or BELOW `folder` (folder '' matches everything). */
export function isUnderFolder(itemPath: string, folder: string): boolean {
  if (folder === '') return true;
  return itemPath === folder || itemPath.startsWith(`${folder}/`);
}

/** Re-roots a path from under `from` to under `to` (e.g. 'A/B/x' with A→C → 'C/B/x'). */
export function reparentPath(itemPath: string, from: string, to: string): string {
  // `from` is '' only for the (record-less) root, which is never renamed; callers pass non-''.
  if (itemPath === from) return to;
  return to + itemPath.slice(from.length);
}

/** Every ancestor path of `path`, root-first: 'A/B/C' → ['A','A/B'] (excludes `path` itself). */
export function ancestorPaths(path: string): string[] {
  const segs = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'));
  return out;
}

/**
 * Validates a folder rename/move from `from` to `to`. Returns an error message or null.
 * Rejects no-ops and moving a folder into itself or one of its own descendants (which
 * would orphan the subtree).
 */
export function validateFolderMove(from: string, to: string): string | null {
  if (from === '' || to === '') return 'a folder path must not be empty';
  if (from === to) return 'the source and destination are the same';
  if (isUnderFolder(to, from)) return 'cannot move a folder into itself';
  return null;
}
