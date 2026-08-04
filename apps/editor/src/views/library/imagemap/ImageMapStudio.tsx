import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImageMap, ImageMapObject, ImageMapTemplate } from '@sitewright/schema';
import { Modal } from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { useCopy } from '../../ui/useCopy';
import { api } from '../../../api';
import { fieldLabel, ghostButton, glassInput, primaryButton, toggleInput } from '../../../theme';
import { Canvas, type DrawSpec } from './Canvas';
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
  type DrawableType,
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
}

type View = { kind: 'list' } | { kind: 'edit'; id: string };

export function ImageMapStudio({ onClose, projectId }: ImageMapStudioProps) {
  const toast = useToast();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [maps, setMaps] = useState<ImageMap[]>([]);
  const [templates, setTemplates] = useState<ImageMapTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Raised by the open editor. The modal closes on Escape and on a backdrop click, and a map is a
  // lot of positioning to redo, so an unsaved editor asks first.
  const [dirty, setDirty] = useState(false);

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

  async function createFromTemplate(template: ImageMapTemplate): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    try {
      const { item, importedImages } = await api.createImageMapFromTemplate(projectId, { template: template.id });
      await load();
      setView({ kind: 'edit', id: item.id });
      toast.show(importedImages > 0
          ? `Added “${template.name}” — ${importedImages} image${importedImages === 1 ? '' : 's'} copied into your library`
          : `Added “${template.name}”`,
        'success',
      );
    } catch {
      toast.show('Could not create the map from that template', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(map: ImageMap): Promise<void> {
    if (!projectId) return;
    if (!window.confirm(`Delete “${map.general.name}”? Any page embedding it will fail to render until the reference is removed.`)) return;
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
      size="studio"
      onBeforeClose={() =>
        !dirty || window.confirm('This map has unsaved changes. Close the studio and lose them?')
      }
    >
      {!projectId ? (
        <p className="p-6 text-sm text-slate-600 dark:text-slate-300">Open a project to build image maps.</p>
      ) : editing ? (
        <MapEditor
          key={editing.id}
          map={editing}
          projectId={projectId}
          onDirtyChange={setDirty}
          onBack={() => {
            setView({ kind: 'list' });
            setDirty(false);
            void load();
          }}
        />
      ) : (
        <MapList
          maps={maps}
          templates={templates}
          loading={loading}
          busy={busy}
          onOpen={(id) => setView({ kind: 'edit', id })}
          onCreateBlank={createBlank}
          onCreateFromTemplate={createFromTemplate}
          onDelete={remove}
        />
      )}
    </Modal>
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
          <ul className="grid gap-2 sm:grid-cols-2">
            {maps.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(m.id)}>
                  <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{m.general.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {m.artboards.length} artboard{m.artboards.length === 1 ? '' : 's'} · {countHotspots(m)} hotspot
                    {countHotspots(m) === 1 ? '' : 's'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`${ghostButton} px-2 py-1 text-[11px]`}
                  onClick={() => copy(`{{sw-imagemap "${m.id}"}}`, m.id)}
                  title="Copy the embed code for a page"
                >
                  Copy embed
                </button>
                <button type="button" className={`${ghostButton} px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400`} onClick={() => onDelete(m)}>
                  Delete
                </button>
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
                <span className="mt-1.5 block text-[11px] text-slate-400 dark:text-slate-500">
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
  onBack,
  onDirtyChange,
}: {
  map: ImageMap;
  projectId: string;
  onBack: () => void;
  /** Lifted so the enclosing modal can guard Escape / backdrop-click on unsaved work. */
  onDirtyChange: (dirty: boolean) => void;
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

  const artboard = useMemo(
    () => map.artboards.find((a) => a.id === artboardId) ?? map.artboards[0],
    [map, artboardId],
  );
  const selected = selectedId && artboard ? findObject(artboard, selectedId) : undefined;

  // Warn before losing unsaved work — a map is a lot of positioning to redo.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

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

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await api.putImageMap(projectId, map);
      setDirty(false);
      onDirtyChange(false);
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
    const obj =
      spec.kind === 'poly'
        ? polyFromPoints(spec.points, title)
        : spec.kind === 'bounds'
          ? sizedObject(type, spec.bounds, title)
          : newObject(type, spec.x, spec.y, title);
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
            if (dirty && !window.confirm('This map has unsaved changes. Leave and lose them?')) return;
            onBack();
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
          <button type="button" className={ghostButton} onClick={() => setShowSettings((v) => !v)}>
            Map settings
          </button>
          <button type="button" className={primaryButton} disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: artboards + object list */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700">
          <div className="border-b border-slate-200 p-2 dark:border-slate-700">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Artboards</span>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-100" onClick={addArtboard}>
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
                  <button type="button" aria-label={`Delete ${a.title}`} className="px-1 text-slate-400 hover:text-rose-600" onClick={() => removeArtboard(a.id)}>
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
