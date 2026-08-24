import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedWork } from '../../../lib/unsaved-work';
import type { ImageMap, ImageMapObject, ImageMapTemplate } from '@sitewright/schema';
import { Modal } from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { useCopy } from '../../ui/useCopy';
import { api } from '../../../api';
import { fieldLabel, ghostButton, glassInput, primaryButton, saveSurface, toggleInput } from '../../../theme';
import { Canvas, type DrawSpec } from './Canvas';
import { useDialogs } from '../../ui/Dialogs';
import { ACCEPT_IMAGE, ObjectDetails, AssetField } from './ObjectDetails';
import { FilePicker } from '../../files/FilePicker';
import {
  DRAWABLE_TYPES,
  TYPE_LABELS,
  artboardSize,
  countHotspots,
  emptyMap,
  findObject,
  flattenObjects,
  mapArtboard,
  mapObject,
  newArtboard,
  newId,
  newObject,
  polyFromPoints,
  sizedObject,
  RUNTIME_ARTBOARD_SIZE,
  DEFAULT_PALETTE,
  type DrawableType,
  type HotspotPalette,
} from './model';

/**
 * The IMAGE MAP STUDIO — build an interactive hotspot map: pick a background, draw regions over it,
 * give each a tooltip and an action, and arrange them across artboards (floors, layers).
 *
 * A map is ordinary project content (`imagemap`), so this is a plain load → edit → PUT loop with the
 * schema validating on the way in. Nothing here talks to the runtime: the Studio edits the CONFIG,
 * and the same config is what `{{sw-imagemap "id"}}` renders on a page.
 */

interface ImageMapStudioProps {
  onClose: () => void;
  projectId?: string;
  /**
   * Open straight onto this map instead of the list — how a click on a map in the PAGE EDITOR arrives
   * here. The map is edited where maps are edited; there is no second, lesser editor on the page.
   */
  initialMapId?: string;
  /** A map was saved. The page editor re-renders its preview so the change shows without a reload. */
  onSaved?: (id: string) => void;
}

type View =
  | { kind: 'list' }
  | { kind: 'edit'; id: string }
  // A DEMO is looked at, never edited — and never copied into the project. See `demo` below.
  | { kind: 'demo'; template: ImageMapTemplate };

export function ImageMapStudio({ onClose, projectId, initialMapId, onSaved }: ImageMapStudioProps) {
  const toast = useToast();
  const { confirm, dialog } = useDialogs();
  // The project's CI tokens: every new hotspot is born in the brand's colours, and every colour
  // control offers them as one-click swatches. Best-effort — a project with no settings yet just
  // gets the platform defaults.
  const [palette, setPalette] = useState<ReadonlyArray<{ key: string; value: string }>>([]);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [maps, setMaps] = useState<ImageMap[]>([]);
  const [templates, setTemplates] = useState<ImageMapTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Raised by the open editor. The modal closes on Escape and on a backdrop click, and a map is a
  // lot of positioning to redo, so an unsaved editor asks first.
  const [dirty, setDirty] = useState(false);

  // Deep-link into one map, ONCE the maps are loaded — `editing` is resolved against this list, so
  // switching the view before it arrives would render an empty editor. A ref, not state: re-running on
  // every reload would drag an author back to this map after they navigated away.
  const jumpedRef = useRef(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [mapsRes, tplRes] = await Promise.all([api.listImageMaps(projectId), api.listImageMapTemplates()]);
      setMaps(mapsRes.items);
      setTemplates(tplRes.templates);
    } catch {
      toast.show('Could not load image maps', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void api
      .getSettings(projectId)
      .then((res) => {
        const colors = (res.item?.identity as { colors?: Record<string, string> } | undefined)?.colors ?? {};
        const tokens = Object.entries(colors)
          .filter(([, v]) => typeof v === 'string' && v !== '')
          .map(([key, value]) => ({ key, value }));
        if (live) setPalette(tokens);
      })
      .catch(() => {
        /* the swatch row is an assist; its absence must never block the Studio */
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  // Deep link: once the maps are in, open the requested one. Guarded by a ref so a later reload of the
  // list (after a save, or coming back from a demo) cannot yank an author back to where they started.
  useEffect(() => {
    if (jumpedRef.current || !initialMapId || loading) return;
    if (!maps.some((m) => m.id === initialMapId)) return;
    jumpedRef.current = true;
    setView({ kind: 'edit', id: initialMapId });
  }, [initialMapId, loading, maps]);

  async function createBlank(): Promise<void> {
    if (!projectId) return;
    const name = 'Untitled map';
    const map = emptyMap(newId('map'), name);
    setBusy(true);
    try {
      await api.putImageMap(projectId, map);
      await load();
      setView({ kind: 'edit', id: map.id });
    } catch {
      toast.show('Could not create the map', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Open a DEMO. It renders straight from the bundled config and writes NOTHING into the project.
   *
   * ★ It used to MATERIALISE the template — a new map in the project, its images copied into the
   * media library — just from clicking it. Looking at an example is not the same as wanting a copy
   * of it, and undoing that meant deleting a map plus the assets it dragged in.
   */
  function openDemo(template: ImageMapTemplate): void {
    setView({ kind: 'demo', template });
  }

  async function remove(map: ImageMap): Promise<void> {
    if (!projectId) return;
    // A real dialog, not window.confirm — the platform has `useDialogs` for exactly this, and a
    // native confirm is unstyled, unthemeable and blocks the whole tab.
    const ok = await confirm({
      title: `Delete “${map.general.name}”?`,
      message: 'Any page embedding this map will fail to render until you remove the reference.',
      confirmLabel: 'Delete map',
    });
    if (!ok) return;
    try {
      await api.deleteImageMap(projectId, map.id);
      await load();
    } catch {
      toast.show('Could not delete the map', 'error');
    }
  }

  const editing = view.kind === 'edit' ? maps.find((m) => m.id === view.id) : undefined;

  return (
    <Modal
      title={editing ? `Image Map — ${editing.general.name}` : 'Image Maps'}
      onClose={onClose}
      size="screen"
      onBeforeClose={async () =>
        !dirty ||
        (await confirm({
          title: 'Close the studio?',
          message: 'This map has unsaved changes. Closing loses them.',
          confirmLabel: 'Discard changes',
        }))
      }
    >
      {!projectId ? (
        <p className="p-6 text-sm text-slate-600 dark:text-slate-300">Open a project to build image maps.</p>
      ) : editing ? (
        <MapEditor
          key={editing.id}
          map={editing}
          projectId={projectId}
          palette={palette}
          onSaved={onSaved}
          confirmLeave={() =>
            confirm({
              title: 'Leave this map?',
              message: 'It has unsaved changes. Leaving loses them.',
              confirmLabel: 'Discard changes',
            })
          }
          onDirtyChange={setDirty}
          onBack={() => {
            setView({ kind: 'list' });
            setDirty(false);
            void load();
          }}
        />
      ) : view.kind === 'demo' ? (
        <DemoPreview projectId={projectId} template={view.template} onBack={() => setView({ kind: 'list' })} />
      ) : (
        <MapList
          maps={maps}
          templates={templates}
          loading={loading}
          busy={busy}
          onOpen={(id) => setView({ kind: 'edit', id })}
          onCreateBlank={createBlank}
          onCreateFromTemplate={openDemo}
          onDelete={remove}
        />
      )}
      {/* The confirm/prompt host. One per Studio; the dialogs stack over this modal correctly. */}
      {dialog}
    </Modal>
  );
}

/**
 * A DEMO, shown running and nothing else.
 *
 * No editor: a demo exists to answer "what can this thing do", and giving it an editor invites
 * changes to something that is not the author's and cannot be saved. No project write either — see
 * `openDemo`.
 */
function DemoPreview({ projectId, template, onBack }: { projectId: string; template: ImageMapTemplate; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        <button type="button" className={ghostButton} onClick={onBack}>
          ← All maps
        </button>
        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{template.name}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {template.summary} · {template.hotspots} hotspots
        </span>
        <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Example — nothing is added to your project
        </span>
      </div>
      <iframe
        title={`${template.name} demo`}
        data-testid="imap-demo-frame"
        src={api.imageMapPreviewUrl(projectId, { template: template.id })}
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}

function MapList({
  maps,
  templates,
  loading,
  busy,
  onOpen,
  onCreateBlank,
  onCreateFromTemplate,
  onDelete,
}: {
  maps: ImageMap[];
  templates: ImageMapTemplate[];
  loading: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onCreateBlank: () => void;
  onCreateFromTemplate: (t: ImageMapTemplate) => void;
  onDelete: (m: ImageMap) => void;
}) {
  const [, copy] = useCopy();
  return (
    <div className="space-y-6 p-5">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Your maps</h3>
          <button type="button" className={primaryButton} disabled={busy} onClick={onCreateBlank}>
            New map
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : maps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center dark:border-slate-600">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No image maps yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Create one, drop in the image you want to make interactive, then trace the parts of it that should respond
              — a floor plan’s rooms, a product’s parts, a map’s regions.
            </p>
            <button type="button" className={`${primaryButton} mt-3`} disabled={busy} onClick={onCreateBlank}>
              New map
            </button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {maps.map((m) => (
              <li key={m.id}>
                {/* The author's OWN maps are the point of this screen, so they read as the primary
                    thing: a card with real presence and the platform's lift-on-hover, against the
                    quieter example tiles below. */}
                <div className="waves-effect group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-lg dark:border-slate-700 dark:bg-white/5 dark:hover:border-sky-500">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(m.id)}>
                    <span className="block truncate text-sm font-bold text-slate-900 group-hover:text-sky-700 dark:text-slate-100 dark:group-hover:text-sky-300">
                      {m.general.name}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                      {m.artboards.length} artboard{m.artboards.length === 1 ? '' : 's'} · {countHotspots(m)} hotspot
                      {countHotspots(m) === 1 ? '' : 's'}
                    </span>
                  </button>
                  <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2 dark:border-slate-700/60">
                    <button
                      type="button"
                      className={`${ghostButton} px-2 py-1 text-[11px]`}
                      onClick={() => copy(`{{sw-imagemap "${m.id}"}}`, m.id)}
                      title="Copy the embed code for a page"
                    >
                      Copy embed
                    </button>
                    <button
                      type="button"
                      className={`${ghostButton} ml-auto px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400`}
                      onClick={() => onDelete(m)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-bold text-slate-800 dark:text-slate-100">Examples</h3>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Finished maps to open and pick apart — how a floor switcher is wired, what a tooltip can hold, how a traced
          region is shaped. They’re demonstrations, not starting points: your own map begins with your own image. Opening
          one copies its images into this project’s media library.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onCreateFromTemplate(t)}
                className="h-full w-full rounded-xl border border-slate-200 p-3 text-left transition hover:border-slate-400 disabled:opacity-50 dark:border-slate-700 dark:hover:border-slate-500"
              >
                <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{t.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{t.summary}</span>
                <span className="mt-1.5 block text-[11px] text-slate-500 dark:text-slate-400">
                  {t.artboards} artboard{t.artboards === 1 ? '' : 's'} · {t.hotspots} hotspots
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MapEditor({
  map: initial,
  projectId,
  palette,
  confirmLeave,
  onBack,
  onDirtyChange,
  onSaved,
}: {
  map: ImageMap;
  projectId: string;
  /** The project's CI tokens — swatches on every colour control, and the colours a new hotspot gets. */
  palette: ReadonlyArray<{ key: string; value: string }>;
  /** Ask before discarding unsaved work. Owned by the shell, which renders the dialog. */
  confirmLeave: () => Promise<boolean>;
  onBack: () => void;
  /** Lifted so the enclosing modal can guard Escape / backdrop-click on unsaved work. */
  onDirtyChange: (dirty: boolean) => void;
  /** Announce a successful save, so a surface that EMBEDS this map can re-render itself. */
  onSaved?: (id: string) => void;
}) {
  const toast = useToast();
  const [map, setMap] = useState<ImageMap>(initial);
  const [artboardId, setArtboardId] = useState(initial.artboards[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<DrawableType | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The live PREVIEW: the saved map rendered by the real runtime, in the real preview document.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const artboard = useMemo(
    () => map.artboards.find((a) => a.id === artboardId) ?? map.artboards[0],
    [map, artboardId],
  );
  const selected = selectedId && artboard ? findObject(artboard, selectedId) : undefined;

  // Warn before losing unsaved work — a map is a lot of positioning to redo. This was the only surface
  // that guarded leaving the page; the guard now lives in one place and every editor shares it.
  useUnsavedWork(dirty, 'Image map');

  /**
   * Apply an update to the map.
   *
   * An UPDATER, not a value: the image probe below lands after an await, by which time a captured
   * `map` would be stale and would undo whatever the author did while the image was loading.
   */
  const editWith = useCallback(
    (update: (current: ImageMap) => ImageMap): void => {
      setMap(update);
      setDirty(true);
      onDirtyChange(true);
    },
    [onDirtyChange],
  );

  const edit = useCallback((next: ImageMap): void => editWith(() => next), [editWith]);

  const patchObject = useCallback(
    (id: string, patch: Partial<ImageMapObject>): void => {
      if (!artboard) return;
      edit(mapArtboard(map, artboard.id, (a) => mapObject(a, id, (obj) => ({ ...obj, ...patch }))));
    },
    [artboard, edit, map],
  );

  /**
   * Show the map as a VISITOR gets it: the real runtime, and NOTHING else.
   *
   * It renders through the map-only preview document — no page, no header, no footer, no site
   * typography. The first version embedded the map in a whole project page, which wrapped the thing
   * under inspection in a lot of things that were not it.
   *
   * The server previews the STORED map, so unsaved work is saved first.
   */
  async function togglePreview(): Promise<void> {
    if (previewSrc) {
      setPreviewSrc(null);
      return;
    }
    setPreviewing(true);
    try {
      if (dirty) await save();
      setPreviewSrc(api.imageMapPreviewUrl(projectId, { map: map.id }));
    } catch (err) {
      toast.show(err instanceof Error ? `Could not build the preview: ${err.message}` : 'Could not build the preview', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await api.putImageMap(projectId, map);
      setDirty(false);
      onDirtyChange(false);
      onSaved?.(map.id);
      toast.show('Map saved', 'success');
    } catch (err) {
      // The schema is the authority; surface WHY rather than a generic failure.
      toast.show(err instanceof Error ? `Could not save: ${err.message}` : 'Could not save the map', 'error');
    } finally {
      setSaving(false);
    }
  }

  function draw(type: DrawableType, spec: DrawSpec): void {
    if (!artboard) return;
    const title = `${TYPE_LABELS[type]} ${flattenObjects(artboard).length + 1}`;
    // Born in the project's own colours: CI primary at rest, secondary on hover.
    const colors: HotspotPalette = {
      fill: palette.find((c) => c.key === 'primary')?.value ?? DEFAULT_PALETTE.fill,
      hoverFill: palette.find((c) => c.key === 'secondary')?.value ?? DEFAULT_PALETTE.hoverFill,
    };
    const obj =
      spec.kind === 'poly'
        ? polyFromPoints(spec.points, title, colors)
        : spec.kind === 'bounds'
          ? sizedObject(type, spec.bounds, title, colors)
          : newObject(type, spec.x, spec.y, title, colors);
    edit(mapArtboard(map, artboard.id, (a) => ({ ...a, children: [...(a.children ?? []), obj] })));
    setSelectedId(obj.id);
    // The polygon tool stays in hand: tracing one region is almost never the whole job, and picking
    // the tool again between every outline is the friction that made this feature unusable. The box
    // shapes drop back to select, so the author can adjust what they just drew.
    if (type !== 'poly') setDrawing(null);
  }

  /**
   * Point the artboard at an image and take the artboard's size FROM that image.
   *
   * The size matters as much as the URL: the artboard's own width/height set the aspect ratio the
   * runtime lays hotspots out in, so an artboard shaped differently from its background stretches
   * every region the author draws. The probe is fire-and-forget — the URL applies at once, and the
   * dimensions follow a beat later without blocking the picker.
   */
  const setBackground = useCallback(
    (url: string, artboardIdForImage: string): void => {
      editWith((current) =>
        mapArtboard(current, artboardIdForImage, (a) => ({
          ...a,
          image_url: url,
          background_type: url ? 'image' : 'color',
        })),
      );
      if (!url) return;
      const probe = new Image();
      probe.onload = () => {
        if (!probe.naturalWidth || !probe.naturalHeight) return;
        editWith((current) =>
          mapArtboard(current, artboardIdForImage, (a) => ({ ...a, width: probe.naturalWidth, height: probe.naturalHeight })),
        );
      };
      probe.src = url;
    },
    [editWith],
  );

  /** An image file dropped on the canvas: into the media library first, so the export stays whole. */
  async function dropImage(file: File): Promise<void> {
    if (!artboard) return;
    setUploading(true);
    try {
      const { item } = await api.uploadMedia(projectId, file);
      setBackground(item.url, artboard.id);
      toast.show(`“${file.name}” added to your library`, 'success');
    } catch (err) {
      toast.show(err instanceof Error ? `Could not add that image: ${err.message}` : 'Could not add that image', 'error');
    } finally {
      setUploading(false);
    }
  }

  function addArtboard(): void {
    const a = newArtboard(`Artboard ${map.artboards.length + 1}`);
    edit({ ...map, artboards: [...map.artboards, a] });
    setArtboardId(a.id);
    setSelectedId(null);
  }

  function removeArtboard(id: string): void {
    if (map.artboards.length === 1) {
      toast.show('A map needs at least one artboard', 'error');
      return;
    }
    const next = map.artboards.filter((a) => a.id !== id);
    edit({ ...map, artboards: next });
    if (artboardId === id) setArtboardId(next[0]!.id);
    setSelectedId(null);
  }

  if (!artboard) return <p className="p-6 text-sm">This map has no artboards.</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        <button
          type="button"
          className={ghostButton}
          onClick={() => {
            void (async () => {
              if (dirty && !(await confirmLeave())) return;
              onBack();
            })();
          }}
        >
          ← All maps
        </button>
        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-xs text-slate-500 dark:text-slate-400">Draw:</span>
        {DRAWABLE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDrawing(drawing === t ? null : t)}
            className={`rounded-lg px-2 py-1 text-xs ${
              drawing === t
                ? 'bg-sky-500 font-bold text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {/* ONE button in ONE place. Preview and "back to editing" are the same action — a
              toggle — so they must not jump between two positions as the mode flips. */}
          <button type="button" className={ghostButton} disabled={previewing} onClick={() => void togglePreview()}>
            {previewing ? 'Building…' : previewSrc ? 'Back to editing' : 'Preview'}
          </button>
          {!previewSrc && (
            <button type="button" className={ghostButton} onClick={() => setShowSettings((v) => !v)}>
              Map settings
            </button>
          )}
          <button
            type="button"
            // Gradient only when there is something to save (see `saveSurface`).
            className={`${saveSurface(dirty)} waves-effect inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-60`}
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {previewSrc ? (
        /* PREVIEW TAKES THE WHOLE BODY. Every rail, tool and inspector goes away: the point of the
           mode is to see the map as a visitor does, and a map is a wide thing that was being judged
           through a slot between two sidebars. */
        <iframe
          title="Image map preview"
          data-testid="imap-preview-frame"
          /* `src`, never `srcDoc`: a srcdoc document inherits THIS app's script-src, which blocks the
             inlined runtime — the map would render its fallback image and nothing else, the very
             failure this pane exists to reveal. */
          src={previewSrc}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
      <div className="flex min-h-0 flex-1">
        {/* Left: artboards + object list */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700">
          <div className="border-b border-slate-200 p-2 dark:border-slate-700">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Artboards</span>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100" onClick={addArtboard}>
                + Add
              </button>
            </div>
            <ul className="space-y-0.5">
              {map.artboards.map((a) => (
                <li key={a.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setArtboardId(a.id);
                      setSelectedId(null);
                    }}
                    className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs ${
                      a.id === artboard.id
                        ? 'bg-slate-200 font-bold text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {a.title || a.id}
                  </button>
                  <button type="button" aria-label={`Delete ${a.title}`} className="px-1 text-slate-500 dark:text-slate-400 hover:text-rose-600" onClick={() => removeArtboard(a.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Hotspots
            </span>
            <ul className="space-y-0.5">
              {flattenObjects(artboard).map(({ obj, depth }) => (
                <li key={obj.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(obj.id)}
                    style={{ paddingLeft: 8 + depth * 12 }}
                    className={`w-full truncate rounded py-1 pr-2 text-left text-xs ${
                      obj.id === selectedId
                        ? 'bg-sky-100 font-bold text-sky-900 dark:bg-sky-900/40 dark:text-sky-100'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {obj.title || TYPE_LABELS[obj.type ?? 'spot'] || obj.id}
                  </button>
                </li>
              ))}
              {flattenObjects(artboard).length === 0 && (
                <li className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
                  No hotspots on this artboard. Pick a shape above and click the canvas.
                </li>
              )}
            </ul>
          </div>
        </aside>

        {/* Middle: the canvas */}
        <div className="min-w-0 flex-1">
          {showSettings ? (
            <MapSettings
              map={map}
              artboardId={artboard.id}
              projectId={projectId}
              onChange={edit}
              onSetBackground={(url) => setBackground(url, artboard.id)}
              onClose={() => setShowSettings(false)}
            />
          ) : (
            <Canvas
              artboard={artboard}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={patchObject}
              drawing={drawing}
              onDraw={draw}
              onCancelDraw={() => setDrawing(null)}
              onPickImage={() => setPicking(true)}
              onDropImage={(file) => void dropImage(file)}
              uploading={uploading}
            />
          )}
        </div>

        {/* Right: the selected hotspot */}
        <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-700">
          {selected ? (
            <ObjectDetails
              map={map}
              object={selected}
              projectId={projectId}
              onChange={(patch) => patchObject(selected.id, patch)}
              palette={palette}
              onDelete={() => {
                edit(mapArtboard(map, artboard.id, (a) => mapObject(a, selected.id, () => null)));
                setSelectedId(null);
              }}
            />
          ) : (
            <p className="p-4 text-xs text-slate-500 dark:text-slate-400">
              Select a hotspot to edit it, or pick a shape from the toolbar and draw one on the canvas.
            </p>
          )}
        </aside>
      </div>
      )}

      {picking && (
        <FilePicker
          projectId={projectId}
          accept={ACCEPT_IMAGE}
          title="Choose the image to make interactive"
          onPick={(url) => setBackground(url, artboard.id)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function MapSettings({
  map,
  artboardId,
  projectId,
  onChange,
  onSetBackground,
  onClose,
}: {
  map: ImageMap;
  artboardId: string;
  projectId: string;
  onChange: (map: ImageMap) => void;
  /** Set the artboard's background AND take its size from the image — see the editor's setBackground. */
  onSetBackground: (url: string) => void;
  onClose: () => void;
}) {
  const artboard = map.artboards.find((a) => a.id === artboardId);
  const size = artboardSize(artboard);
  const setSize = (patch: { width?: number; height?: number }): void =>
    onChange(mapArtboard(map, artboardId, (a) => ({ ...a, ...size, ...patch })));
  const flag = (bag: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean => {
    const v = bag?.[key];
    return typeof v === 'boolean' ? v : fallback;
  };
  const setBag = (key: 'zooming' | 'fullscreen' | 'object_list' | 'tooltips', patch: Record<string, unknown>): void =>
    onChange({ ...map, [key]: { ...((map[key] ?? {}) as Record<string, unknown>), ...patch } });

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Map settings</h3>
        <button type="button" className={ghostButton} onClick={onClose}>
          Back to canvas
        </button>
      </div>

      <div className="grid max-w-2xl gap-4">
        <div>
          <label className={fieldLabel} htmlFor="imap-name">
            Name
          </label>
          <input
            id="imap-name"
            className={glassInput}
            value={map.general.name}
            onChange={(e) => onChange({ ...map, general: { ...map.general, name: e.target.value } })}
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Also what a page’s <code>data-sw-imap-map</code> attribute matches, when a page hosts more than one map.
          </p>
        </div>

        {artboard && (
          <div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={fieldLabel} htmlFor="imap-w">
                  Artboard width (px)
                </label>
                <input
                  id="imap-w"
                  className={glassInput}
                  type="number"
                  value={size.width}
                  onChange={(e) => setSize({ width: Number.parseInt(e.target.value, 10) || RUNTIME_ARTBOARD_SIZE.width })}
                />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="imap-h">
                  Artboard height (px)
                </label>
                <input
                  id="imap-h"
                  className={glassInput}
                  type="number"
                  value={size.height}
                  onChange={(e) => setSize({ height: Number.parseInt(e.target.value, 10) || RUNTIME_ARTBOARD_SIZE.height })}
                />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              This artboard’s own size — it sets the shape hotspots are laid out in, so it should match its background
              image. Choosing an image sets both for you.
            </p>
          </div>
        )}

        {artboard && (
          <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              “{artboard.title || artboard.id}” background
            </legend>
            <div className="space-y-2">
              <div>
                <label className={fieldLabel} htmlFor="imap-ab-title">
                  Artboard name
                </label>
                <input
                  id="imap-ab-title"
                  className={glassInput}
                  value={artboard.title ?? ''}
                  onChange={(e) =>
                    onChange({ ...map, artboards: map.artboards.map((a) => (a.id === artboard.id ? { ...a, title: e.target.value } : a)) })
                  }
                />
              </div>
              <AssetField
                id="imap-ab-image"
                label="Background image"
                accept={ACCEPT_IMAGE}
                projectId={projectId}
                value={artboard.image_url ?? ''}
                placeholder="Choose from the media library"
                onChange={onSetBackground}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Pick from this project’s library so the published site stays self-contained.
              </p>
            </div>
          </fieldset>
        )}

        <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">Visitor controls</legend>
          <div className="space-y-2">
            <div>
              <label className={fieldLabel} htmlFor="imap-tooltip-anim">
                Tooltip animation
              </label>
              <select
                id="imap-tooltip-anim"
                className={glassInput}
                value={String((map.tooltips as Record<string, unknown> | undefined)?.tooltip_animation ?? 'fade-up')}
                onChange={(e) => setBag('tooltips', { tooltip_animation: e.target.value })}
              >
                <option value="fade-up">Fade up (default)</option>
                <option value="fade">Fade</option>
                <option value="grow">Grow</option>
                <option value="none">None</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                A tooltip travels away from its hotspot as it fades in. Visitors who ask for reduced motion get it
                instantly either way.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className={toggleInput}
                checked={flag(map.zooming as Record<string, unknown> | undefined, 'enable_zooming', false)}
                onChange={(e) => setBag('zooming', { enable_zooming: e.target.checked })}
              />
              Zoom and pan
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className={toggleInput}
                checked={flag(map.fullscreen as Record<string, unknown> | undefined, 'enable_fullscreen_mode', false)}
                onChange={(e) => setBag('fullscreen', { enable_fullscreen_mode: e.target.checked })}
              />
              Fullscreen button
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className={toggleInput}
                checked={flag(map.object_list as Record<string, unknown> | undefined, 'enable_object_list', false)}
                onChange={(e) => setBag('object_list', { enable_object_list: e.target.checked })}
              />
              Side list of hotspots
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className={toggleInput}
                checked={flag(map.object_list as Record<string, unknown> | undefined, 'enable_search', false)}
                onChange={(e) => setBag('object_list', { enable_search: e.target.checked })}
              />
              Search box in that list
            </label>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
