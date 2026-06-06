import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';
import { api, type Project } from '../api';
import { StockPicker } from './media/StockPicker';
import { FileTypeIcon, FolderIcon } from './media/file-icons';
import { Modal } from './ui/Modal';
import { useDialogs } from './ui/Dialogs';
import { glassCard, glassPanel, ghostButton } from '../theme';

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

export function MediaManager({ project }: { project: Project }) {
  const { confirm, prompt, dialog } = useDialogs();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folderRecords, setFolderRecords] = useState<MediaFolderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list'); // list is the default
  const [newFolder, setNewFolder] = useState('');
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // path being hovered (highlight)
  const fileInput = useRef<HTMLInputElement>(null);
  const dragItem = useRef<DragItem | null>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const [a, f] = await Promise.all([api.listMedia(project.id), api.listMediaFolders(project.id)]);
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
  }, [project.id]);

  // Assets in the current folder; subfolders = union of asset-derived + persisted records.
  const here = useMemo(() => assets.filter((a) => a.folder === folder), [assets, folder]);
  const subfolders = useMemo(() => {
    const segs = new Set<string>();
    for (const a of assets) {
      const seg = childSegment(a.folder, folder);
      if (seg) segs.add(seg);
    }
    for (const f of folderRecords) {
      const seg = childSegment(f.path, folder);
      if (seg) segs.add(seg);
    }
    return [...segs].sort((a, b) => a.localeCompare(b));
  }, [assets, folderRecords, folder]);

  const crumbs = folder === '' ? [] : folder.split('/');
  const pathOf = (seg: string) => (folder === '' ? seg : `${folder}/${seg}`);

  // ---- uploads -------------------------------------------------------------
  async function uploadFiles(files: FileList | File[], target = folder) {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) await api.uploadMedia(project.id, file, target);
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
  async function createFolder() {
    const name = cleanSegment(newFolder);
    if (!name) return;
    setError(null);
    try {
      await api.createMediaFolder(project.id, pathOf(name));
      setNewFolder('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create folder');
    }
  }
  async function renameFolder(seg: string) {
    const next = await prompt({ title: 'Rename folder', label: 'Folder name', initial: seg });
    if (!next) return;
    const name = cleanSegment(next);
    if (!name || name === seg) return;
    await run(() => api.renameMediaFolder(project.id, pathOf(seg), folder === '' ? name : `${folder}/${name}`));
  }
  async function copyFolder(seg: string) {
    await run(() => api.copyMediaFolder(project.id, pathOf(seg), pathOf(`${seg} copy`)));
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
          : `This permanently deletes ${fileCount} file${fileCount === 1 ? '' : 's'}` +
            (subCount > 0 ? ` and ${subCount} subfolder${subCount === 1 ? '' : 's'}` : '') +
            ' inside it.',
      confirmLabel: 'Delete all',
    });
    if (!ok) return;
    await run(() => api.deleteMediaFolder(project.id, path));
  }

  // ---- asset ops -----------------------------------------------------------
  async function renameAsset(m: MediaAsset) {
    const next = await prompt({ title: 'Rename file', label: 'Display name', initial: m.filename });
    if (!next || next === m.filename) return;
    await run(() => api.patchMedia(project.id, m.id, { filename: next }));
  }
  async function copyAsset(m: MediaAsset) {
    await run(() => api.copyMedia(project.id, m.id, folder));
  }
  async function deleteAsset(m: MediaAsset) {
    if (!(await confirm({ title: 'Delete file', message: `Delete “${m.filename}”? This cannot be undone.`, confirmLabel: 'Delete' }))) return;
    await run(() => api.deleteMedia(project.id, m.id));
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
      await run(() => api.patchMedia(project.id, item.id, { folder: target }));
    } else {
      const last = item.path.split('/').pop()!;
      const to = target === '' ? last : `${target}/${last}`;
      if (to === item.path) return;
      await run(() => api.renameMediaFolder(project.id, item.path, to));
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

      {/* Upload + stock toolbar */}
      <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 ${glassCard} p-4 ${dropTarget === folder ? 'ring-2 ring-indigo-400' : ''}`}>
        <div className="flex flex-col gap-1">
          <label htmlFor="asset-upload" className="text-xs font-semibold text-slate-700">
            Upload files {dropTarget === folder ? '— drop to upload here' : '(or drag & drop)'}
          </label>
          <input id="asset-upload" ref={fileInput} aria-label="Upload files" type="file" multiple disabled={uploading} onChange={onUpload} className="text-sm" />
          <p className="text-[11px] text-slate-400">
            Any file type. Images become AVIF/WebP; other files are stored as downloads.
            {folder && <> Filing into <strong>{folder}</strong>.</>}
            {uploading && <span className="ml-1 text-indigo-500">uploading…</span>}
          </p>
        </div>
        <button type="button" onClick={() => setStockOpen(true)} className={ghostButton}>
          Search stock images
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {/* Breadcrumb + new folder + view toggle */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path" className="flex items-center gap-1 text-sm text-slate-600">
          <button
            type="button"
            onClick={() => setFolder('')}
            onDragOver={allowDrop('')}
            onDrop={(e) => onDropInto('', e)}
            className={`rounded px-1.5 py-0.5 hover:bg-white/60 ${dropTarget === '' ? 'bg-indigo-100' : ''}`}
          >
            Assets
          </button>
          {crumbs.map((seg, i) => {
            const crumbPath = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={i} className="flex items-center gap-1">
                <span className="text-slate-300">/</span>
                <button
                  type="button"
                  onClick={() => setFolder(crumbPath)}
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
          <input
            aria-label="New folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createFolder()}
            placeholder="New folder"
            className="w-32 rounded-lg border border-white/60 bg-white/60 px-2 py-1 text-xs"
          />
          <button type="button" onClick={() => void createFolder()} className={`${ghostButton} px-2 py-1 text-xs`}>
            + Folder
          </button>
          <div className="flex overflow-hidden rounded-lg border border-white/60">
            {(['list', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-label={`${v} view`}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-2 py-1 text-xs capitalize ${view === v ? 'bg-white text-slate-900' : 'bg-white/40 text-slate-500'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 font-medium">Name</th>
              <th className="py-1 font-medium">Type</th>
              <th className="py-1 text-right font-medium">Size</th>
              <th className="py-1 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subfolders.map((seg) => (
              <tr
                key={`d:${seg}`}
                draggable
                onDragStart={() => (dragItem.current = { type: 'folder', path: pathOf(seg) })}
                onDragEnd={() => (dragItem.current = null)}
                onDragOver={allowDrop(pathOf(seg))}
                onDrop={(e) => onDropInto(pathOf(seg), e)}
                className={`border-t border-white/40 ${dropTarget === pathOf(seg) ? 'bg-indigo-50' : ''}`}
              >
                <td className="py-1.5">
                  <button type="button" onClick={() => setFolder(pathOf(seg))} className="flex items-center gap-2 text-slate-700 hover:text-indigo-600">
                    <FolderIcon className="h-5 w-5" /> {seg}
                  </button>
                </td>
                <td className="py-1.5 text-slate-400">folder</td>
                <td className="py-1.5 text-right text-slate-400">—</td>
                <td className="py-1.5">
                  <div className="flex justify-end gap-0.5">
                    <button aria-label={`Rename ${seg}`} title="Rename" className={ACT} onClick={() => void renameFolder(seg)}>{RENAME_ICON}</button>
                    <button aria-label={`Copy ${seg}`} title="Copy" className={ACT} onClick={() => void copyFolder(seg)}>{COPY_ICON}</button>
                    <button aria-label={`Delete ${seg}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteFolder(seg)}>{TRASH_ICON}</button>
                  </div>
                </td>
              </tr>
            ))}
            {here.map((m) => (
              <tr
                key={m.id}
                draggable
                onDragStart={() => (dragItem.current = { type: 'asset', id: m.id, from: m.folder })}
                onDragEnd={() => (dragItem.current = null)}
                className="border-t border-white/40"
              >
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => (m.kind === 'image' ? setPreview(m) : window.open(m.url, '_blank', 'noopener,noreferrer'))}
                    className="flex items-center gap-2 text-left text-slate-700 hover:text-indigo-600"
                    title={m.filename}
                  >
                    {m.kind === 'image' ? (
                      <img src={m.url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" loading="lazy" />
                    ) : (
                      <FileTypeIcon filename={m.filename} className="h-5 w-5 shrink-0" />
                    )}
                    <span className="truncate">{m.filename}</span>
                  </button>
                </td>
                <td className="py-1.5 text-slate-400">{m.kind === 'image' ? m.format : m.contentType}</td>
                <td className="py-1.5 text-right text-slate-500">{formatBytes(m.bytes)}</td>
                <td className="py-1.5">
                  <div className="flex justify-end gap-0.5">
                    <a aria-label={`Download ${m.filename}`} title="Download" className={ACT} href={m.url} target="_blank" rel="noreferrer">{DOWNLOAD_ICON}</a>
                    <button aria-label={`Rename ${m.filename}`} title="Rename" className={ACT} onClick={() => void renameAsset(m)}>{RENAME_ICON}</button>
                    <button aria-label={`Copy ${m.filename}`} title="Copy" className={ACT} onClick={() => void copyAsset(m)}>{COPY_ICON}</button>
                    <button aria-label={`Delete ${m.filename}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteAsset(m)}>{TRASH_ICON}</button>
                  </div>
                </td>
              </tr>
            ))}
            {subfolders.length === 0 && here.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-sm text-slate-400">This folder is empty. Drop files here to upload.</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {subfolders.map((seg) => (
            <div
              key={`d:${seg}`}
              draggable
              onDragStart={() => (dragItem.current = { type: 'folder', path: pathOf(seg) })}
                onDragEnd={() => (dragItem.current = null)}
              onDragOver={allowDrop(pathOf(seg))}
              onDrop={(e) => onDropInto(pathOf(seg), e)}
              className={`group relative flex flex-col items-center gap-1 ${glassCard} p-3 text-center ${dropTarget === pathOf(seg) ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <button type="button" onClick={() => setFolder(pathOf(seg))} className="flex flex-col items-center gap-1">
                <FolderIcon className="h-8 w-8" />
                <span className="truncate text-[11px] text-slate-600" title={seg}>{seg}</span>
              </button>
              <div className="absolute right-1 top-1 hidden gap-0.5 rounded-lg bg-white/90 p-0.5 shadow group-hover:flex">
                <button aria-label={`Rename ${seg}`} title="Rename" className={ACT} onClick={() => void renameFolder(seg)}>{RENAME_ICON}</button>
                <button aria-label={`Delete ${seg}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteFolder(seg)}>{TRASH_ICON}</button>
              </div>
            </div>
          ))}
          {here.map((m) => (
            <figure
              key={m.id}
              draggable
              onDragStart={() => (dragItem.current = { type: 'asset', id: m.id, from: m.folder })}
                onDragEnd={() => (dragItem.current = null)}
              className={`group relative ${glassCard} flex flex-col p-2`}
            >
              <button type="button" onClick={() => (m.kind === 'image' ? setPreview(m) : window.open(m.url, '_blank', 'noopener,noreferrer'))} className="block">
                {m.kind === 'image' ? (
                  <img src={m.url} alt={m.alt ?? m.filename} className="h-24 w-full rounded object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center rounded bg-white/40">
                    <FileTypeIcon filename={m.filename} className="h-10 w-10" />
                  </div>
                )}
                <figcaption className="mt-1 truncate text-[11px] text-slate-600" title={m.filename}>{m.filename}</figcaption>
              </button>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">{formatBytes(m.bytes)}</span>
                <div className="hidden gap-0.5 group-hover:flex">
                  <button aria-label={`Rename ${m.filename}`} title="Rename" className={ACT} onClick={() => void renameAsset(m)}>{RENAME_ICON}</button>
                  <button aria-label={`Copy ${m.filename}`} title="Copy" className={ACT} onClick={() => void copyAsset(m)}>{COPY_ICON}</button>
                  <button aria-label={`Delete ${m.filename}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteAsset(m)}>{TRASH_ICON}</button>
                </div>
              </div>
            </figure>
          ))}
          {subfolders.length === 0 && here.length === 0 && <p className="text-sm text-slate-400">This folder is empty. Drop files here to upload.</p>}
        </div>
      )}

      {stockOpen && (
        <Modal title={`Search stock images${folder ? ` → ${folder}` : ''}`} size="xl" onClose={() => setStockOpen(false)}>
          <div className="p-4">
            <StockPicker projectId={project.id} folder={folder} onImported={() => load()} bare />
          </div>
        </Modal>
      )}

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
