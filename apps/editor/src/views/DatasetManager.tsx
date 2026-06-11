import { useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Dataset, Entry, Field, FieldType } from '@sitewright/schema';
import { compareEntryOrder } from '@sitewright/core';
import { api, type Project } from '../api';
import { defaultEntryValues, entryLabel, identifierize, reorderByKey, reorderWithInsert, slugify, uniqueSlug } from '../lib/entry-form';
import { EntryEditorModal } from './datasets/EntryEditorModal';
import { RenameDatasetModal } from './datasets/RenameDatasetModal';
import { SidePanelHold } from './ui/SidePanel';
import { useDialogs } from './ui/Dialogs';
import { Tooltip } from './ui/Tooltip';
import { glassCard, glassPanel, glassInput, fieldLabel, primaryButton, ghostButton, dangerButton, gradientHover } from '../theme';

const FIELD_TYPES: ReadonlyArray<FieldType> = [
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'image',
  'reference',
  'select',
  'json',
];

// Entry-id generator. crypto.randomUUID is secure-context-only (undefined on the
// plain-HTTP DinD preview), so we combine a monotonic counter with a random
// suffix — the random component avoids collisions between two concurrent tabs
// that would otherwise generate the same `${slug}-${ms}-1` id and silently
// overwrite each other on the upsert PUT.
let entrySeq = 0;
function newEntryId(slug: string): string {
  entrySeq += 1;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${slug}-${Date.now().toString(36)}-${entrySeq.toString(36)}-${rand}`;
}

export function DatasetManager({ project }: { project: Project }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [draftFields, setDraftFields] = useState<Field[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [newEntry, setNewEntry] = useState(false); // the open entry editor is for a brand-new entry (key settable)
  const [schemaOpen, setSchemaOpen] = useState(false); // the schema editor is collapsed by default
  const [renaming, setRenaming] = useState(false); // the rename-dataset modal is open
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  // Separate drag state for the schema-fields list (it shares the panel with the entries list).
  const [fieldDrag, setFieldDrag] = useState<string | null>(null);
  const [fieldDrop, setFieldDrop] = useState<{ name: string; pos: 'before' | 'after' } | null>(null);
  const lastSyncedSel = useRef<string | null>(null);
  const reordering = useRef(false);
  const duplicatingDataset = useRef(false); // guards against a double-click cloning entries twice

  const { confirm, dialog } = useDialogs();
  const selected = datasets.find((d) => d.id === selId) ?? null;
  // Datasets list, sorted alphabetically by name (stable, case-insensitive).
  const sortedDatasets = useMemo(() => [...datasets].sort((a, b) => a.name.localeCompare(b.name)), [datasets]);

  // A drag-reorder must keep the Data side-panel open: dragging a row otherwise fires the panel's
  // hover-close (mouseleave) and it collapses mid-drag. Hold it open for the duration of the drag,
  // exactly as a child Modal does (null outside any panel). Balanced hold/release; released on
  // unmount too in case a drag is interrupted.
  const panelHold = useContext(SidePanelHold);
  const dragHeld = useRef(false);
  function holdPanel() {
    if (!dragHeld.current) {
      dragHeld.current = true;
      panelHold?.hold();
    }
  }
  function releasePanel() {
    if (dragHeld.current) {
      dragHeld.current = false;
      panelHold?.release();
    }
  }
  useEffect(() => () => {
    if (dragHeld.current) panelHold?.release();
  }, [panelHold]);

  async function load(isActive: () => boolean = () => true) {
    try {
      const [ds, en] = await Promise.all([
        api.listDatasets(project.id),
        api.listEntries(project.id),
      ]);
      if (!isActive()) return;
      setDatasets(ds.items);
      setEntries(en.items);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load data');
    }
  }

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [project.id]);

  // Reset the schema draft ONLY when the selection actually changes — never on a
  // background data reload (which would discard the user's unsaved schema edits).
  useEffect(() => {
    if (lastSyncedSel.current === selId) return;
    lastSyncedSel.current = selId;
    setDraftFields(datasets.find((d) => d.id === selId)?.fields ?? []);
    setEditingEntry(null);
    setSchemaOpen(false); // each dataset opens with its schema collapsed
    setRenaming(false);
  }, [selId, datasets]);

  async function createDataset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const slug = slugify(newName);
    if (!slug) {
      setError('dataset name must contain letters or numbers');
      return;
    }
    try {
      // `id` is the stable storage key and is kept equal to `slug`; the slug is
      // not editable in the UI, so entry/binding references (which use the slug)
      // stay valid. A future rename feature must migrate those references.
      await api.putDataset(project.id, { id: slug, name: newName, slug, fields: [] });
      setNewName('');
      await load();
      setSelId(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create dataset');
    }
  }

  function addField() {
    setError(null);
    const name = identifierize(newFieldName);
    if (!name) {
      setError('field name must contain letters or numbers');
      return;
    }
    if (draftFields.some((f) => f.name === name)) {
      setError(`field "${name}" already exists`);
      return;
    }
    setDraftFields([...draftFields, { name, type: newFieldType, required: false, localized: false }]);
    setNewFieldName('');
  }

  async function saveSchema() {
    if (!selected) return;
    setError(null);
    try {
      await api.putDataset(project.id, { ...selected, fields: draftFields });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save schema');
    }
  }

  // Duplicate a dataset: copy its schema under a fresh `<slug>-copy` id, then clone every entry
  // (new ids, preserved order) under the new slug. Selects the copy.
  async function duplicateDataset(src: Dataset) {
    if (duplicatingDataset.current) return; // ignore a double-click while a duplicate is in flight
    duplicatingDataset.current = true;
    setError(null);
    const newSlug = uniqueSlug(`${src.slug}-copy`, new Set(datasets.map((d) => d.id)));
    const srcEntries = entries.filter((e) => e.dataset === src.slug).slice().sort(compareEntryOrder);
    try {
      await api.putDataset(project.id, { id: newSlug, name: `${src.name} copy`, slug: newSlug, fields: src.fields.map((f) => ({ ...f })) });
      await Promise.all(
        srcEntries.map((e, i) =>
          api.putEntry(project.id, { ...e, id: newEntryId(newSlug), dataset: newSlug, order: i, values: { ...e.values } }),
        ),
      );
      await load();
      setSelId(newSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to duplicate dataset');
    } finally {
      duplicatingDataset.current = false;
    }
  }

  async function removeDataset(id: string) {
    const ds = datasets.find((d) => d.id === id);
    const name = ds?.name ?? id;
    const count = entries.filter((e) => e.dataset === (ds?.slug ?? '')).length;
    const ok = await confirm({
      title: 'Delete dataset',
      message: `Delete the "${name}" dataset and all ${count} of its ${count === 1 ? 'entry' : 'entries'}? This cannot be undone.`,
      confirmLabel: 'Delete dataset',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteDataset(project.id, id);
      if (selId === id) setSelId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete dataset');
    }
  }

  async function duplicateEntry(src: Entry) {
    if (!selected) return;
    setError(null);
    // A working copy: a fresh id, reset to draft (publishing a duplicate should be deliberate).
    const copy: Entry = { ...src, id: newEntryId(selected.slug), status: 'draft', values: { ...src.values } };
    // Insert it DIRECTLY AFTER its source (not at the end): dense-reindex the list with the copy in
    // place, then PUT the copy + only the entries whose order actually shifted.
    const list = entries.filter((e) => e.dataset === selected.slug).slice().sort(compareEntryOrder);
    const reordered = reorderWithInsert(list, src.id, copy);
    try {
      await Promise.all(
        reordered.flatMap((e) => {
          if (e.id === copy.id) return [api.putEntry(project.id, e)];
          const orig = list.find((o) => o.id === e.id);
          return orig && orig.order === e.order ? [] : [api.putEntry(project.id, e)];
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to duplicate entry');
    }
  }

  // Drag-reorder within the selected dataset: move `sourceId` before/after `targetId`, then persist a
  // dense `order` (0,1,2,…) for every entry whose position changed.
  async function persistEntryReorder(sourceId: string, targetId: string, pos: 'before' | 'after') {
    if (!selected || sourceId === targetId || reordering.current) return; // ignore a drag while one is in flight
    const list = entries.filter((e) => e.dataset === selected.slug).slice().sort(compareEntryOrder);
    const from = list.findIndex((e) => e.id === sourceId);
    if (from === -1) return;
    const [moved] = list.splice(from, 1);
    const target = list.findIndex((e) => e.id === targetId);
    if (target === -1) return;
    list.splice(target + (pos === 'after' ? 1 : 0), 0, moved!);
    reordering.current = true;
    setError(null);
    try {
      // Only PUT the entries whose order actually changed. (Dense reindex like the pages list; a
      // single bulk-reorder endpoint is a future optimization if datasets ever grow past ~60 entries,
      // where this many writes would meet the content-write rate limit.)
      await Promise.all(list.flatMap((e, i) => (e.order === i ? [] : [api.putEntry(project.id, { ...e, order: i })])));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to reorder entries');
    } finally {
      reordering.current = false;
    }
  }

  async function removeEntry(id: string) {
    const label = selected ? entryLabel(selected, entries.find((e) => e.id === id) ?? ({ id } as Entry)) : id;
    const ok = await confirm({
      title: 'Delete entry',
      message: `Delete the entry "${label}"? This cannot be undone.`,
      confirmLabel: 'Delete entry',
    });
    if (!ok) return;
    try {
      await api.deleteEntry(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete entry');
    }
  }

  const datasetEntries = selected
    ? entries.filter((e) => e.dataset === selected.slug).slice().sort(compareEntryOrder)
    : [];
  // The field that serves as the entry title in lists: the FIRST text field (see entryLabel). Drag
  // to reorder so a different field becomes the title.
  const titleFieldName = draftFields.find((f) => f.type === 'text')?.name;

  return (
    <div className="flex gap-6">
      {/* Dataset list + create */}
      <aside className="w-64 shrink-0">
        <ul className="mb-3 flex flex-col gap-1">
          {sortedDatasets.map((d) => (
            <li key={d.id}>
              {/* Real <button> for selection (keyboard-native) + a sibling duplicate button — no
                  nested interactives. The wrapper carries the selected/hover styling. */}
              <div
                className={`group flex items-center gap-1 rounded-xl border transition ${
                  d.id === selId ? 'border-indigo-400/60 bg-white/80 shadow-sm backdrop-blur-xl' : 'border-white/50 bg-white/40 backdrop-blur-xl hover:bg-white/60'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={d.id === selId}
                  onClick={() => setSelId(d.id)}
                  className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                >
                  <span className="font-medium">{d.name}</span>{' '}
                  <span className="text-xs text-slate-400">/{d.slug}</span>
                </button>
                <Tooltip tip="Duplicate dataset" side="top">
                  <button
                    type="button"
                    aria-label={`Duplicate dataset ${d.name}`}
                    className="mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-xs text-slate-400 opacity-0 transition hover:bg-white hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
                    onClick={() => void duplicateDataset(d)}
                  >
                    ⧉
                  </button>
                </Tooltip>
              </div>
            </li>
          ))}
          {datasets.length === 0 && <li className="text-sm text-slate-400">No datasets yet.</li>}
        </ul>
        <form onSubmit={createDataset} className={`flex flex-col gap-2 ${glassCard} p-3`}>
          <label className={fieldLabel}>New dataset</label>
          <input
            aria-label="Dataset name"
            className={glassInput}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Posts"
            required
          />
          <button type="submit" className={primaryButton}>
            Create dataset
          </button>
        </form>
      </aside>

      {/* Selected dataset detail */}
      <section className="min-w-0 flex-1">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {!selected && <p className="text-sm text-slate-400">Select or create a dataset.</p>}

        {selected && (
          <div className="flex flex-col gap-6">
            {/* Schema editor — collapsed by default; the header toggles it. */}
            <div className={`${glassCard} p-4`}>
              <button
                type="button"
                aria-expanded={schemaOpen}
                onClick={() => setSchemaOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span aria-hidden className={`text-slate-400 transition-transform ${schemaOpen ? 'rotate-90' : ''}`}>▸</span>
                <h3 className="text-sm font-bold text-slate-700">
                  {selected.name}{' '}
                  <span className="text-xs font-medium text-slate-400">
                    schema · {draftFields.length} {draftFields.length === 1 ? 'field' : 'fields'}
                  </span>
                </h3>
              </button>

              {schemaOpen && (
                <div className="mt-3">
              <ul className="mb-3 flex flex-col gap-1.5">
                {draftFields.map((field) => (
                  <li
                    key={field.name}
                    onDragOver={(ev) => {
                      if (!fieldDrag || fieldDrag === field.name) return;
                      ev.preventDefault();
                      const r = ev.currentTarget.getBoundingClientRect();
                      const pos = ev.clientY < r.top + r.height / 2 ? 'before' : 'after';
                      setFieldDrop((d) => (d && d.name === field.name && d.pos === pos ? d : { name: field.name, pos }));
                    }}
                    onDragLeave={(ev) => {
                      if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setFieldDrop((d) => (d?.name === field.name ? null : d));
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      // Source name from the drag payload (set in onDragStart) so we don't depend on
                      // the rendered-closure `fieldDrag`; functional updater keeps draftFields current.
                      const src = ev.dataTransfer.getData('text/plain') || fieldDrag;
                      if (src && fieldDrop) {
                        setDraftFields((fs) => reorderByKey(fs, (f) => f.name, src, fieldDrop.name, fieldDrop.pos));
                      }
                      setFieldDrag(null);
                      setFieldDrop(null);
                    }}
                    className={`relative flex items-center gap-2 text-sm transition ${fieldDrag === field.name ? 'opacity-40' : ''}`}
                  >
                    {fieldDrop?.name === field.name && (
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-indigo-500 ${fieldDrop.pos === 'before' ? '-top-1' : '-bottom-1'}`}
                      />
                    )}
                    {/* Only the handle is draggable, so the type <select> stays freely operable. */}
                    <span
                      aria-hidden
                      draggable
                      onDragStart={(ev) => {
                        setFieldDrag(field.name);
                        holdPanel(); // keep the Data panel open for the whole drag
                        ev.dataTransfer.effectAllowed = 'move';
                        ev.dataTransfer.setData('text/plain', field.name);
                      }}
                      onDragEnd={() => {
                        setFieldDrag(null);
                        setFieldDrop(null);
                        releasePanel();
                      }}
                      title="Drag to reorder"
                      className="shrink-0 cursor-grab text-slate-300 transition hover:text-slate-500 active:cursor-grabbing"
                    >
                      ⠿
                    </span>
                    <span className="w-40 truncate font-mono text-xs">{field.name}</span>
                    {field.name === titleFieldName && (
                      <Tooltip tip="Used as the entry title in lists" side="top">
                        <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">
                          title
                        </span>
                      </Tooltip>
                    )}
                    <select
                      aria-label={`Type of ${field.name}`}
                      className={`${glassInput} w-auto px-2 py-1 text-xs`}
                      value={field.type}
                      onChange={(e) =>
                        setDraftFields((fs) =>
                          fs.map((f) => (f.name === field.name ? { ...f, type: e.target.value as FieldType } : f)),
                        )
                      }
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      <input
                        type="checkbox"
                        aria-label={`${field.name} required`}
                        checked={field.required}
                        onChange={(e) =>
                          setDraftFields((fs) =>
                            fs.map((f) => (f.name === field.name ? { ...f, required: e.target.checked } : f)),
                          )
                        }
                      />
                      required
                    </label>
                    <button
                      aria-label={`Remove field ${field.name}`}
                      className={`${dangerButton} ml-auto px-2 py-0.5 text-xs`}
                      onClick={() => setDraftFields((fs) => fs.filter((f) => f.name !== field.name))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {draftFields.length === 0 && <li className="text-xs text-slate-400">No fields yet.</li>}
              </ul>

              <div className="flex flex-wrap items-end gap-2">
                <input
                  aria-label="New field name"
                  className={`${glassInput} w-auto`}
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="title"
                />
                <select
                  aria-label="New field type"
                  className={`${glassInput} w-auto`}
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as FieldType)}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addField}
                  className={ghostButton}
                >
                  Add field
                </button>
                <button
                  type="button"
                  onClick={saveSchema}
                  className={`${primaryButton} ml-auto`}
                >
                  Save schema
                </button>
              </div>

                  {/* Dataset-level actions, tucked inside the schema editor. */}
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200/60 pt-3">
                    <button
                      type="button"
                      aria-label="Rename dataset"
                      className={ghostButton}
                      onClick={() => setRenaming(true)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label="Delete dataset"
                      className={dangerButton}
                      onClick={() => removeDataset(selected.id)}
                    >
                      Delete dataset
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Entries */}
            <div className={`${glassCard} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">Entries</h3>
                <button
                  type="button"
                  onClick={() => {
                    setNewEntry(true);
                    setEditingEntry({
                      id: newEntryId(selected.slug),
                      dataset: selected.slug,
                      status: 'draft',
                      values: defaultEntryValues(selected),
                    });
                  }}
                  className={ghostButton}
                >
                  New entry
                </button>
              </div>

              <ul className="mb-3 flex flex-col gap-1">
                {datasetEntries.map((e) => (
                  <li
                    key={e.id}
                    draggable
                    onDragStart={(ev) => {
                      setDragId(e.id);
                      holdPanel(); // keep the Data panel open for the whole drag
                      ev.dataTransfer.effectAllowed = 'move';
                      ev.dataTransfer.setData('text/plain', e.id);
                    }}
                    onDragOver={(ev) => {
                      if (!dragId || dragId === e.id) return;
                      ev.preventDefault();
                      const r = ev.currentTarget.getBoundingClientRect();
                      const pos = ev.clientY < r.top + r.height / 2 ? 'before' : 'after';
                      setDrop((d) => (d && d.id === e.id && d.pos === pos ? d : { id: e.id, pos }));
                    }}
                    onDragLeave={(ev) => {
                      if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDrop((d) => (d?.id === e.id ? null : d));
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      if (dragId && drop) void persistEntryReorder(dragId, drop.id, drop.pos);
                      setDragId(null);
                      setDrop(null);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDrop(null);
                      releasePanel();
                    }}
                    className="relative"
                  >
                    {drop?.id === e.id && (
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-indigo-500 ${drop.pos === 'before' ? '-top-1' : '-bottom-1'}`}
                      />
                    )}
                    {/* The label is a real <button> (flex-1, fills the row) that opens the editor; the
                        status badge + action buttons are siblings (no nested interactives). The wrapper
                        carries the gradient-lift hover + ripple, so the whole row reacts. */}
                    <div
                      className={`group flex items-center gap-2 ${glassPanel} ${gradientHover} waves-effect pr-2 text-sm transition ${dragId === e.id ? 'opacity-40' : ''}`}
                    >
                      <span aria-hidden className="shrink-0 cursor-grab pl-3 text-slate-300 transition group-hover:text-white/70 active:cursor-grabbing">⠿</span>
                      <button
                        type="button"
                        onClick={() => {
                          setNewEntry(false);
                          setEditingEntry(e);
                        }}
                        className="min-w-0 flex-1 truncate py-2 text-left group-hover:text-white"
                      >
                        {entryLabel(selected, e)}
                      </button>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase transition group-hover:bg-white/25 group-hover:text-white ${
                          e.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {e.status}
                      </span>
                      <Tooltip tip="Duplicate" side="top">
                        <button
                          type="button"
                          aria-label={`Duplicate entry ${e.id}`}
                          className={`${ghostButton} px-2 py-0.5 text-xs`}
                          onClick={() => void duplicateEntry(e)}
                        >
                          ⧉
                        </button>
                      </Tooltip>
                      <button
                        type="button"
                        aria-label={`Delete entry ${e.id}`}
                        className={`${dangerButton} px-2 py-0.5 text-xs`}
                        onClick={() => void removeEntry(e.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
                {datasetEntries.length === 0 && <li className="text-sm text-slate-400">No entries yet.</li>}
              </ul>

              {editingEntry && (
                <EntryEditorModal
                  key={editingEntry.id}
                  dataset={selected}
                  entry={editingEntry}
                  projectId={project.id}
                  keyEditable={newEntry}
                  existingIds={new Set(datasetEntries.map((e) => e.id))}
                  onSaved={() => {
                    void load();
                    setEditingEntry(null);
                  }}
                  onClose={() => setEditingEntry(null)}
                />
              )}

              {renaming && (
                <RenameDatasetModal
                  key={selected.id}
                  projectId={project.id}
                  dataset={selected}
                  entries={datasetEntries}
                  existingSlugs={new Set(datasets.map((d) => d.id))}
                  onRenamed={async (slug) => {
                    // Await the reload BEFORE selecting, so the schema-draft effect resolves the
                    // renamed dataset from fresh state (else draftFields would sync to []).
                    setRenaming(false);
                    await load();
                    setSelId(slug);
                  }}
                  onClose={() => setRenaming(false)}
                />
              )}
            </div>
          </div>
        )}
      </section>
      {dialog}
    </div>
  );
}
