// What the File Manager says when a folder rename/move could not re-file every asset under it.
//
// The server re-roots the folder and then re-files its assets one at a time; one it cannot get to (say,
// another write kept landing on it) stays under the OLD folder name and is reported in `failed`. The
// editor used to read only `ok`, so that partial move looked exactly like a success.

/** One asset the server could not re-file. */
export interface FolderMoveFailure {
  id: string;
  error: string;
}

/** How many failed files are named before the rest are only counted. */
const NAMED = 3;

/**
 * The message for a folder move that left `failed` behind — naming the files (by the library's own
 * names, else their ids) and saying to try again — or null when everything moved.
 */
export function folderMoveFailure(
  failed: readonly FolderMoveFailure[],
  assets: readonly { id: string; filename: string }[],
): string | null {
  if (failed.length === 0) return null;
  const nameOf = new Map(assets.map((a) => [a.id, a.filename]));
  const names = failed.slice(0, NAMED).map((f) => nameOf.get(f.id) ?? f.id).join(', ');
  const rest = failed.length > NAMED ? ` and ${failed.length - NAMED} more` : '';
  const n = failed.length;
  return `${n} file${n === 1 ? '' : 's'} could not be moved — try again (${names}${rest}).`;
}
