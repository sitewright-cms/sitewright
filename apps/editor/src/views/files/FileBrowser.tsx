import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';
import { api } from '../../api';
import { useProjectEvents } from '../../lib/use-project-events';
import { useVirtualRows } from '../../lib/virtual-rows';
import { uploadBatch } from '../../lib/upload-batch';
import { StockPicker } from '../media/StockPicker';
import { RecycleBinModal } from './RecycleBinModal';
import { UnusedFilesModal } from './UnusedFilesModal';
import { FileTypeIcon, FolderIcon } from '../media/file-icons';
import { Modal } from '../ui/Modal';
import { SearchField } from '../ui/SearchField';
import { useDialogs } from '../ui/Dialogs';
import { SkeletonImage } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { useIsMobile } from '../../lib/use-is-mobile';
import { glassCard, glassPanel, ghostButton, primaryButton, toggleInput } from '../../theme';
import { cleanSvgFile } from '../library/svg-studio-helpers';
import { ImageEditorStudio } from '../library/ImageEditorStudio';
import { assetEmbedUrls } from './media-embed';
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
export function formatBytes(bytes: number): string {
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

/**
 * The URL for a THUMBNAIL of `asset` — the smallest generated rung.
 *
 * ★ A bare media URL serves the `xl` variant, which is **2400px wide**. This browser paints those into
 * a 32px list icon and a 96px grid tile, so every thumbnail was the largest file the platform makes:
 * measured on a photo-like source, `sm` is 36KB against `xl`'s 2,120KB — roughly 59x. Each first hit is
 * also an on-demand encode on the server, so the cost lands twice.
 *
 * SVG is served inline as-is and is never rasterized, so a size hint on one is only a wasted cache key.
 */
function thumbnailUrl(asset: MediaAsset, size: 'xs' | 'sm' = 'sm'): string {
  if (asset.kind === 'image' && asset.format === 'svg') return asset.url;
  return `${asset.url}?size=${size}`;
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
/** Two arrows chasing each other — swap THIS file's contents, as distinct from the pencil (rename). */
const REPLACE_ICON = icon(<path d="M21 8a9 9 0 0 0-15.5-4.5L3 6M3 4v4h4M3 16a9 9 0 0 0 15.5 4.5L21 18M21 20v-4h-4" />);

/** The single stored file behind an asset — its extension is what a replacement has to match. */
function assetStoredName(m: MediaAsset): string {
  if (m.kind === 'image') return m.original;
  if (m.kind === 'font') return m.files[0]?.file ?? m.filename;
  return m.storedName;
}

/** A font family is many files (weight × style), so "replace the file" has no single meaning. */
const canReplace = (m: MediaAsset): boolean => m.kind !== 'font';
const LINK_ICON = icon(
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
);
const CHECK_ICON = icon(<path d="M20 6 9 17l-5-5" />);
const CHEVRON_LEFT = icon(<path d="m15 18-6-6 6-6" />);
const CHEVRON_RIGHT = icon(<path d="m9 18 6-6-6-6" />);
const DOWNLOAD_ICON = icon(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />);
const TRASH_ICON = icon(<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />);

const ACT = 'inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-slate-500 dark:text-slate-400 transition hover:bg-white dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-slate-100';
const ACT_DANGER = `${ACT} hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400`;

/** Inline monospace snippet for handlebars helpers shown in dialog notes. */
const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-slate-100 dark:bg-white/10 px-1 py-0.5 font-mono text-[10px] text-indigo-600 dark:text-indigo-300">{children}</code>
);

/**
 * The helper note under the Rename field. For an image the display name doubles as the default alt
 * text (`{{sw-image}}` falls back to it when no alt is set — accessibility & SEO); for any asset the
 * name is available in templates via `{{this.filename}}` inside a `{{#sw-folder}}` loop.
 */
function renameNote(m: MediaAsset): ReactNode {
  return (
    <>
      {m.kind === 'image' ? (
        <>
          Used as the image's default <strong>alt text</strong> when you embed it with <Code>{'{{sw-image}}'}</Code> and haven't set one (accessibility &amp; SEO).{' '}
        </>
      ) : (
        <>
          The file's download name.{' '}
        </>
      )}
      In templates, output it with <Code>{'{{this.filename}}'}</Code> inside a <Code>{'{{#sw-folder}}'}</Code> loop.
    </>
  );
}

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
  /** Reports the library total (every asset in the project, not just the open folder) whenever the
   *  asset list changes, so a host chrome — the File Manager panel's title bar — can show it. */
  onTotals?: (totals: { count: number; bytes: number }) => void;
}

/**
 * The reusable file/folder browser over the project media library: breadcrumb navigation, list/grid
 * views, upload, new-folder, rename/copy-URL/delete (files + folders) and drag-to-move. Shared by the
 * Assets side panel (mode='manage') and the FilePicker modal (mode='pick', filtered by `accept`).
 */
export function FileBrowser({ projectId, mode = 'manage', accept, onPick, intro, onTotals }: FileBrowserProps) {
  const pick = mode === 'pick';
  // Narrow viewport: the Actions column has to hold FIVE 44px touch targets (see the <th>).
  const isMobile = useIsMobile();
  const { confirm, prompt, dialog } = useDialogs();
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('URL copied — paste it into your page code'));
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folderRecords, setFolderRecords] = useState<MediaFolderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** A non-error note the author still has to see — currently "the replacement is a different shape". */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The asset a pending "Replace file" picker is aimed at (the input itself carries no target).
   * A REF, not state: `replaceAsset` opens the file dialog synchronously, so a state update made in
   * the same tick would not have re-rendered yet — the picker would still carry the PREVIOUS asset's
   * `accept` filter, and on the first use none at all.
   */
  const replaceTarget = useRef<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Where a multi-file drop has got to, and whether it is currently waiting out a rate limit. */
  const [progress, setProgress] = useState<{ done: number; total: number; waitingFor: number } | null>(null);
  const [cleanSvg, setCleanSvg] = useState(true);
  const [stockOpen, setStockOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [unusedOpen, setUnusedOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(pick ? 'grid' : 'list');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  /** The asset open in the Image Editor, stacked over the preview modal. */
  const [editing, setEditing] = useState<(MediaAsset & { kind: 'image' }) | null>(null);
  /** Cache-buster for the preview <img> after an IN-PLACE save, which leaves the URL unchanged. */
  const [previewNonce, setPreviewNonce] = useState(0);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // path being hovered (highlight)
  /**
   * Whether a DESKTOP-FILE drag is currently over the manager (⇒ dashed outline). Kept apart from
   * `dropTarget`, which also lights up for an INTERNAL asset/folder move — dragging a file row between
   * folders should not make the whole pane look like an upload target.
   */
  const [fileDragOver, setFileDragOver] = useState(false);
  /**
   * dragenter/dragleave fire for every DESCENDANT the pointer crosses, so a naive boolean flickers off
   * the moment the cursor moves from the pane onto a row inside it. Counting enters vs leaves is the
   * standard fix: the drag has really left only when the depth returns to zero.
   */
  const dragDepth = useRef(0);
  /** A finished batch that had FAILURES — keeps the progress modal open so the names can be read. */
  const [uploadReport, setUploadReport] = useState<{ stored: number; total: number; failed: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
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

  // Report the WHOLE library's size to the host chrome (the panel title bar). Derived from `assets`,
  // which always holds every asset in the project — the folder view and the search both filter it
  // client-side — so this is the library total, not the open folder's, and it follows every
  // upload/delete/live-refresh for free.
  const onTotalsRef = useRef(onTotals);
  onTotalsRef.current = onTotals;
  useEffect(() => {
    onTotalsRef.current?.({ count: assets.length, bytes: assets.reduce((n, a) => n + a.bytes, 0) });
  }, [assets]);

  // LIVE-REFRESH: when the agent (or another tab) adds/edits/deletes media or a folder, refetch so the
  // File Manager reflects it without a full SPA reload.
  useProjectEvents(projectId, (c) => {
    if (c.kind === 'media' || c.kind === 'mediafolder') void load();
  });

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

  /**
   * Render only the rows on screen.
   *
   * Measured on a deployed instance with 3,000 assets in one folder: 75,686 DOM nodes, 3,000 `<img>`
   * elements, a 78MB JS heap and ~334ms per search keystroke. Foldering hides it (30 folders of 100
   * render 1,236 nodes) but does not fix it — SEARCH spans every folder, so one broad query puts the
   * whole library back on screen regardless of how it is filed.
   *
   * ★ Folders and files are ONE sequence here, because that is the order they render in. Windowing only
   * the files would leave every folder permanently mounted and shift the arithmetic by however many
   * there are.
   */
  const rowCount = subfolders.length + here.length;
  const virt = useVirtualRows(rowCount, true, { grid: view === 'grid' });
  const visibleFolders = subfolders.slice(virt.start, virt.end);
  const visibleAssets = here.slice(Math.max(0, virt.start - subfolders.length), Math.max(0, virt.end - subfolders.length));

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
  /**
   * Upload a drop, one file at a time.
   *
   * ★ This used to be a bare `for` loop with no per-file catch, so the FIRST refusal ended the batch and
   * every remaining file was never attempted. Measured against a real instance: dropping 60 files stored
   * 30, aborted at #31 with HTTP 429, and reported one banner with no count and no names. Now each file
   * gets its own attempt, a transient refusal is waited out (see uploadBatch), and what did not land is
   * named — the same shape the Unused Files bulk delete already had.
   */
  async function uploadFiles(files: FileList | File[], target = folder) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setProgress(null);
    setError(null);
    setUploadReport(null);
    try {
      const { stored, failed } = await uploadBatch(list, {
        upload: async (file) => {
          // Tidy an uploaded SVG (strip editor cruft + pretty-print) before it's stored, when enabled.
          // Best-effort: a non-SVG or unparseable file is passed through untouched; the server sanitizes regardless.
          const toSend = cleanSvg ? await cleanSvgFile(file) : file;
          await api.uploadMedia(projectId, toSend, target);
        },
        // Only worth showing for a real batch — a single file is done before the label could be read.
        onProgress: (done, total) => setProgress(total > 1 ? { done, total, waitingFor: 0 } : null),
        onPause: (seconds) => setProgress((p) => (p ? { ...p, waitingFor: seconds } : p)),
      });
      await load();
      if (failed.length > 0) {
        // Say how many landed AND name the first few that did not: "12 failed" sends an author hunting
        // through a library of hundreds to work out which.
        const names = failed.slice(0, 3).join(', ');
        const rest = failed.length > 3 ? ` and ${failed.length - 3} more` : '';
        setError(`${stored} of ${list.length} uploaded — ${failed.length} failed (${names}${rest}).`);
        // Hold the progress modal open on a PARTIAL failure. Auto-closing it would take the only place
        // the failed names are listed off screen at the exact moment they became relevant.
        setUploadReport({ stored, total: list.length, failed });
      }
    } catch (err) {
      // uploadBatch does not throw; this covers a failure of the reload itself.
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      setProgress(null);
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
    const next = await prompt({ title: 'Rename file', label: 'Display name', initial: m.filename, note: renameNote(m) });
    if (!next || next === m.filename) return;
    await run(() => api.patchMedia(projectId, m.id, { filename: next }));
  }
  /** Copy the asset's root-relative delivery URL — what you paste into page code (`{{sw-image}}`,
   *  `data-sw-src`, `<img src>`). Images expose their original + thumbnail sizes in the preview modal. */
  function copyUrl(m: MediaAsset) {
    copy(m.url, m.id);
  }
  async function deleteAsset(m: MediaAsset) {
    if (!(await confirm({ title: 'Delete file', message: `Move “${m.filename}” to the Recycle Bin? You can restore it for 90 days.`, confirmLabel: 'Delete' }))) return;
    await run(() => api.deleteMedia(projectId, m.id));
  }

  /**
   * REPLACE this asset's bytes, keeping its id and URL — so every page, entry and chrome slot already
   * pointing at it shows the new file with nothing to repoint. Distinct from the "Replace image" picker
   * in the page editor, which points one `<img>` at a DIFFERENT asset and leaves this one alone.
   *
   * The picker is filtered to the SAME EXTENSION, because that is the server's rule (the extension is
   * part of every URL) and letting someone choose a .png for a .jpg only to be refused afterwards is a
   * worse way to learn it.
   */
  function replaceAsset(m: MediaAsset) {
    const input = replaceInput.current;
    if (!input) return;
    replaceTarget.current = m;
    // Reset first: picking the same path twice in a row fires no change event otherwise.
    input.value = '';
    // Set `accept` IMPERATIVELY, for the timing reason on the ref above — the dialog opens on the
    // click below. The server refuses a format change, so the picker must not offer one.
    input.accept = `.${(assetStoredName(m).split('.').pop() ?? '').toLowerCase()}`;
    input.click();
  }

  async function onReplacePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (!file || !target) return;
    setError(null);
    try {
      const res = await api.replaceMediaContent(projectId, target.id, file);
      await load();
      // The URL did not change, so the browser would keep showing the old picture in an open preview.
      setPreviewNonce((n) => n + 1);
      if (res.item.kind === 'image' && preview?.id === target.id) setPreview(res.item);
      // ★ A same-URL swap gives the author NO other signal that the shape changed — and a different
      // aspect ratio reflows every page using the asset. Say so; it is not an error, so it is a note.
      const before = res.previous;
      const after = res.item as MediaAsset & { width?: number; height?: number };
      if (before.width && before.height && after.width && after.height) {
        const ratio = (w: number, h: number) => Math.round((w / h) * 100);
        if (ratio(before.width, before.height) !== ratio(after.width, after.height)) {
          setNotice(
            `Replaced. The new file is ${after.width}×${after.height}, not ${before.width}×${before.height} — pages using it may reflow.`,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not replace this file');
    }
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
    paneDragEnd();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files, target);
    else void moveDraggedInto(target);
  }
  const allowDrop = (target: string) => (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(target);
  };

  /** A drag carrying DESKTOP FILES (rather than an internal asset/folder move). */
  const isFileDrag = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  /** Whole-manager drop zone: track enter/leave depth so the dashed outline does not flicker. */
  const paneDragEnter = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current += 1;
    setFileDragOver(true);
  };
  const paneDragLeave = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setFileDragOver(false);
  };
  const paneDragEnd = () => {
    dragDepth.current = 0;
    setFileDragOver(false);
  };

  /**
   * The images the preview can step through: `here` is exactly the list the rows are built from, so it
   * already carries the active FOLDER, the search filter and the chosen sort — stepping through
   * anything else would move in an order the author cannot see. Non-images are skipped because the
   * preview cannot render them (clicking a PDF downloads it; it never opens this modal).
   */
  const previewSiblings = useMemo(() => here.filter((a): a is MediaAsset & { kind: 'image' } => a.kind === 'image'), [here]);
  const previewIndex = preview ? previewSiblings.findIndex((a) => a.id === preview.id) : -1;
  const goPreview = (delta: number) => {
    if (previewIndex < 0) return;
    const next = previewSiblings[previewIndex + delta];
    if (next) setPreview(next);
  };

  /**
   * ←/→ step through the folder while the preview is open.
   *
   * Bound on the window rather than the modal so it works wherever focus landed (the close button, a
   * copy row, the image itself). Two guards: the Image Editor stacks OVER the preview and owns the
   * arrows for its own crop/rotate controls, and a keystroke aimed at a text field is never navigation.
   */
  useEffect(() => {
    if (!preview || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      goPreview(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const emptyMsg = query.trim()
    ? 'No files or folders match your search.'
    : pick
      ? 'No files here.'
      : 'This folder is empty. Drop files here to upload.';

  return (
    <div
      // The whole pane is a drop zone for the CURRENT folder (upload here / move here). The dashed
      // outline appears only for a DESKTOP-FILE drag: an internal asset/folder move already has its own
      // per-row highlight, and outlining the whole manager for one would say "drop anywhere", which is
      // wrong — a move needs a specific target folder.
      onDragEnter={paneDragEnter}
      onDragOver={allowDrop(folder)}
      onDragLeave={(e) => {
        paneDragLeave(e);
        if (e.currentTarget === e.target) setDropTarget(null);
      }}
      onDrop={(e) => onDropInto(folder, e)}
      data-file-drag={fileDragOver ? 'over' : undefined}
      className={
        fileDragOver
          ? 'rounded-2xl outline-2 outline-offset-4 outline-dashed outline-indigo-400 dark:outline-indigo-300'
          : undefined
      }
    >
      {dialog}
      {intro && <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{intro}</p>}

      {/* Upload + stock toolbar — every action on ONE row, the primary one carrying the brand gradient. */}
      <div className={`mb-4 ${glassCard} p-4 ${dropTarget === folder ? 'sw-brand-ring' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          {/* The native file input is the thing that actually opens the picker, but its browser-drawn
              "Choose files" control cannot be styled and looked nothing like the rest of the editor. It
              stays in the DOM (hidden) and keeps its label, so it is still the accessible control and
              still what a test drives; this button is the visible affordance and forwards the click. */}
          <input
            id={uploadId}
            ref={fileInput}
            aria-label="Upload files"
            type="file"
            multiple
            disabled={uploading}
            onChange={onUpload}
            className="hidden"
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className={primaryButton}>
            {uploading ? 'Uploading…' : 'Upload files'}
          </button>
          <button type="button" onClick={() => setStockOpen(true)} className={ghostButton}>
            Search stock images
          </button>
          <button type="button" onClick={() => setUnusedOpen(true)} className={ghostButton}>
            Search for unused files
          </button>
          <button type="button" onClick={() => setRecycleOpen(true)} className={ghostButton}>
            Recycle Bin
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Any file type, or drag &amp; drop onto this panel. Images become AVIF/WebP; other files are stored as downloads.
          {folder && <> Filing into <strong>{folder}</strong>.</>}
        </p>
        <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400" title="Strip editor cruft (comments, metadata, Inkscape/Illustrator junk) from uploaded SVGs and pretty-print them. CSS, ids and animation are kept.">
          <input type="checkbox" checked={cleanSvg} onChange={(e) => setCleanSvg(e.target.checked)} className={toggleInput} aria-label="Clean up SVG code on upload" />
          Clean up SVG code on upload
        </label>
      </div>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && (
        <p role="status" className="mb-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className={`${ghostButton} px-2 py-0.5 text-xs`}>
            Dismiss
          </button>
        </p>
      )}
      {/* The "Replace file" picker, shared by every row. `accept` is pinned to the target's extension
          because the server refuses anything else — the extension is part of the asset's URL. */}
      <input
        ref={replaceInput}
        type="file"
        aria-label="Replace file"
        className="hidden"
        onChange={(e) => void onReplacePicked(e)}
      />

      {/* Breadcrumb + new folder + view toggle */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path" className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => goTo('')}
            onDragOver={allowDrop('')}
            onDrop={(e) => onDropInto('', e)}
            className={`rounded px-1.5 py-0.5 hover:bg-white/60 dark:hover:bg-white/10 ${dropTarget === '' ? 'bg-indigo-100 dark:bg-indigo-500/15' : ''}`}
          >
            Assets
          </button>
          {crumbs.map((seg, i) => {
            const crumbPath = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={crumbPath} className="flex items-center gap-1">
                <span className="text-slate-500 dark:text-slate-400">/</span>
                <button
                  type="button"
                  onClick={() => goTo(crumbPath)}
                  onDragOver={allowDrop(crumbPath)}
                  onDrop={(e) => onDropInto(crumbPath, e)}
                  className={`rounded px-1.5 py-0.5 hover:bg-white/60 dark:hover:bg-white/10 ${dropTarget === crumbPath ? 'bg-indigo-100 dark:bg-indigo-500/15' : ''}`}
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
          <div className="flex overflow-hidden rounded-lg border border-white/60 dark:border-white/10">
            {(['list', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-label={`${v} view`}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1.5 text-sm capitalize ${view === v ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100' : 'bg-white/40 dark:bg-white/5 text-slate-500 dark:text-slate-400'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {searching && (
        <p className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            Searching <strong>all folders</strong> for “{query.trim()}”.
          </span>
          <button type="button" onClick={() => setQuery('')} className="rounded px-1.5 py-0.5 text-indigo-600 dark:text-indigo-400 hover:bg-white/60 dark:hover:bg-white/10">
            Clear
          </button>
        </p>
      )}

      {view === 'list' ? (
        // table-fixed + per-column widths keep long, unbreakable filenames from widening the table
        // (they truncate in the Name column instead) — so the drawer never scrolls horizontally.
        // `min-w` + the overflow wrapper are a graceful fallback ONLY on a very narrow drawer
        // (< ~34rem): the table scrolls a little rather than collapsing the Name column to nothing.
        <div className="overflow-x-auto">
        <table className={`w-full table-fixed text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap ${
          // The floor grows with the Actions column: widening that column inside the SAME minimum just
          // takes the width back off the Name column, which is the one thing that must stay readable.
          isMobile ? 'min-w-[41rem]' : 'min-w-[34rem]'
        }`}>
          <thead className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-1 font-medium" aria-sort={ariaSort('name')}>
                <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600 dark:hover:text-slate-300">
                  Name {sortArrow('name')}
                </button>
              </th>
              <th className="w-32 py-1 font-medium" aria-sort={ariaSort('type')}>
                <button type="button" onClick={() => toggleSort('type')} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600 dark:hover:text-slate-300">
                  Type {sortArrow('type')}
                </button>
              </th>
              <th className="w-20 py-1 text-right font-medium" aria-sort={ariaSort('size')}>
                <button type="button" onClick={() => toggleSort('size')} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600 dark:hover:text-slate-300">
                  Size {sortArrow('size')}
                </button>
              </th>
              {/* A file row carries up to SIX actions — Use, Copy URL, Download, Replace, Rename, Delete.
                  At the desktop icon size they fit in 11rem; under the coarse-pointer 44px touch floor
                  they need 264px plus gaps, which is why the mobile width is 18rem rather than 16. The
                  table already scrolls horizontally inside the rail, which is the accepted trade here. */}
              <th className={`py-1 text-right font-medium ${isMobile ? 'w-72' : 'w-44'}`}>Actions</th>
            </tr>
          </thead>
          <tbody ref={virt.listRef as (el: HTMLTableSectionElement | null) => void}>
            {virt.padTop > 0 && (
              // A <tr> and not a <div>: anything else inside <tbody> is invalid HTML and browsers
              // hoist it out of the table, which loses the reserved height entirely.
              <tr data-virtual-spacer aria-hidden>
                <td colSpan={4} style={{ height: virt.padTop, padding: 0 }} />
              </tr>
            )}
            {visibleFolders.map(({ seg, path, bytes }) => (
              <tr
                key={`d:${seg}`}
                data-virtual-row
                draggable={!pick}
                onDragStart={pick ? undefined : () => (dragItem.current = { type: 'folder', path })}
                onDragEnd={() => (dragItem.current = null)}
                onDragOver={allowDrop(path)}
                onDrop={(e) => onDropInto(path, e)}
                className={`border-t border-white/40 dark:border-white/10 ${dropTarget === path ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''}`}
              >
                <td className="py-2">
                  <button type="button" onClick={() => goTo(path)} className="flex w-full min-w-0 items-center gap-2.5 text-base text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400" title={seg}>
                    <FolderIcon className="h-6 w-6 shrink-0 text-indigo-400" /> <span className="truncate">{seg}</span>
                  </button>
                </td>
                <td className="py-2 text-slate-500 dark:text-slate-400">folder</td>
                <td className="py-2 text-right text-slate-500 dark:text-slate-400">{formatBytes(bytes)}</td>
                <td className="py-2">
                  {!pick && !searching && (
                    <div className="flex justify-end gap-0.5">
                      <button aria-label={`Rename ${seg}`} title="Rename" className={ACT} onClick={() => void renameFolder(seg)}>{RENAME_ICON}</button>
                      <button aria-label={`Delete ${seg}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteFolder(seg)}>{TRASH_ICON}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visibleAssets.map((m) => (
              <tr
                key={m.id}
                data-virtual-row
                draggable={!pick}
                onDragStart={pick ? undefined : () => (dragItem.current = { type: 'asset', id: m.id, from: m.folder })}
                onDragEnd={() => (dragItem.current = null)}
                className="border-t border-white/40 dark:border-white/10"
              >
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => activate(m)}
                    className="flex w-full min-w-0 items-center gap-2.5 text-left text-base text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400"
                    title={m.filename}
                  >
                    {/* LIST: a 32px icon, so `xs` (150px) — still ample for the 4x hover zoom, and a
                        fraction of `sm`'s 500px, which was itself 15x the painted size. The GRID tile
                        below keeps `sm`: it paints at 96px and the zoom takes it to ~384px. */}
                    {m.kind === 'image' ? (
                      <SkeletonImage src={thumbnailUrl(m, 'xs')} alt="" className="h-8 w-8 shrink-0 rounded" />
                    ) : (
                      <FileTypeIcon asset={m} className="h-6 w-6 shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{m.filename}</span>
                      {searching && <span className="truncate text-xs text-slate-500 dark:text-slate-400">in {m.folder || 'Assets'}</span>}
                    </span>
                  </button>
                </td>
                <td className="truncate py-2 text-slate-500 dark:text-slate-400" title={typeLabel(m)}>{typeLabel(m)}</td>
                <td className="py-2 text-right text-slate-500 dark:text-slate-400">{formatBytes(m.bytes)}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-0.5">
                    {pick ? (
                      <button aria-label={actLabel('Use', m)} title="Use this file" className={ACT} onClick={() => onPick?.(m)}>{DOWNLOAD_ICON}</button>
                    ) : (
                      <>
                        <button aria-label={actLabel('Copy URL of', m)} title={m.kind === 'image' ? 'Copy URL (more sizes in preview)' : 'Copy URL'} className={ACT} onClick={() => copyUrl(m)}>{copiedId === m.id ? CHECK_ICON : LINK_ICON}</button>
                        <button aria-label={actLabel('Download', m)} title="Download" className={ACT} onClick={() => void downloadAsset(m)}>{DOWNLOAD_ICON}</button>
                        {canReplace(m) && (
                          <button aria-label={actLabel('Replace', m)} title="Replace file (keeps the URL)" className={ACT} onClick={() => replaceAsset(m)}>{REPLACE_ICON}</button>
                        )}
                        <button aria-label={actLabel('Rename', m)} title="Rename" className={ACT} onClick={() => void renameAsset(m)}>{RENAME_ICON}</button>
                        <button aria-label={actLabel('Delete', m)} title="Delete" className={ACT_DANGER} onClick={() => void deleteAsset(m)}>{TRASH_ICON}</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {virt.padBottom > 0 && (
              <tr data-virtual-spacer aria-hidden>
                <td colSpan={4} style={{ height: virt.padBottom, padding: 0 }} />
              </tr>
            )}
            {rowCount === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-sm text-slate-500 dark:text-slate-400">{emptyMsg}</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      ) : (
        <div ref={virt.listRef as (el: HTMLDivElement | null) => void} className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {virt.padTop > 0 && (
            // Spans the full row so the reserved height is whole rows, never a gap in one.
            <div data-virtual-spacer aria-hidden style={{ gridColumn: '1 / -1', height: virt.padTop }} />
          )}
          {visibleFolders.map(({ seg, path, bytes }) => (
            <div
              key={`d:${seg}`}
              data-virtual-row
              draggable={!pick}
              onDragStart={pick ? undefined : () => (dragItem.current = { type: 'folder', path })}
                onDragEnd={() => (dragItem.current = null)}
              onDragOver={allowDrop(path)}
              onDrop={(e) => onDropInto(path, e)}
              className={`group relative flex flex-col items-center gap-1 ${glassCard} p-3 text-center ${dropTarget === path ? 'sw-brand-ring' : ''}`}
            >
              <button type="button" onClick={() => goTo(path)} className="flex flex-col items-center gap-1">
                <FolderIcon className="h-10 w-10 text-indigo-400" />
                <span className="truncate text-sm text-slate-700 dark:text-slate-200" title={seg}>{seg}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{formatBytes(bytes)}</span>
              </button>
              {!pick && !searching && (
                <div className="absolute right-1 top-1 hidden gap-0.5 rounded-lg bg-white/90 dark:bg-slate-900/90 p-0.5 shadow group-hover:flex">
                  <button aria-label={`Rename ${seg}`} title="Rename" className={ACT} onClick={() => void renameFolder(seg)}>{RENAME_ICON}</button>
                  <button aria-label={`Delete ${seg}`} title="Delete" className={ACT_DANGER} onClick={() => void deleteFolder(seg)}>{TRASH_ICON}</button>
                </div>
              )}
            </div>
          ))}
          {visibleAssets.map((m) => (
            <figure
              key={m.id}
              data-virtual-row
              draggable={!pick}
              onDragStart={pick ? undefined : () => (dragItem.current = { type: 'asset', id: m.id, from: m.folder })}
                onDragEnd={() => (dragItem.current = null)}
              className={`group relative ${glassCard} flex flex-col p-2`}
            >
              <button type="button" onClick={() => activate(m)} className="block">
                {m.kind === 'image' ? (
                  <SkeletonImage src={thumbnailUrl(m)} alt={m.alt ?? m.filename} className="h-24 w-full rounded" />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center rounded bg-white/40 dark:bg-white/5">
                    <FileTypeIcon asset={m} className="h-10 w-10" />
                  </div>
                )}
                <figcaption className="mt-1 truncate text-sm text-slate-700 dark:text-slate-200" title={m.filename}>{m.filename}</figcaption>
                {searching && <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">in {m.folder || 'Assets'}</span>}
              </button>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{formatBytes(m.bytes)}</span>
                <div className="hidden gap-0.5 group-hover:flex">
                  {pick ? (
                    <button aria-label={actLabel('Use', m)} title="Use this file" className={ACT} onClick={() => onPick?.(m)}>{DOWNLOAD_ICON}</button>
                  ) : (
                    <>
                      <button aria-label={actLabel('Copy URL of', m)} title={m.kind === 'image' ? 'Copy URL (more sizes in preview)' : 'Copy URL'} className={ACT} onClick={() => copyUrl(m)}>{copiedId === m.id ? CHECK_ICON : LINK_ICON}</button>
                      <button aria-label={actLabel('Download', m)} title="Download" className={ACT} onClick={() => void downloadAsset(m)}>{DOWNLOAD_ICON}</button>
                      {canReplace(m) && (
                          <button aria-label={actLabel('Replace', m)} title="Replace file (keeps the URL)" className={ACT} onClick={() => replaceAsset(m)}>{REPLACE_ICON}</button>
                        )}
                        <button aria-label={actLabel('Rename', m)} title="Rename" className={ACT} onClick={() => void renameAsset(m)}>{RENAME_ICON}</button>
                      <button aria-label={actLabel('Delete', m)} title="Delete" className={ACT_DANGER} onClick={() => void deleteAsset(m)}>{TRASH_ICON}</button>
                    </>
                  )}
                </div>
              </div>
            </figure>
          ))}
          {virt.padBottom > 0 && <div data-virtual-spacer aria-hidden style={{ gridColumn: '1 / -1', height: virt.padBottom }} />}
          {rowCount === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMsg}</p>}
        </div>
      )}

      {/* UPLOAD PROGRESS.
          A batch can take minutes (uploadBatch waits out 429s), and the only previous signal was one
          line of small print in the toolbar — easy to miss, and invisible once the pane scrolled. The
          modal auto-closes on success: it is unmounted the moment `uploading` goes false, so a clean
          run costs no click. It is HELD OPEN only when files failed, because that is the one case with
          something to read — the names of what did not land. */}
      {(uploading || uploadReport) && (
        <Modal
          title={uploadReport ? 'Upload finished with errors' : 'Uploading files'}
          size="md"
          onClose={() => {
            // No dismissing mid-flight: closing would suggest the upload stopped, and it has not.
            if (!uploading) setUploadReport(null);
          }}
        >
          <div className="flex flex-col gap-3 p-4" role="status" aria-live="polite">
            {uploading && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  {progress === null
                    ? 'Uploading…'
                    : progress.waitingFor > 0
                      ? // Say WHY it paused. Silence here is indistinguishable from a hang.
                        `Uploaded ${progress.done} of ${progress.total} — server busy, resuming in ${progress.waitingFor}s`
                      : `Uploading ${progress.done} of ${progress.total}…`}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  {/* A single file finishes before a determinate bar could be read, so that case gets a
                      moving stripe rather than a percentage that only ever shows 0 then 100. */}
                  <div
                    className={progress === null ? 'h-full w-1/3 animate-pulse sw-brand-gradient' : 'h-full sw-brand-gradient transition-[width]'}
                    style={progress === null ? undefined : { width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                    aria-hidden
                  />
                </div>
              </>
            )}
            {uploadReport && !uploading && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  {uploadReport.stored} of {uploadReport.total} uploaded — {uploadReport.failed.length} failed:
                </p>
                <ul className="max-h-48 overflow-auto text-xs text-red-600 dark:text-red-400">
                  {uploadReport.failed.slice(0, 12).map((name) => (
                    <li key={name} className="truncate">{name}</li>
                  ))}
                  {uploadReport.failed.length > 12 && <li>…and {uploadReport.failed.length - 12} more</li>}
                </ul>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setUploadReport(null)} className={ghostButton}>
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {stockOpen && (
        <Modal title={`Search stock images${folder ? ` → ${folder}` : ''}`} size="xl" onClose={() => setStockOpen(false)}>
          <div className="p-4">
            <StockPicker projectId={projectId} folder={folder} onImported={() => load()} bare />
          </div>
        </Modal>
      )}

      {recycleOpen && <RecycleBinModal projectId={projectId} onClose={() => setRecycleOpen(false)} onChanged={() => void load()} />}
      {unusedOpen && <UnusedFilesModal projectId={projectId} onClose={() => setUnusedOpen(false)} onChanged={() => void load()} />}

      {/* In-app image preview (replaces opening images in a new tab) + copyable embed URLs. */}
      {preview && preview.kind === 'image' && (
        <Modal title={preview.filename} size="xl" onClose={() => setPreview(null)}>
          <ImagePreview
            asset={preview}
            copiedId={copiedId}
            onCopy={copy}
            onEdit={() => setEditing(preview)}
            onReplace={() => replaceAsset(preview)}
            nonce={previewNonce}
            position={previewIndex >= 0 ? { index: previewIndex, total: previewSiblings.length } : undefined}
            onPrev={previewIndex > 0 ? () => goPreview(-1) : undefined}
            onNext={previewIndex >= 0 && previewIndex < previewSiblings.length - 1 ? () => goPreview(1) : undefined}
          />
        </Modal>
      )}

      {/* The Image Editor, stacked over the preview. On save the preview underneath is rebuilt from
          the returned asset: an in-place edit does NOT change the URL, so without this the modal would
          keep showing the pre-edit dimensions and a cached picture, and the author would be looking at
          the old image while believing the save had failed. `previewNonce` busts the image cache for
          the same reason. */}
      {editing && (
        <ImageEditorStudio
          projectId={projectId}
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(item) => {
            void load();
            if (item.kind === 'image' && item.id === editing.id) {
              setPreview(item);
              setEditing(item);
              setPreviewNonce((n) => n + 1);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * The in-app image preview: the image, its intrinsic metadata, and an **Embed URLs** panel of
 * copy-to-clipboard variants (the responsive delivery URL, the raw original, and each on-demand
 * thumbnail size). Each row copies its root-relative `/media/…` URL — what you paste into page code.
 */
function ImagePreview({
  asset,
  copiedId,
  onCopy,
  onEdit,
  onReplace,
  nonce,
  position,
  onPrev,
  onNext,
}: {
  asset: MediaAsset & { kind: 'image' };
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  /** Open the Image Editor on this asset. Absent for a format that has no pixels to edit. */
  onEdit?: () => void;
  /** Swap the FILE behind this asset, keeping its id and URL (not the same as repointing an <img>). */
  onReplace?: () => void;
  /** Bumped after an in-place save; appended to the <img> src so the browser refetches. */
  nonce?: number;
  /** Where this image sits among the folder's images, for the "3 of 12" counter. */
  position?: { index: number; total: number };
  /** Step to the previous / next image. ABSENT at the ends — see the disabled-vs-wrap note below. */
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const urls = assetEmbedUrls(asset);
  const original = urls.find((u) => u.label === 'Original')?.url ?? asset.url;
  // Chevrons FLANK the image rather than overlaying it: a media library is full of pictures with light
  // edges, and an overlaid control on one of those is invisible exactly when it is needed.
  //
  // They are DISABLED at the ends rather than wrapping. Wrapping saves a click but costs the author
  // their place — with no visible list position, "back to the first" and "no more images" look
  // identical. The counter below states the position outright, so the ends are legible.
  const navButton =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 dark:text-slate-300 transition hover:bg-white/70 dark:hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="flex w-full items-center justify-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!onPrev}
          aria-label="Previous image"
          title="Previous image (←)"
          className={navButton}
        >
          {CHEVRON_LEFT}
        </button>
        <img
          src={nonce ? `${asset.url}${asset.url.includes('?') ? '&' : '?'}v=${nonce}` : asset.url}
          alt={asset.alt ?? asset.filename}
          className="max-h-[40dvh] w-auto rounded-lg shadow-lg"
        />
        <button
          type="button"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next image"
          title="Next image (→)"
          className={navButton}
        >
          {CHEVRON_RIGHT}
        </button>
      </div>
      {position && position.total > 1 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400" role="status">
          {position.index + 1} of {position.total} in this folder · use ← → to step through
        </p>
      )}
      <div className="flex w-full items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          {asset.format} · {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
        </span>
        <span className="flex items-center gap-2">
          {/* An SVG is a vector: there are no pixels to turn or cut, so the editor is not offered. */}
          {onEdit && asset.format !== 'svg' && (
            <button type="button" onClick={onEdit} className={`${ghostButton} px-3 py-1`}>
              Edit image
            </button>
          )}
          {onReplace && (
            <button type="button" onClick={onReplace} className={`${ghostButton} px-3 py-1`} title="Swap the file behind this asset — its URL does not change">
              Replace file
            </button>
          )}
          <a href={original} target="_blank" rel="noreferrer" className={`${ghostButton} px-3 py-1`}>
            Open original
          </a>
        </span>
      </div>

      <div className="w-full">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Embed URLs</p>
        <ul className="flex flex-col gap-1">
          {urls.map((u) => {
            const id = `${asset.id}:${u.label}`;
            const copied = copiedId === id;
            return (
              <li key={u.label}>
                {/* DaisyUI tooltip carries the variant description on hover (e.g. "responsive delivery
                    — use this in code. Click to Copy"); `block` keeps the wrapped button full-width. */}
                <span
                  className="tooltip tooltip-top block before:z-20 before:max-w-[18rem] before:whitespace-normal before:text-left"
                  data-tip={`${u.hint}. Click to Copy`}
                >
                  <button
                    type="button"
                    onClick={() => onCopy(u.url, id)}
                    aria-label={`Copy ${u.label} URL: ${u.url}`}
                    className={`group flex w-full items-center gap-2.5 rounded-lg border border-white/60 dark:border-white/10 ${glassPanel} px-2.5 py-1.5 text-left transition hover:border-indigo-300 dark:hover:border-indigo-500/40`}
                  >
                    <span className="w-12 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">{u.label}</span>
                    <code className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">{u.url}</code>
                    <span className={`shrink-0 text-sm font-semibold ${copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100'}`}>
                      {copied ? 'Copied ✓' : 'Copy'}
                    </span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {asset.attribution && (
        <p className={`w-full text-[11px] text-slate-500 dark:text-slate-400 ${glassPanel} p-2`}>
          {asset.attribution.provider} · {asset.attribution.author} · {asset.attribution.license}
        </p>
      )}
    </div>
  );
}
