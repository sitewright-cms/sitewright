import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { MediaAsset } from '@sitewright/schema';
import { api, type Project } from '../api';
import { StockPicker } from './media/StockPicker';
import { Modal } from './ui/Modal';
import { glassCard, fieldLabel, dangerButton, ghostButton } from '../theme';

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

/** The immediate child folder segment of `path` relative to `base` ('' if `path` is not under base). */
function childSegment(path: string, base: string): string {
  if (base !== '' && !path.startsWith(`${base}/`)) return '';
  const rest = base === '' ? path : path.slice(base.length + 1);
  if (rest === '') return '';
  const slash = rest.indexOf('/');
  return slash === -1 ? rest : rest.slice(0, slash);
}

function FileIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-8 w-8 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />
    </svg>
  );
}

export function MediaManager({ project }: { project: Project }) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [dragging, setDragging] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  // Folders created this session that hold no asset yet (virtual folders only exist via an asset).
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listMedia(project.id);
      if (isActive()) setAssets(res.items);
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

  // Assets in the current folder, and the set of immediate subfolders to drill into.
  const here = useMemo(() => assets.filter((a) => a.folder === folder), [assets, folder]);
  const subfolders = useMemo(() => {
    const segs = new Set<string>();
    for (const a of assets) {
      const seg = childSegment(a.folder, folder);
      if (seg) segs.add(seg);
    }
    for (const f of extraFolders) {
      const seg = childSegment(f, folder);
      if (seg) segs.add(seg);
    }
    return [...segs].sort((a, b) => a.localeCompare(b));
  }, [assets, extraFolders, folder]);

  const crumbs = folder === '' ? [] : folder.split('/');

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await api.uploadMedia(project.id, file, folder);
      }
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

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteMedia(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete asset');
    }
  }

  function enterFolder(seg: string) {
    setFolder(folder === '' ? seg : `${folder}/${seg}`);
  }
  function goToCrumb(index: number) {
    setFolder(index < 0 ? '' : crumbs.slice(0, index + 1).join('/'));
  }
  function addFolder() {
    const name = newFolder.trim().replace(/[^A-Za-z0-9 _-]+/g, '');
    if (!name) return;
    const path = folder === '' ? name : `${folder}/${name}`;
    setExtraFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setNewFolder('');
    setFolder(path);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className={`mb-4 flex flex-col gap-2 ${glassCard} p-4 ${dragging ? 'ring-2 ring-indigo-400' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="asset-upload" className={fieldLabel}>
            Upload files {dragging ? '— drop to upload' : '(or drag & drop)'}
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStockOpen(true)} className={ghostButton}>
              Search stock images
            </button>
          </div>
        </div>
        <input
          id="asset-upload"
          ref={fileInput}
          aria-label="Upload files"
          type="file"
          multiple
          disabled={uploading}
          onChange={onUpload}
          className="text-sm"
        />
        {uploading && <span className="text-xs text-slate-400">uploading…</span>}
        <p className="text-[11px] text-slate-400">
          Any file type. Images are optimized to AVIF/WebP; other files are stored as downloads.
          {folder && <> Filing into <strong>{folder}</strong>.</>}
        </p>
      </div>

      {stockOpen && (
        <Modal title="Search stock images" size="xl" onClose={() => setStockOpen(false)}>
          <div className="p-4">
            <StockPicker projectId={project.id} onImported={() => load()} bare />
          </div>
        </Modal>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {/* Toolbar: breadcrumb + new folder + view toggle */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path" className="flex items-center gap-1 text-sm text-slate-600">
          <button type="button" onClick={() => goToCrumb(-1)} className="rounded px-1.5 py-0.5 hover:bg-white/60">
            Assets
          </button>
          {crumbs.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-slate-300">/</span>
              <button type="button" onClick={() => goToCrumb(i)} className="rounded px-1.5 py-0.5 hover:bg-white/60">
                {seg}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <input
            aria-label="New folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFolder()}
            placeholder="New folder"
            className="w-32 rounded-lg border border-white/60 bg-white/60 px-2 py-1 text-xs"
          />
          <button type="button" onClick={addFolder} className={`${ghostButton} px-2 py-1 text-xs`}>
            + Folder
          </button>
          <div className="flex overflow-hidden rounded-lg border border-white/60">
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
              className={`px-2 py-1 text-xs ${view === 'grid' ? 'bg-white text-slate-900' : 'bg-white/40 text-slate-500'}`}
            >
              Grid
            </button>
            <button
              type="button"
              aria-label="List view"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              className={`px-2 py-1 text-xs ${view === 'list' ? 'bg-white text-slate-900' : 'bg-white/40 text-slate-500'}`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {subfolders.map((seg) => (
            <button
              key={`d:${seg}`}
              type="button"
              onClick={() => enterFolder(seg)}
              className={`flex flex-col items-center gap-1 ${glassCard} p-3 text-center hover:ring-2 hover:ring-indigo-300`}
            >
              <FolderIcon />
              <span className="truncate text-[11px] text-slate-600" title={seg}>
                {seg}
              </span>
            </button>
          ))}
          {here.map((m) => (
            <figure key={m.id} className={`${glassCard} flex flex-col p-2`}>
              {m.kind === 'image' ? (
                <img src={m.url} alt={m.alt ?? m.filename} className="h-24 w-full rounded object-cover" loading="lazy" />
              ) : (
                <div className="flex h-24 w-full items-center justify-center rounded bg-white/40">
                  <FileIcon />
                </div>
              )}
              <figcaption className="mt-1">
                <a href={m.url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-slate-600 hover:text-indigo-600" title={m.filename}>
                  {m.filename}
                </a>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">{formatBytes(m.bytes)}</span>
                  <button aria-label={`Delete ${m.filename}`} className={`${dangerButton} px-1.5 py-0.5 text-[11px]`} onClick={() => remove(m.id)}>
                    ✕
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
          {subfolders.length === 0 && here.length === 0 && <p className="text-sm text-slate-400">This folder is empty.</p>}
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 font-medium">Name</th>
              <th className="py-1 font-medium">Type</th>
              <th className="py-1 text-right font-medium">Size</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {subfolders.map((seg) => (
              <tr key={`d:${seg}`} className="border-t border-white/40">
                <td className="py-1.5">
                  <button type="button" onClick={() => enterFolder(seg)} className="flex items-center gap-2 text-slate-700 hover:text-indigo-600">
                    <FolderIcon /> {seg}
                  </button>
                </td>
                <td className="py-1.5 text-slate-400">folder</td>
                <td className="py-1.5 text-right text-slate-400">—</td>
                <td />
              </tr>
            ))}
            {here.map((m) => (
              <tr key={m.id} className="border-t border-white/40">
                <td className="py-1.5">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-indigo-600" title={m.filename}>
                    {m.filename}
                  </a>
                </td>
                <td className="py-1.5 text-slate-400">{m.kind === 'image' ? m.format : m.contentType}</td>
                <td className="py-1.5 text-right text-slate-500">{formatBytes(m.bytes)}</td>
                <td className="py-1.5 text-right">
                  <button aria-label={`Delete ${m.filename}`} className={`${dangerButton} px-1.5 py-0.5 text-[11px]`} onClick={() => remove(m.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {subfolders.length === 0 && here.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-sm text-slate-400">
                  This folder is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
