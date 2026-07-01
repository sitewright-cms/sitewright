import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';
import { api } from '../../api';
import { StockPicker } from '../media/StockPicker';
import { RecycleBinModal } from './RecycleBinModal';
import { FileTypeIcon, FolderIcon } from '../media/file-icons';
import { Modal } from '../ui/Modal';
import { SearchField } from '../ui/SearchField';
import { useDialogs } from '../ui/Dialogs';
import { SkeletonImage } from '../ui/Skeleton';
import { glassCard, glassPanel, ghostButton } from '../../theme';
import {
  sortAssets,
  sortFolders,
  folderBytes,
  matchesName,
  type SortKey,
  type SortState,
  type FolderEntry,
} from './sort';

/** Human-readable byte size (1 KB = 1024 B). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Immediate child folder segment of `path` relative to `base` ('' if not under base). */
function childSegment(path: string, base: string): string {
  if (base !== '' && !path.startsWith(`${base}/`)) return '';
  const rest = base === '' ? path : path.slice(base.length + 1);
  if (rest === '') return '';
  const slash = rest.indexOf('/');
  return slash === -1 ? rest : rest.slice(0, slash);
}

/** Only `[A-Za-z0-9 _-]` is a valid folder segment (matches MediaFolderSchema). */
function cleanSegment(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9 _-]+/g, '').trim();
}

/** A type filter for PICK mode: returns true for assets a field accepts. */
export type AcceptFilter = (asset: MediaAsset) => boolean;
/** Common accept filters per field kind. */
export const ACCEPT = {
  image: (a: MediaAsset) => a.kind === 'image',
  font: (a: MediaAsset) => a.kind === 'font',
  file: (a: MediaAsset) => a.kind === 'file',
  /** Any asset, regardless of kind — for a generic `file` field (PDFs, docs, zips, images, fonts…). */
  any: () => true,
};

/** A short type label per asset kind (the list view's Type column). */
const typeLabel = (m: MediaAsset): string =>
  m.kind === 'image' ? m.format : m.kind === 'font' ? `font · ${m.files.length}` : m.kind === 'stylesheet' ? 'stylesheet' : m.kind === 'script' ? 'script' : m.contentType;

// What's being dragged WITHIN the app (move). Held in a ref because dataTransfer can't be
// read during dragover, and the desktop-file case is detected via dataTransfer.files.
type DragItem = { type: 'asset'; id: string; from: string } | { type: 'folder'; path: string };

// Row-action glyphs.
const icon = (paths: ReactNode) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);
const RENAME_ICON = icon(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />);
const COPY_ICON = icon(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);
const DOWNLOAD_ICON = icon(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />);
const TRASH_ICON = icon(<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />);

const ACT = 'inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-900';
const ACT_DANGER = `${ACT} hover:bg-rose-50 hover:text-rose-600`;

export interface FileBrowserProps {
  projectId: string;
  /** 'manage' = full CRUD browser (the file manager); 'pick' = choose a file for a field. */
  mode?: 'manage' | 'pick';
  /** In pick mode, only assets passing this filter are shown + selectable (folders always show). */
  accept?: AcceptFilter;
  /** In pick mode, called when the user chooses a file. */
  onPick?: (asset: MediaAsset) => void;
  /** A short instruction shown above the browser (pick mode). */
  intro?: ReactNode;
}

/**
 * The reusable file/folder browser over the project media library: breadcrumb navigation, list/grid
 * views, upload, new-folder, rename/copy/delete (files + folders) and drag-to-move. Shared by the
 * Assets side panel (mode='manage') and the FilePicker modal (mode='pick', filtered by `accept`).
 */
export function FileBrowser({ projectId, mode = 'manage', accept, onPick, intro }: FileBrowserProps) {
  const pick = mode === 'pick';
  const { confirm, prompt, dialog } = useDialogs();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folderRecords, setFolderRecords] = useState<MediaFolderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(pick ? 'grid' : 'list');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // path being hovered (highlight)
  const fileInput = useRef<HTMLInputElement>(null);
  const dragItem = useRef<DragItem | null>(null);
  // Unique per instance — a FilePicker can render a second FileBrowser over the manager drawer.
  const uploadId = useId();

  async function load(isActive: () => boolean = () => true) {
    try {
      const [a, f] = await Promise.all([api.listMedia(projectId), api.listMediaFolders(projectId)]);
      if (!isActive()) return;
      setAssets(a.items);
      setFolderRecords(f.items);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load assets');
    }
  }

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [projectId]);

  const crumbs = folder === '' ? [] : folder.split('/');
  const pathOf = (seg: string) => (folder === '' ? seg : `${folder}/${seg}`);

  // A non-empty search is GLOBAL — results span every folder in the project, not just the current one.
  const searching = query.trim() !== '';

  // Files shown: when searching, every `accept`-matching asset across the project whose name matches;
  // otherwise the current folder's. Ordered by the active column.
  const here = useMemo(() => {
    let pool = searching ? assets : assets.filter((a) => a.folder === folder);
    if (pick && accept) pool = pool.filter(accept);
    if (searching) pool = pool.filter((a) => matchesName(query, a.filename));
    return sortAssets(pool, sort);
  }, [assets, folder, pick, accept, query, sort]);

  // Folders shown: when searching, EVERY folder in the project (records + asset folders + their
  // ancestors) whose own name matches — its `seg` is the FULL path so the result shows where it lives
  // and a click navigates straight there. Otherwise the current folder's direct children. Each entry
  // carries its recursive total size; folders are always rendered BEFORE files.
  const subfolders = useMemo<FolderEntry[]>(() => {
    if (searching) {
      const paths = new Set<string>();
      for (const f of folderRecords) paths.add(f.path);
      for (const a of assets) {
        const parts = a.folder ? a.folder.split('/') : [];
        for (let i = 1; i <= parts.length; i += 1) paths.add(parts.slice(0, i).join('/'));
      }
      const entries = [...paths]
        .filter((p) => p !== '' && matchesName(query, p.split('/').pop() ?? p))
        .map<FolderEntry>((path) => ({ seg: path, path, bytes: folderBytes(assets, path) }));
      return sortFolders(entries, sort);
    }
    const segs = new Set<string>();
    for (const a of assets) {
      const seg = childSegment(a.folder, folder);
      if (seg) segs.add(seg);
    }
    for (const f of folderRecords) {
      const seg = childSegment(f.path, folder);
      if (seg) segs.add(seg);
    }
    const entries: FolderEntry[] = [...segs].map((seg) => {
      const path = folder === '' ? seg : `${folder}/${seg}`;
      return { seg, path, bytes: folderBytes(assets, path) };
    });
    return sortFolders(entries, sort);
  }, [assets, folderRecords, folder, query, sort]);

  /** Navigate into a folder, clearing any active search so the new folder isn't silently filtered. */
  const goTo = (path: string) => {
    setFolder(path);
    setQuery('');
  };

  // Action aria-labels append the location while searching, so two same-named files surfaced from
  // different folders by a global search don't read identically to a screen reader.
  const actLabel = (verb: string, m: MediaAsset) =>
    searching ? `${verb} ${m.filename} in ${m.folder || 'Assets'}` : `${verb} ${m.filename}`;

  /** Click a column header: set the sort key, or flip direction when it's already active. */
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const sortArrow = (key: SortKey) =>
    sort.key === key ? <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span> : null;
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  /** Click a file: in pick mode select it; otherwise preview an image / open a file. */
  function activate(m: MediaAsset) {
    if (pick) return onPick?.(m);
    if (m.kind === 'image') setPreview(m);
    else window.open(m.url, '_blank', 'noopener,noreferrer');
  }

  // ---- uploads -------------------------------------------------------------
  async function uploadFiles(files: FileList | File[], target = folder) {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) await api.uploadMedia(projectId, file, target);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) await uploadFiles(e.target.files);
  }

  // ---- folder ops ----------------------------------------------------------
  async function createFolder(raw: string) {
    const name = cleanSegment(raw);
    if (!name) return;
    setError(null);
    try {
      await api.createMediaFolder(projectId, pathOf(name));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create folder');
    }
  }
  /** Opens the New-folder modal (a labelled prompt), then creates it in the current folder. */
  async function promptNewFolder() {
    const name = await prompt({ title: 'New folder', label: 'Folder name' });
    if (name) await createFolder(name);
  }
  /**
   * Downloads an asset via a blob so it ALWAYS triggers the browser's download dialog (an image would
   * otherwise open inline in a tab) and uses the asset's own `filename` as the suggested name (the raw
   * name never reaches an HTTP header — the download attribute is browser-sanitized). The blob buffers
   * the whole file in memory — fine for the library's images/PDFs/fonts; revisit if huge video lands.
   */
  async function downloadAsset(m: MediaAsset) {
    setError(null);
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = m.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed');
    }
  }
  async function renameFolder(seg: string) {
    const next = await prompt({ title: 'Rename folder', label: 'Folder name', initial: seg });
    if (!next) return;
    const name = cleanSegment(next);
    if (!name || name === seg) return;
    await run(() => api.renameMediaFolder(projectId, pathOf(seg), folder === '' ? name : `${folder}/${name}`));
  }
  async function copyFolder(seg: string) {
    await run(() => api.copyMediaFolder(projectId, pathOf(seg), pathOf(`${seg} copy`)));
  }
  async function deleteFolder(seg: string) {
    const path = pathOf(seg);
    const fileCount = assets.filter((a) => a.folder === path || a.folder.startsWith(`${path}/`)).length;
    const subCount = folderRecords.filter((f) => f.path.startsWith(`${path}/`)).length;
    const ok = await confirm({
      title: `Delete folder “${seg}”?`,
      message:
        fileCount === 0 && subCount === 0
          ? 'This empty folder will be removed.'
          : `This moves ${fileCount} file${fileCount === 1 ? '' : 's'}` +
            (subCount > 0 ? ` and ${subCount} subfolder${subCount === 1 ? '' : 's'}` : '') +
            ' to the Recycle Bin. You can restore them for 90 days.',
      confirmLabel: 'Delete all',
    });
    if (!ok) return;
    await run(() => api.deleteMediaFolder(projectId, path));
  }

  // ---- asset ops -----------------------------------------------------------
  async function renameAsset(m: MediaAsset) {
    const next = await prompt({ title: 'Rename file', label: 'Display name', initial: m.filename });
    if (!next || next === m.filename) return;
    await run(() => api.patchMedia(projectId, m.id, { filename: next }));
  }
  async function copyAsset(m: MediaAsset) {
    // Duplicate next to the source (its own folder), not the current browse folder — identical in
    // normal mode (m.folder === folder), but correct for a global-search result from another folder.
    await run(() => api.copyMedia(projectId, m.id, m.folder));
  }
  async function deleteAsset(m: MediaAsset) {
    if (!(await confirm({ title: 'Delete file', message: `Move “${m.filename}” to the Recycle Bin? You can restore it for 90 days.`, confirmLabel: 'Delete' }))) return;
    await run(() => api.deleteMedia(projectId, m.id));
  }

  /** Runs an op then reloads, surfacing any error inline. */
  async function run(op: () => Promise<unknown>) {
    setError(null);
    try {
      await op();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'operation failed');
    }
  }

  // ---- drag & drop ---------------------------------------------------------
  /** Moves whatever is being dragged INTO `target` (a folder path or '' for root). */
  async function moveDraggedInto(target: string) {
    const item = dragItem.current;
    dragItem.current = null;
    if (!item) return;
    if (item.type === 'asset') {
      if (item.from === target) return;
      await run(() => api.patchMedia(projectId, item.id, { folder: target }));
    } else {
      const last = item.path.split('/').pop()!;
      const to = target === '' ? last : `${target}/${last}`;
      if (to === item.path) return;
      await run(() => api.renameMediaFolder(projectId, item.path, to));
    }
  }
  /** Drop onto a target folder: desktop files upload there; an internal drag moves there. */
  function onDropInto(target: string, e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files, target);
    else void moveDraggedInto(target);
  }
  const allowDrop = (target: string) => (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(target);
  };

  const emptyMsg = query.trim()
    ? 'No files or folders match your search.'
    : pick
      ? 'No files here.'
      : 'This folder is empty. Drop files here to upload.';

  return (
    <div
      // The whole pane is a drop zone for the CURRENT folder (upload here / move here).
      onDragOver={allowDrop(folder)}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropTarget(null);
      }}
      onDrop={(e) => onDropInto(folder, e)}
    >
      {dialog}
      {intro && <p className="mb-3 text-sm text-slate-500">{intro}</p>}

      {/* Upload + stock toolbar */}
      <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 ${glassCard} p-4 ${dropTarget === folder ? 'sw-brand-ring' : ''}`}>
        <div className="flex flex-col gap-1">
          <label htmlFor={uploadId} className="text-xs font-bold text-slate-700">
            Upload files {dropTarget === folder ? '— drop to upload here' : '(or drag & drop)'}
          </label>
          <input id={uploadId} ref={fileInput} aria-label="Upload files" type="file" multiple disabled={uploading} onChange={onUpload} className="text-sm" />
          <p className="text-[11px] text-slate-400">
            Any file type. Images become AVIF/WebP; other files are stored as downloads.
            {folder && <> Filing into <strong>{folder}</strong>.</>}
            {uploading && <span className="ml-1 text-indigo-500">uploading…</span>}
          </p>
        </div>
        <button type="button" onClick={() => setStockOpen(true)} className={ghostButton}>
          Search stock images
        </button>
        <button type="button" onClick={() => setRecycleOpen(true)} className={ghostButton}>
          Recycle Bin
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {/* Breadcrumb + new folder + view toggle */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path" className="flex items-center gap-1 text-sm text-slate-600">
          <button
            type="button"
            onClick={() => goTo('')}
            onDragOver={allowDrop('')}
            onDrop={(e) => onDropInto('', e)}
            className={`rounded px-1.5 py-0.5 hover:bg-white/60 ${dropTarget === '' ? 'bg-indigo-100' : ''}`}
          >
            Assets
          </button>
          {crumbs.map((seg, i) => {
            const crumbPath = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={crumbPath} className="flex items-center gap-1">
                <span className="text-slate-300">/</span>
                <button
                  type="button"
                  onClick={() => goTo(crumbPath)}
                  onDragOver={allowDrop(crumbPath)}
                  onDrop={(e) => onDropInto(crumbPath, e)}
                  className={`rounded px-1.5 py-0.5 hover:bg-white/60 ${dropTarget === crumbPath ? 'bg-indigo-100' : ''}`}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <SearchField
            className="w-44"
            ariaLabel="Search assets by name"
            value={query}
            onChange={setQuery}
            placeholder="Search all folders"
          />
          {!pick && (
            <button type="button" onClick={() => void promptNewFolder()} className={`${ghostButton} px-3 py-1.5 text-sm`}>
              + New folder
            </button>
          )}
          <div className="flex overflow-hidden rounded-lg border border-white/60">
            {(['list', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-label={`${v} view`}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1.5 text-sm capitalize ${view === v ? 'bg-white text-slate-900' : 'bg-white/40 text-slate-500'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {searching && (
        <p className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <span>
            Searching <strong>all folders</strong> for “{query.trim()}”.
          </span>
          <button type="button" onClick={() => setQuery('')} className="rounded px-1.5 py-0.5 text-indigo-600 hover:bg-white/60">
            Clear
          </button>
        </p>
      )}

      {view === 'list' ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 font-medium" aria-sort={ariaSort('name')}>
                <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600">
                  Name {sortArrow('name')}
                </button>
              </th>
              <th className="py-1 font-medium" aria-sort={ariaSort('type')}>
                <button type="button" onClick={() => toggleSort('type')} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600">
                  Type {sortArrow('type')}
                </button>
              </th>
              <th className="py-1 text-right font-medium" aria-sort={ariaSort('size')}>
                <button type="button" onClick={() => toggleSort('size')} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600">
                  Size {sortArrow('size')}
                </button>
              </th>
              <th className="py-1 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subfolders.map(({ seg, path, bytes }) => (
              <tr
                key={`d:${seg}`}
                draggable={!pick}
                onDragStart={pick ? undefined : () => (dragItem.current = { type: 'folder', path })}
                onDragEnd={() => (dragItem.current = null)}
                onDragOver={allowDrop(path)}
                onDrop={(e) => onDropInto(path, e)}
                className={`border-t border-white/40 ${dropTarget === path ? 'bg-indigo-50' : ''}`}
              >
                <td className="py-2">
                  <button type="button" onClick={() => goTo(path)} className="flex items-center gap-2.5 text-base text-slate-700 hover:text-indigo-600">
                    <FolderIcon className="h-6 w-6 shrink-0 text-indigo-400" /> {seg}
                  </button>
                </td>
                <td className="py-2 text-slate-400">folder</td>
                <td className="py-2 text-right text-slate-500">{formatBytes(bytes)}</td>
                <td className="py-2">
                  {!pick && !searching && (
                    <div className="flex justify-end gap-0.5">
                      <button aria-label={`Rename ${seg}`} title="Rename" className={ACT} onClick={() => void renameFolder(seg)}>{RENAME_ICON}</button>
                      <button aria-label={`Copy ${seg}`} title="Copy" className={ACT} onClick={() => void copyFolder(seg)}>{COPY_ICON}</button>
                      <button aria-label={`Delete ${seg}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteFolder(seg)}>{TRASH_ICON}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {here.map((m) => (
              <tr
                key={m.id}
                draggable={!pick}
                onDragStart={pick ? undefined : () => (dragItem.current = { type: 'asset', id: m.id, from: m.folder })}
                onDragEnd={() => (dragItem.current = null)}
                className="border-t border-white/40"
              >
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => activate(m)}
                    className="flex items-center gap-2.5 text-left text-base text-slate-700 hover:text-indigo-600"
                    title={m.filename}
                  >
                    {m.kind === 'image' ? (
                      <SkeletonImage src={m.url} alt="" className="h-8 w-8 shrink-0 rounded" />
                    ) : (
                      <FileTypeIcon filename={m.filename} className="h-6 w-6 shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{m.filename}</span>
                      {searching && <span className="truncate text-xs text-slate-400">in {m.folder || 'Assets'}</span>}
                    </span>
                  </button>
                </td>
                <td className="py-2 text-slate-400">{typeLabel(m)}</td>
                <td className="py-2 text-right text-slate-500">{formatBytes(m.bytes)}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-0.5">
                    {pick ? (
                      <button aria-label={actLabel('Use', m)} title="Use this file" className={ACT} onClick={() => onPick?.(m)}>{DOWNLOAD_ICON}</button>
                    ) : (
                      <>
                        <button aria-label={actLabel('Download', m)} title="Download" className={ACT} onClick={() => void downloadAsset(m)}>{DOWNLOAD_ICON}</button>
                        <button aria-label={actLabel('Rename', m)} title="Rename" className={ACT} onClick={() => void renameAsset(m)}>{RENAME_ICON}</button>
                        <button aria-label={actLabel('Copy', m)} title="Copy" className={ACT} onClick={() => void copyAsset(m)}>{COPY_ICON}</button>
                        <button aria-label={actLabel('Delete', m)} title="Delete" className={ACT_DANGER} onClick={() => void deleteAsset(m)}>{TRASH_ICON}</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {subfolders.length === 0 && here.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-sm text-slate-400">{emptyMsg}</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {subfolders.map(({ seg, path, bytes }) => (
            <div
              key={`d:${seg}`}
              draggable={!pick}
              onDragStart={pick ? undefined : () => (dragItem.current = { type: 'folder', path })}
                onDragEnd={() => (dragItem.current = null)}
              onDragOver={allowDrop(path)}
              onDrop={(e) => onDropInto(path, e)}
              className={`group relative flex flex-col items-center gap-1 ${glassCard} p-3 text-center ${dropTarget === path ? 'sw-brand-ring' : ''}`}
            >
              <button type="button" onClick={() => goTo(path)} className="flex flex-col items-center gap-1">
                <FolderIcon className="h-10 w-10 text-indigo-400" />
                <span className="truncate text-sm text-slate-700" title={seg}>{seg}</span>
                <span className="text-[10px] text-slate-400">{formatBytes(bytes)}</span>
              </button>
              {!pick && !searching && (
                <div className="absolute right-1 top-1 hidden gap-0.5 rounded-lg bg-white/90 p-0.5 shadow group-hover:flex">
                  <button aria-label={`Rename ${seg}`} title="Rename" className={ACT} onClick={() => void renameFolder(seg)}>{RENAME_ICON}</button>
                  <button aria-label={`Delete ${seg}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteFolder(seg)}>{TRASH_ICON}</button>
                </div>
              )}
            </div>
          ))}
          {here.map((m) => (
            <figure
              key={m.id}
              draggable={!pick}
              onDragStart={pick ? undefined : () => (dragItem.current = { type: 'asset', id: m.id, from: m.folder })}
                onDragEnd={() => (dragItem.current = null)}
              className={`group relative ${glassCard} flex flex-col p-2`}
            >
              <button type="button" onClick={() => activate(m)} className="block">
                {m.kind === 'image' ? (
                  <SkeletonImage src={m.url} alt={m.alt ?? m.filename} className="h-24 w-full rounded" />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center rounded bg-white/40">
                    <FileTypeIcon filename={m.filename} className="h-10 w-10" />
                  </div>
                )}
                <figcaption className="mt-1 truncate text-sm text-slate-700" title={m.filename}>{m.filename}</figcaption>
                {searching && <span className="block truncate text-[10px] text-slate-400">in {m.folder || 'Assets'}</span>}
              </button>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">{formatBytes(m.bytes)}</span>
                <div className="hidden gap-0.5 group-hover:flex">
                  {pick ? (
                    <button aria-label={actLabel('Use', m)} title="Use this file" className={ACT} onClick={() => onPick?.(m)}>{DOWNLOAD_ICON}</button>
                  ) : (
                    <>
                      <button aria-label={actLabel('Download', m)} title="Download" className={ACT} onClick={() => void downloadAsset(m)}>{DOWNLOAD_ICON}</button>
                      <button aria-label={actLabel('Rename', m)} title="Rename" className={ACT} onClick={() => void renameAsset(m)}>{RENAME_ICON}</button>
                      <button aria-label={actLabel('Copy', m)} title="Copy" className={ACT} onClick={() => void copyAsset(m)}>{COPY_ICON}</button>
                      <button aria-label={actLabel('Delete', m)} title="Delete" className={ACT_DANGER} onClick={() => void deleteAsset(m)}>{TRASH_ICON}</button>
                    </>
                  )}
                </div>
              </div>
            </figure>
          ))}
          {subfolders.length === 0 && here.length === 0 && <p className="text-sm text-slate-400">{emptyMsg}</p>}
        </div>
      )}

      {stockOpen && (
        <Modal title={`Search stock images${folder ? ` → ${folder}` : ''}`} size="xl" onClose={() => setStockOpen(false)}>
          <div className="p-4">
            <StockPicker projectId={projectId} folder={folder} onImported={() => load()} bare />
          </div>
        </Modal>
      )}

      {recycleOpen && <RecycleBinModal projectId={projectId} onClose={() => setRecycleOpen(false)} onChanged={() => void load()} />}

      {/* In-app image preview (replaces opening images in a new tab). */}
      {preview && preview.kind === 'image' && (
        <Modal title={preview.filename} size="xl" onClose={() => setPreview(null)}>
          <div className="flex flex-col items-center gap-3 p-4">
            <img src={preview.url} alt={preview.alt ?? preview.filename} className="max-h-[70vh] w-auto rounded-lg shadow-lg" />
            <div className="flex w-full items-center justify-between text-xs text-slate-500">
              <span>
                {preview.format} · {preview.width}×{preview.height} · {formatBytes(preview.bytes)}
              </span>
              <a href={preview.url} target="_blank" rel="noreferrer" className={`${ghostButton} px-3 py-1`}>
                Open original
              </a>
            </div>
            {preview.attribution && (
              <p className={`w-full text-[11px] text-slate-400 ${glassPanel} p-2`}>
                {preview.attribution.provider} · {preview.attribution.author} · {preview.attribution.license}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
