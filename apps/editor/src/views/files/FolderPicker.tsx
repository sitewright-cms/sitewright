import { useEffect, useMemo, useState } from 'react';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';
import { api } from '../../api';
import { FolderIcon } from '../media/file-icons';
import { Modal } from '../ui/Modal';
import { SearchField } from '../ui/SearchField';
import { matchesName } from './sort';
import { glassCard } from '../../theme';

/** Every folder PATH known to the project: explicit folder records + the ancestor path of each
 *  asset's folder (an asset can sit in a folder that was never recorded). Sorted, root ('') excluded
 *  — the picker offers root separately. */
function allFolderPaths(folders: readonly MediaFolderRecord[], assets: readonly MediaAsset[]): string[] {
  const paths = new Set<string>();
  for (const f of folders) paths.add(f.path);
  for (const a of assets) {
    const parts = a.folder ? a.folder.split('/') : [];
    for (let i = 1; i <= parts.length; i += 1) paths.add(parts.slice(0, i).join('/'));
  }
  paths.delete('');
  return [...paths].sort((x, y) => x.localeCompare(y));
}

/** Recursive asset count per folder PATH, in a single pass: each asset increments its own folder and
 *  every ancestor (so a parent folder reads as non-empty). One scan instead of an O(folders × assets)
 *  per-row count during render. */
function fileCountsByPath(assets: readonly MediaAsset[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of assets) {
    if (!a.folder) continue;
    const parts = a.folder.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const p = parts.slice(0, i).join('/');
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * A modal picker that returns a media-library FOLDER PATH for a `folder`-typed field — the folder
 * sibling of {@link FilePicker}. Lists every folder in the project (sorted, searchable), plus a root
 * option, and calls `onPick` with the chosen path ('' = root). Read-only: folder CRUD stays in the
 * Assets panel (the FileBrowser), so this surface is just selection.
 */
export function FolderPicker({
  projectId,
  title = 'Choose a folder',
  onPick,
  onClose,
}: {
  projectId: string;
  title?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folders, setFolders] = useState<MediaFolderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [a, f] = await Promise.all([api.listMedia(projectId), api.listMediaFolders(projectId)]);
        if (!active) return;
        setAssets(a.items);
        setFolders(f.items);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load folders');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const paths = useMemo(() => allFolderPaths(folders, assets), [folders, assets]);
  const shown = useMemo(() => paths.filter((p) => matchesName(query, p)), [paths, query]);
  const counts = useMemo(() => fileCountsByPath(assets), [assets]);

  function choose(path: string) {
    onPick(path);
    onClose();
  }

  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      headerExtra={<SearchField className="w-44" ariaLabel="Search folders by path" value={query} onChange={setQuery} placeholder="Search folders" />}
    >
      <div className="flex flex-col gap-2 p-5">
        <p className="text-sm text-slate-500">Pick a media-library folder. The field stores its path, e.g. <code className="rounded bg-slate-100 px-1">gallery/team</code>.</p>

        {/* Root option — selects the whole library (path ''). */}
        <button
          type="button"
          aria-label="Use root folder (all files)"
          onClick={() => choose('')}
          className={`${glassCard} flex w-full items-center gap-3 p-3 text-left transition hover:border-indigo-400 hover:bg-white`}
        >
          <FolderIcon className="h-6 w-6 shrink-0 text-indigo-400" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-slate-700">Assets (root)</span>
            <span className="text-[11px] text-slate-400">All files · top-level folder</span>
          </span>
        </button>

        {error ? (
          <p className="py-3 text-sm text-rose-600">{error}</p>
        ) : loading ? (
          <p className="py-3 text-sm text-slate-400">Loading folders…</p>
        ) : paths.length === 0 ? (
          <p className="py-3 text-sm text-slate-400">No folders yet. Create folders in the Assets panel, then pick one here.</p>
        ) : shown.length === 0 ? (
          <p className="py-3 text-sm text-slate-400">No folders match “{query.trim()}”.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((path) => {
              const count = counts.get(path) ?? 0;
              return (
                <li key={path}>
                  <button
                    type="button"
                    aria-label={`Use folder ${path}`}
                    onClick={() => choose(path)}
                    className={`${glassCard} flex w-full items-center gap-3 p-2.5 text-left transition hover:border-indigo-400 hover:bg-white`}
                  >
                    <FolderIcon className="h-6 w-6 shrink-0 text-indigo-400" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-slate-700" title={path}>{path}</span>
                      <span className="text-[11px] text-slate-400">{count} file{count === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
