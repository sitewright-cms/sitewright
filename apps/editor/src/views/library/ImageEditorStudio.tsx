import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Crop, Download, RotateCcw, RotateCw, Save, Upload, X } from 'lucide-react';
import type { MediaAsset } from '@sitewright/schema';
import { Modal } from '../ui/Modal';
import { FilePicker } from '../files/FilePicker';
import { useDialogs } from '../ui/Dialogs';
import { useToast } from '../ui/Toast';
import { api } from '../../api';
import { ghostButton, primaryButton } from '../../theme';
import {
  addTurn,
  clampRect,
  fitScale,
  rectFromPoints,
  resizeRect,
  rotateRect,
  roundRect,
  turnedSize,
  type Handle,
  type Rect,
  type Turn,
} from './image-editor-geometry';

/** Quality for the WebP the editor writes. Matches the server-side edit pipeline. */
const WEBP_QUALITY = 0.9;
/** Hit radius (screen px) for a corner handle. Generous — a 6px target is unusable with a trackpad. */
const HANDLE_HIT = 14;

export interface ImageEditorStudioProps {
  /** Optional like the sibling studios: the panel can be open outside a project. Without one the
   *  editor still opens, rotates, crops and DOWNLOADS — only the library destinations are withheld. */
  projectId?: string;
  onClose: () => void;
  /**
   * An asset to open with, from the File Manager's "Edit image". Its presence is what turns on the
   * in-place SAVE: an edit can only be written back over something that already exists.
   */
  asset?: (MediaAsset & { kind: 'image' }) | undefined;
  /** Fired after a save so a host preview can show the new state (an in-place save changes no URL). */
  onSaved?: (item: MediaAsset) => void;
}

/** What the editor is currently working on. */
interface Loaded {
  /** Object URL (an imported file) or the asset's original URL. */
  src: string;
  width: number;
  height: number;
  /** Set when the source is a library asset — enables in-place save. */
  assetId?: string;
  /** Seed for the export filename. */
  filename: string;
  /** True when `src` is an object URL we own and must revoke. */
  owned: boolean;
}

/**
 * IMAGE EDITOR — turn a photograph and cut a rectangle out of it.
 *
 * Two ways in, and they behave differently on purpose:
 *
 *  · From the LIBRARY (the File Manager's "Edit image"): the asset is known, so the editor can write
 *    the result back over it. SAVE replaces the stored original — the id, the stored name and the URL
 *    do not change, so every page, dataset and gallery that references the picture keeps working and
 *    the correction travels with an export. That is the right shape for straightening a photograph,
 *    and it is destructive. SAVE AS writes a new asset instead, for when the crop is one USE of a
 *    picture rather than a fix to it.
 *  · IMPORTED (drag & drop, file picker): there is nothing to save back to, so the only destinations
 *    are the library (as a new file) and a download.
 *
 * ★ WHERE THE PIXELS ARE PRODUCED differs, and it is not an inconsistency. An edit to a library asset
 * is applied SERVER-SIDE through the shared transform endpoint, so it gets the same decode limits,
 * the project's upload cap, a regenerated LQIP placeholder and a thumbnail purge — a canvas in the
 * browser can do none of that, and re-uploading a canvas result would quietly re-encode an image the
 * server already knows how to handle. An imported file has no server-side copy yet, so its bytes are
 * rendered here and then uploaded through the ordinary media route. Downloads are always local: it is
 * the one case where nothing needs to be stored.
 */
export function ImageEditorStudio({ projectId, onClose, asset, onSaved }: ImageEditorStudioProps) {
  const toast = useToast();
  const { confirm, prompt, dialog } = useDialogs();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [turn, setTurn] = useState<Turn>(0);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after an in-place save so the <img> re-fetches past the browser cache (the URL is stable). */
  const [nonce, setNonce] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pane, setPane] = useState({ width: 800, height: 460 });

  // Open straight onto the asset the File Manager handed over. `?size=original` matters: the plain
  // media URL serves a THUMBNAIL rung, so editing it would crop and save a downscaled copy over the
  // full-size original.
  useEffect(() => {
    if (!asset) return;
    setLoaded({
      src: `${asset.url}?size=original`,
      width: asset.width,
      height: asset.height,
      assetId: asset.id,
      filename: asset.filename,
      owned: false,
    });
  }, [asset]);

  // Revoke an imported file's object URL when it is replaced or the studio closes.
  useEffect(() => {
    const url = loaded?.owned ? loaded.src : null;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [loaded?.owned, loaded?.src]);

  // Track the preview pane so the fit scale follows a resized window.
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setPane({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const natural = useMemo(() => ({ width: loaded?.width ?? 0, height: loaded?.height ?? 0 }), [loaded]);
  const shown = useMemo(() => turnedSize(natural, turn), [natural, turn]);
  const scale = useMemo(() => fitScale(shown, pane), [shown, pane]);
  const viewW = Math.round(shown.width * scale);
  const viewH = Math.round(shown.height * scale);

  const reset = useCallback(() => {
    setTurn(0);
    setCrop(null);
    setError(null);
  }, []);

  /** Load an imported File (drag & drop or the file input). */
  const loadFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('That is not an image.');
        return;
      }
      if (file.type === 'image/svg+xml') {
        // A vector has no pixels to turn or cut; editing one belongs in its markup.
        setError('An SVG is a vector — edit it in the SVG animation studio, not here.');
        return;
      }
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        reset();
        setLoaded({ src: url, width: probe.naturalWidth, height: probe.naturalHeight, filename: file.name, owned: true });
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        setError('That image could not be read.');
      };
      probe.src = url;
    },
    [reset],
  );

  const pickFromLibrary = useCallback(
    (url: string, picked?: MediaAsset) => {
      setPickerOpen(false);
      if (!picked || picked.kind !== 'image') return;
      reset();
      setLoaded({
        src: `${picked.url}?size=original`,
        width: picked.width,
        height: picked.height,
        assetId: picked.id,
        filename: picked.filename,
        owned: false,
      });
    },
    [reset],
  );

  // --- rotation ------------------------------------------------------------------------------------
  const rotate = (delta: 90 | -90) => {
    // Carry the crop through the turn so it keeps covering the same part of the PICTURE. Leaving it
    // alone would re-aim the selection: the box stays put on screen while the image moves under it.
    setCrop((c) => (c ? rotateRect(c, shown, delta) : null));
    setTurn((t) => addTurn(t, delta));
  };

  // --- crop dragging -------------------------------------------------------------------------------
  // All crop maths is in IMAGE pixels (of the turned image); the pointer is converted on the way in,
  // so a resized window or a scaled-down preview never changes what is saved.
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; base: Rect } | null>(null);

  const toImage = (e: ReactPointerEvent): { x: number; y: number } => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
  };

  /** Which handle (if any) a pointer landed on, in image pixels. */
  const handleAt = (p: { x: number; y: number }, rect: Rect): Handle | null => {
    const r = HANDLE_HIT / scale;
    const near = (hx: number, hy: number) => Math.abs(p.x - hx) <= r && Math.abs(p.y - hy) <= r;
    if (near(rect.x, rect.y)) return 'nw';
    if (near(rect.x + rect.w, rect.y)) return 'ne';
    if (near(rect.x, rect.y + rect.h)) return 'sw';
    if (near(rect.x + rect.w, rect.y + rect.h)) return 'se';
    if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) return 'move';
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!loaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    const grabbed = crop ? handleAt(p, crop) : null;
    if (crop && grabbed) {
      dragRef.current = { handle: grabbed, startX: p.x, startY: p.y, base: crop };
      return;
    }
    // Empty space starts a NEW selection from this point.
    dragRef.current = { handle: 'se', startX: p.x, startY: p.y, base: { x: p.x, y: p.y, w: 0, h: 0 } };
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toImage(e);
    const next =
      drag.base.w === 0 && drag.base.h === 0
        ? clampRect(rectFromPoints(drag.startX, drag.startY, p.x, p.y), shown)
        : resizeRect(drag.base, drag.handle, p.x - drag.startX, p.y - drag.startY, shown);
    setCrop(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    // A click with no drag clears the selection rather than leaving a 1px box behind.
    setCrop((c) => (c && (c.w < 2 || c.h < 2) ? null : c));
  };

  // --- export --------------------------------------------------------------------------------------
  /** The edit as the transform endpoint expresses it, or null when nothing has been changed. */
  const ops = useMemo(() => {
    const rounded = crop ? clampRect(roundRect(crop), shown) : null;
    const full = rounded && rounded.x === 0 && rounded.y === 0 && rounded.w === shown.width && rounded.h === shown.height;
    const body: { rotate?: 90 | 180 | 270; crop?: { left: number; top: number; width: number; height: number } } = {};
    if (turn !== 0) body.rotate = turn;
    if (rounded && !full) body.crop = { left: rounded.x, top: rounded.y, width: rounded.w, height: rounded.h };
    return body.rotate === undefined && body.crop === undefined ? null : body;
  }, [crop, shown, turn]);

  /** Render the current edit locally — for a download, and for uploading an IMPORTED file. */
  const renderBlob = useCallback(async (): Promise<Blob> => {
    const img = imgRef.current;
    if (!img || !loaded) throw new Error('nothing loaded');
    const rounded = crop ? clampRect(roundRect(crop), shown) : { x: 0, y: 0, w: shown.width, h: shown.height };
    const canvas = document.createElement('canvas');
    canvas.width = rounded.w;
    canvas.height = rounded.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas is unavailable');
    // Move to where the crop's top-left should land, turn, then draw the whole image: the untouched
    // parts fall outside the canvas and are simply not painted.
    ctx.translate(-rounded.x, -rounded.y);
    if (turn === 90) {
      ctx.translate(shown.width, 0);
      ctx.rotate(Math.PI / 2);
    } else if (turn === 180) {
      ctx.translate(shown.width, shown.height);
      ctx.rotate(Math.PI);
    } else if (turn === 270) {
      ctx.translate(0, shown.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(img, 0, 0, natural.width, natural.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', WEBP_QUALITY));
    if (!blob) throw new Error('could not encode the image');
    return blob;
  }, [crop, loaded, natural, shown, turn]);

  /** `name.jpg` → `name.webp`; the editor always writes WebP. */
  const webpName = (name: string, suffix = ''): string => `${name.replace(/\.[^./\\]+$/, '')}${suffix}.webp`;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : `${label} failed`;
      setError(message);
      toast.show(message);
    } finally {
      setBusy(false);
    }
  };

  const download = () =>
    run('Download', async () => {
      const blob = await renderBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = webpName(loaded!.filename);
      a.click();
      URL.revokeObjectURL(url);
    });

  /** In-place: replace the stored original. Destructive, so it asks first. */
  const saveInPlace = () =>
    run('Save', async () => {
      if (!loaded?.assetId || !ops || !projectId) return;
      const ok = await confirm({
        title: 'Overwrite the original?',
        message:
          'The stored image is replaced. Every page that uses it shows the edited version — the link does not change — and the original pixels cannot be recovered.',
        confirmLabel: 'Overwrite',
      });
      if (!ok) return;
      const { item } = await api.transformMedia(projectId, loaded.assetId, ops);
      reset();
      setLoaded((l) => (l ? { ...l, width: item.kind === 'image' ? item.width : l.width, height: item.kind === 'image' ? item.height : l.height } : l));
      setNonce((n) => n + 1);
      onSaved?.(item);
      toast.show('Saved — the original was replaced');
    });

  /** A NEW asset: either from the source asset (server-side) or from the rendered bytes (imported). */
  const saveAsNew = () =>
    run('Save as', async () => {
      if (!loaded) return;
      const suggested = webpName(loaded.filename, loaded.assetId ? '-edited' : '');
      const name = await prompt({ title: 'Save as a new file', label: 'File name', initial: suggested });
      if (!name) return;
      const filename = webpName(name);
      if (!projectId) throw new Error('open a project to save to its library');
      if (loaded.assetId && ops) {
        const { item } = await api.transformMedia(projectId, loaded.assetId, { ...ops, format: 'webp', saveAs: { filename } });
        onSaved?.(item);
      } else {
        const blob = await renderBlob();
        const { item } = await api.uploadMedia(projectId, new File([blob], filename, { type: 'image/webp' }));
        onSaved?.(item);
      }
      toast.show(`Saved to the library as ${filename}`);
    });

  const canSaveInPlace = Boolean(loaded?.assetId) && ops !== null && Boolean(projectId);
  const canExport = loaded !== null;
  /** Saving anywhere means writing to a project's library. */
  const canSaveToLibrary = canExport && Boolean(projectId);

  return (
    <Modal title="Image editor" size="studio" onClose={onClose}>
      {dialog}
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostButton} onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-1 inline h-4 w-4" /> Upload
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = ''; // re-picking the SAME file must fire change again
            }}
          />
          <button type="button" className={ghostButton} onClick={() => setPickerOpen(true)} disabled={busy || !projectId}>
            From library
          </button>
          <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" aria-hidden />
          <button type="button" className={ghostButton} onClick={() => rotate(-90)} disabled={!loaded || busy} aria-label="Rotate left">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" className={ghostButton} onClick={() => rotate(90)} disabled={!loaded || busy} aria-label="Rotate right">
            <RotateCw className="h-4 w-4" />
          </button>
          <button type="button" className={ghostButton} onClick={() => setCrop(null)} disabled={!crop || busy}>
            <Crop className="mr-1 inline h-4 w-4" /> Clear crop
          </button>
          <button type="button" className={ghostButton} onClick={reset} disabled={!loaded || (turn === 0 && !crop) || busy}>
            Reset
          </button>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={ghostButton} onClick={() => void download()} disabled={!canExport || busy}>
              <Download className="mr-1 inline h-4 w-4" /> Download
            </button>
            <button type="button" className={ghostButton} onClick={() => void saveAsNew()} disabled={!canSaveToLibrary || busy}>
              {loaded?.assetId ? 'Save as…' : 'Save to library'}
            </button>
            {loaded?.assetId && (
              <button type="button" className={primaryButton} onClick={() => void saveInPlace()} disabled={!canSaveInPlace || busy}>
                <Save className="mr-1 inline h-4 w-4" /> Save
              </button>
            )}
          </span>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        )}

        {/* Canvas / drop zone */}
        <div
          ref={paneRef}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            loadFile(e.dataTransfer.files?.[0]);
          }}
          className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
            dragOver ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10' : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-900/40'
          }`}
        >
          {!loaded ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <p className="font-medium text-slate-700 dark:text-slate-200">Drop an image here</p>
              <p className="mt-1">or use Upload / From library. Rotate in quarter-turns, drag a rectangle to crop.</p>
            </div>
          ) : (
            <div className="relative" style={{ width: viewW, height: viewH }}>
              {/* The image is presented ROTATED via CSS while the crop maths works in image pixels —
                  the two never disagree because both are derived from `shown`. */}
              <img
                ref={imgRef}
                key={`${loaded.src}#${nonce}`}
                src={nonce > 0 ? `${loaded.src}${loaded.src.includes('?') ? '&' : '?'}v=${nonce}` : loaded.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: Math.round(natural.width * scale),
                  height: Math.round(natural.height * scale),
                  transform: `translate(-50%, -50%) rotate(${turn}deg)`,
                }}
              />
              {/* Crop surface — sits over the image and owns every pointer event. */}
              <div
                role="application"
                aria-label="Crop area"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="absolute inset-0 cursor-crosshair touch-none"
              >
                {crop && (
                  <>
                    {/* Dim everything OUTSIDE the selection, so the kept region is the bright one. */}
                    <div
                      className="pointer-events-none absolute inset-0 bg-slate-900/50"
                      style={{
                        clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${crop.x * scale}px ${crop.y * scale}px, ${crop.x * scale}px ${(crop.y + crop.h) * scale}px, ${(crop.x + crop.w) * scale}px ${(crop.y + crop.h) * scale}px, ${(crop.x + crop.w) * scale}px ${crop.y * scale}px, ${crop.x * scale}px ${crop.y * scale}px)`,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
                      style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
                    >
                      {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                        <span
                          key={h}
                          aria-hidden
                          className="absolute h-3 w-3 rounded-sm border border-slate-700 bg-white"
                          style={{
                            left: h === 'nw' || h === 'sw' ? -6 : undefined,
                            right: h === 'ne' || h === 'se' ? -6 : undefined,
                            top: h === 'nw' || h === 'ne' ? -6 : undefined,
                            bottom: h === 'sw' || h === 'se' ? -6 : undefined,
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Readout — the numbers that decide what gets saved. */}
        {loaded && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {loaded.filename} · {natural.width}×{natural.height}
            </span>
            {turn !== 0 && <span>rotated {turn}°</span>}
            {crop ? (
              <span>
                crop {Math.round(crop.w)}×{Math.round(crop.h)} at {Math.round(crop.x)},{Math.round(crop.y)}
              </span>
            ) : (
              <span>no crop — the whole image</span>
            )}
            <span className="ml-auto">Exports as WebP</span>
          </p>
        )}
      </div>

      {pickerOpen && projectId && (
        <FilePicker
          projectId={projectId}
          accept={(a) => a.kind === 'image' && (a as { format?: string }).format !== 'svg'}
          title="Choose an image to edit"
          onPick={pickFromLibrary}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </Modal>
  );
}

/** Re-exported so a host can render the studio's close affordance consistently. */
export const IMAGE_EDITOR_CLOSE_ICON = X;
