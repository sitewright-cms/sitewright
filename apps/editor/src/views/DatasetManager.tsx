import { useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { X, GripVertical, ChevronRight, Plus, History } from 'lucide-react';
import type { Dataset, Entry, Field, FieldType } from '@sitewright/schema';
import { compareEntryOrder } from '@sitewright/core';
import { api, type Project } from '../api';
import { useProjectEvents } from '../lib/use-project-events';
import { datasetSlugify, defaultEntryValues, entryLabel, identifierize, reorderByKey, reorderWithInsert, uniqueSlug } from '../lib/entry-form';
import { EntryEditorModal } from './datasets/EntryEditorModal';
import { FieldConfigEditor } from './datasets/FieldConfigEditor';
import { NestedFieldsEditor, isGroupFieldType, normalizeFieldForType, fieldsHaveEmptyGroup } from './datasets/NestedFieldsEditor';
import { RenameDatasetModal } from './datasets/RenameDatasetModal';
import { RevisionHistoryModal } from './RevisionHistoryModal';
import { SidePanelHold } from './ui/SidePanel';
import { useDialogs } from './ui/Dialogs';
import { Tooltip } from './ui/Tooltip';
import { SearchField } from './ui/SearchField';
import { glassCard, glassPanel, glassInput, fieldLabel, primaryButton, ghostButton, dangerButton, gradientHover, gradientSurface, toggleInput } from '../theme';

// Alphabetical: the list is long enough that a curated order is one nobody but its author can
// predict, and every other picker in the editor sorts. The two STRUCTURAL types stay pinned to the
// end — `list`/`object` hold child `fields` rather than a value, so they are a different kind of
// choice, and burying them mid-list among the value types reads as if they were one. (A top-level
// field is schema level 1, so its children are level 2 — within MAX_FIELD_DEPTH.)
const VALUE_FIELD_TYPES: ReadonlyArray<FieldType> = [
  'boolean', 'date', 'datetime', 'file', 'folder', 'icon', 'image', 'json',
  'number', 'page', 'reference', 'richtext', 'select', 'text', 'time',
];
const FIELD_TYPES: ReadonlyArray<FieldType> = [...VALUE_FIELD_TYPES, 'list', 'object'];

/** Scrolls the nearest scrollable ancestor of `el` (the Data side-panel's scroll area) back to the
 *  top — so selecting a dataset reveals its schema + entries rather than leaving the panel scrolled. */
function scrollPanelToTop(el: HTMLElement | null): void {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      node.scrollTop = 0;
      return;
    }
  }
}

const KEY_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const KEY_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Entry-key generator. A SHORT, identifier-safe key — a letter + 6 base36 chars (~35 bits / ~4 bytes
// of randomness). The leading letter and the absence of hyphens keep it a valid bare Handlebars path
// segment, so an entry is directly addressable as {{item.<set>.<key>.<field>}} without renaming it.
// crypto.getRandomValues (unlike crypto.randomUUID) is NOT secure-context-only, so it works in the
// plain-HTTP DinD preview. `taken` (the dataset's existing entry ids) is consulted to avoid the rare
// collision — two concurrent tabs would otherwise risk the same id and silently overwrite each other
// on the upsert PUT.
function newEntryId(taken: ReadonlySet<string> = new Set()): string {
  const gen = (): string => {
    const buf = new Uint8Array(7);
    crypto.getRandomValues(buf);
    let s = KEY_LETTERS[buf[0]! % 26]!;
    for (let i = 1; i < buf.length; i += 1) s += KEY_ALNUM[buf[i]! % 36]!;
    return s;
  };
  let key = gen();
  for (let n = 0; n < 20 && taken.has(key); n += 1) key = gen();
  return key;
}

export function DatasetManager({ project }: { project: Project }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  // Always-current selection for `load()`, which is also called from event handlers and callbacks that
  // captured an older render's `selId`. Entries are fetched per DATASET, so loading the wrong one is
  // not a stale-render curiosity — it would show another collection's rows.
  const selIdRef = useRef<string | null>(null);
  selIdRef.current = selId;
  const [datasetQuery, setDatasetQuery] = useState(''); // search filter for the dataset list
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false); // reveal the "Enter Dataset Name" input from the header button
  const [draftFields, setDraftFields] = useState<Field[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  // The add-field form is CLOSED until asked for. Two empty inputs sitting under the schema read as
  // part of it — an unnamed field the author has half-filled in — which is exactly what they are not.
  const [addingField, setAddingField] = useState(false);
  // Which FIELD's name is being edited in place (double-click to rename), and its draft text.
  // (`renaming` below is the DATASET-rename modal — a different thing, deliberately not reused.)
  const [renamingField, setRenamingField] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  // ORIGINAL field name → its current draft name, for every rename made since this dataset was
  // selected. Kept because a rename is indistinguishable from a delete-plus-add once the draft is just
  // a list of names, and the entry migration on save needs to know which is which.
  const [renamedFields, setRenamedFields] = useState<Record<string, string>>({});
  // Free-text filter over the selected dataset's entries.
  const [entryQuery, setEntryQuery] = useState('');
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [newEntry, setNewEntry] = useState(false); // the open entry editor is for a brand-new entry (key settable)
  const [schemaOpen, setSchemaOpen] = useState(false); // the schema editor is collapsed by default
  const [renaming, setRenaming] = useState(false); // the rename-dataset modal is open
  const [historyOpen, setHistoryOpen] = useState(false); // the revision-history modal is open
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  // Separate drag state for the schema-fields list (it shares the panel with the entries list).
  const [fieldDrag, setFieldDrag] = useState<string | null>(null);
  const [fieldDrop, setFieldDrop] = useState<{ name: string; pos: 'before' | 'after' } | null>(null);
  const lastSyncedSel = useRef<string | null>(null);
  const reordering = useRef(false);
  const duplicatingDataset = useRef(false); // guards against a double-click cloning entries twice
  const rootRef = useRef<HTMLDivElement>(null);

  const { confirm, dialog } = useDialogs();
  const selected = datasets.find((d) => d.id === selId) ?? null;
  // Datasets list, sorted alphabetically by name (stable, case-insensitive).
  const sortedDatasets = useMemo(() => [...datasets].sort((a, b) => a.name.localeCompare(b.name)), [datasets]);
  // Filtered by the header search box (name or slug, case-insensitive).
  const filteredDatasets = useMemo(() => {
    const q = datasetQuery.trim().toLowerCase();
    return q ? sortedDatasets.filter((d) => d.name.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)) : sortedDatasets;
  }, [sortedDatasets, datasetQuery]);

  /** Select a dataset and scroll the panel back to the top so its schema + entries are in view. */
  function selectDataset(id: string) {
    setSelId(id);
    requestAnimationFrame(() => scrollPanelToTop(rootRef.current));
  }

  // Force the Data side-panel to stay open for the duration of a drag-reorder, exactly as a child
  // Modal does (null outside any panel). The click-open drawer no longer collapses on pointer
  // movement, so this is now a belt-and-braces guard (e.g. it also keeps the panel from being
  // closed by a stray Escape mid-drag). Balanced hold/release; released on unmount if a drag is cut.
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

  /**
   * Loads the dataset list, plus the entries of the SELECTED dataset only.
   *
   * ★ This used to fetch every entry of every dataset with full values — measured at 1.85 MB on a
   * project with 886 rows, re-fetched on every reload and on every agent edit event. Nothing on this
   * screen reads another dataset's rows: the two operations that legitimately need them (duplicate,
   * delete-count) fetch what they need at the moment they run.
   */
  async function load(isActive: () => boolean = () => true, datasetSlug: string | null = selIdRef.current) {
    try {
      const [ds, en] = await Promise.all([
        api.listDatasets(project.id),
        datasetSlug ? api.listEntries(project.id, datasetSlug) : Promise.resolve({ items: [] as Entry[] }),
      ]);
      if (!isActive()) return;
      setDatasets(ds.items);
      setEntries(en.items);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load data');
    }
  }

  useProjectEvents(project.id, (c) => {
    // Refresh the datasets + entries when an agent (or another tab) changes them.
    if (c.kind === 'dataset' || c.kind === 'entry') void load();
  });

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
    // Re-runs on SELECTION too: entries are fetched per dataset, so picking another one must fetch its
    // rows. (`load` reads the current selection from the ref, so it is not a dependency.)
  }, [project.id, selId]);

  // Reset the schema draft ONLY when the selection actually changes — never on a
  // background data reload (which would discard the user's unsaved schema edits).
  useEffect(() => {
    if (lastSyncedSel.current === selId) return;
    lastSyncedSel.current = selId;
    setDraftFields(datasets.find((d) => d.id === selId)?.fields ?? []);
    setEditingEntry(null);
    setSchemaOpen(false); // each dataset opens with its schema collapsed
    setRenaming(false);
    setEntryQuery(''); // an inherited filter reads as "this dataset is empty"
    setAddingField(false);
    setRenamingField(null);
    setRenamedFields({});
  }, [selId, datasets]);

  async function createDataset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const slug = datasetSlugify(newName);
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
      setShowCreate(false);
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
    // normalize → a list/object gains an empty `fields` so its nested editor appears.
    setDraftFields([...draftFields, normalizeFieldForType({ name, type: newFieldType, required: false, localized: false })]);
    setNewFieldName('');
    setAddingField(false);
  }

  /**
   * Rename a field in the DRAFT schema (double-click its name).
   *
   * ★ A field name is the key its VALUES are stored under, so a rename orphans every existing entry's
   * value for it — the new name reads empty and the old data is still sitting there under the old key.
   * The schema save migrates the entries (see saveSchema), so the rename is announced here as what it
   * actually is rather than looking like a label edit.
   */
  function commitRename(from: string) {
    const to = identifierize(renameText);
    setRenamingField(null);
    if (!to || to === from) return;
    if (draftFields.some((f) => f.name === to)) {
      setError(`field "${to}" already exists`);
      return;
    }
    setError(null);
    setDraftFields((fs) => fs.map((f) => (f.name === from ? { ...f, name: to } : f)));
    setRenamedFields((m) => {
      // Follow a CHAIN: renaming a→b then b→c must still map the original a→c, or the migration
      // would look for a field called "b" that no entry ever had.
      const original = Object.keys(m).find((k) => m[k] === from) ?? from;
      return { ...m, [original]: to };
    });
  }

  async function saveSchema() {
    if (!selected) return;
    setError(null);
    if (fieldsHaveEmptyGroup(draftFields)) {
      setError('A list/object field needs at least one child field — add one before saving.');
      return;
    }
    try {
      await api.putDataset(project.id, { ...selected, fields: draftFields });
      // ★ A FIELD NAME IS THE KEY ITS VALUES ARE STORED UNDER, so a rename without this leaves every
      // existing row's content sitting under the old key while the renamed field reads empty — the
      // data is not lost, but it is invisible, which is worse than an error. Move it with the field.
      // Only renames that SURVIVED to the saved schema are applied (rename a→b then b back to a, or
      // delete the field afterwards, and nothing moves).
      const moves = Object.entries(renamedFields).filter(([from, to]) => from !== to && draftFields.some((f) => f.name === to));
      if (moves.length) {
        const rows = entries.filter((e) => e.dataset === selected.slug);
        for (const row of rows) {
          const values = { ...(row.values ?? {}) } as Record<string, unknown>;
          let touched = false;
          for (const [from, to] of moves) {
            if (!Object.prototype.hasOwnProperty.call(values, from)) continue;
            // eslint-disable-next-line security/detect-object-injection -- keys are KeyNameSchema field names off the draft schema
            values[to] = values[from];
            // eslint-disable-next-line security/detect-object-injection -- as above
            delete values[from];
            touched = true;
          }
          if (touched) await api.putEntry(project.id, { ...row, values });
        }
      }
      setRenamedFields({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save schema');
    }
  }

  // Duplicate a dataset: copy its schema under a fresh `<slug>_copy` id, then clone every entry
  // (new ids, preserved order) under the new slug. Selects the copy. (Underscore, not hyphen — a
  // dataset slug is a Handlebars identifier; see datasetSlugify / DatasetSlugSchema.)
  async function duplicateDataset(src: Dataset) {
    if (duplicatingDataset.current) return; // ignore a double-click while a duplicate is in flight
    duplicatingDataset.current = true;
    setError(null);
    const newSlug = uniqueSlug(`${src.slug}_copy`, new Set(datasets.map((d) => d.id)), '_');
    try {
      // The loaded `entries` hold the SELECTED dataset only, and the row being duplicated may be a
      // different one — read the source's rows rather than silently cloning an empty collection.
      const srcEntries = (await api.listEntries(project.id, src.slug)).items.slice().sort(compareEntryOrder);
      await api.putDataset(project.id, { id: newSlug, name: `${src.name} copy`, slug: newSlug, fields: src.fields.map((f) => ({ ...f })) });
      // Fresh, collision-free keys for the cloned entries (the set grows as each id is minted).
      const usedIds = new Set<string>();
      await Promise.all(
        srcEntries.map((e, i) => {
          const id = newEntryId(usedIds);
          usedIds.add(id);
          return api.putEntry(project.id, { ...e, id, dataset: newSlug, order: i, values: { ...e.values } });
        }),
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
    // Counted server-side: the rows of a dataset that isn't selected are not loaded, and a confirm
    // prompt does not need them — `?limit=1` returns the total without the bodies.
    const count = ds ? await api.countEntries(project.id, ds.slug) : 0;
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
    const taken = new Set(entries.filter((e) => e.dataset === selected.slug).map((e) => e.id));
    const copy: Entry = { ...src, id: newEntryId(taken), status: 'draft', values: { ...src.values } };
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
    if (!selected) return;
    // Look the entry up WITHIN the selected dataset — an id is only unique per-dataset, so a bare
    // `entries.find(e.id === id)` could match a same-id entry in another dataset.
    const label = entryLabel(selected, entries.find((e) => e.id === id && e.dataset === selected.slug) ?? ({ id } as Entry));
    const ok = await confirm({
      title: 'Delete entry',
      message: `Delete the entry "${label}"? This cannot be undone.`,
      confirmLabel: 'Delete entry',
    });
    if (!ok) return;
    try {
      await api.deleteEntry(project.id, id, selected.slug);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete entry');
    }
  }

  const datasetEntries = selected
    ? entries.filter((e) => e.dataset === selected.slug).slice().sort(compareEntryOrder)
    : [];
  // The FILTERED view the list renders. Matched on the entry's title AND its id (the id is the
  // {{item.<set>.<key>}} key, so it is what an author often has in hand) AND its other text values —
  // a dataset is browsed by what is IN a row, not by the one field that happens to be its title.
  // The unfiltered list stays the source for ids/order, so reordering and key-uniqueness are unaffected.
  const shownEntries = useMemo(() => {
    const q = entryQuery.trim().toLowerCase();
    if (!q || !selected) return datasetEntries;
    return datasetEntries.filter((e) => {
      if (e.id.toLowerCase().includes(q) || entryLabel(selected, e).toLowerCase().includes(q)) return true;
      return Object.values(e.values ?? {}).some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
    });
    // `datasetEntries` is rebuilt each render; depending on the identity would defeat the memo, so key
    // it on what actually decides the result.
  }, [entryQuery, selected, entries]);
  // The field that serves as the entry title in lists: the FIRST text field (see entryLabel). Drag
  // to reorder so a different field becomes the title.
  const titleFieldName = draftFields.find((f) => f.type === 'text')?.name;

  return (
    <div ref={rootRef} className="flex gap-6">
      {/* Dataset list + create */}
      <aside className="w-64 shrink-0">
        {/* Header action: "New Dataset" reveals the name input + Create (no persistent form below). */}
        {showCreate ? (
          <form onSubmit={createDataset} className={`mb-2 flex flex-col gap-2 ${glassCard} p-3`}>
            <label className={fieldLabel}>Enter Dataset Name</label>
            <input
              autoFocus
              aria-label="Dataset name"
              className={glassInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Posts"
              required
            />
            <div className="flex gap-2">
              <button type="submit" className={`flex-1 ${primaryButton}`}>
                Create
              </button>
              <button
                type="button"
                className={ghostButton}
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            aria-label="New dataset"
            onClick={() => {
              setShowCreate(true);
              setError(null);
            }}
            className={`mb-2 flex w-full items-center justify-center gap-1.5 ${primaryButton}`}
          >
            <Plus className="h-4 w-4" /> New Dataset
          </button>
        )}
        {/* Search the dataset list (name or slug). */}
        <SearchField
          ariaLabel="Search datasets"
          className="mb-2"
          value={datasetQuery}
          onChange={setDatasetQuery}
          placeholder="Search datasets…"
        />
        <ul className="mb-3 flex flex-col gap-1">
          {filteredDatasets.map((d) => {
            const active = d.id === selId;
            return (
              <li key={d.id}>
                {/* Real <button> for selection (keyboard-native) + a sibling duplicate button — no
                    nested interactives. The wrapper carries the gradient hover/active + ripple, like
                    the entries rows; clicking scrolls the panel to the top to reveal the schema. */}
                <div className={`group flex items-center gap-1 rounded-xl waves-effect transition ${active ? `${gradientSurface} waves-light` : `${glassPanel} ${gradientHover}`}`}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectDataset(d.id)}
                    className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-sm ${active ? 'text-white' : 'group-hover:text-white'}`}
                  >
                    <span className="font-medium">{d.name}</span>{' '}
                    <span className={`text-xs ${active ? 'text-white/70' : 'text-slate-500 dark:text-slate-400 group-hover:text-white/80'}`}>/{d.slug}</span>
                  </button>
                  <Tooltip tip="Duplicate dataset" side="top">
                    <button
                      type="button"
                      aria-label={`Duplicate dataset ${d.name}`}
                      className={`mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-xs opacity-0 transition focus:opacity-100 group-hover:opacity-100 ${
                        active ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-slate-200 group-hover:text-white/80'
                      }`}
                      onClick={() => void duplicateDataset(d)}
                    >
                      ⧉
                    </button>
                  </Tooltip>
                </div>
              </li>
            );
          })}
          {datasets.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No datasets yet.</li>}
          {datasets.length > 0 && filteredDatasets.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No datasets match “{datasetQuery}”.</li>}
        </ul>
      </aside>

      {/* Selected dataset detail */}
      <section className="min-w-0 flex-1">
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!selected && <p className="text-sm text-slate-500 dark:text-slate-400">Select or create a dataset.</p>}

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
                <span aria-hidden className={`text-slate-500 dark:text-slate-400 transition-transform ${schemaOpen ? 'rotate-90' : ''}`}><ChevronRight className="h-4 w-4" /></span>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {selected.name}{' '}
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
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
                    className={`relative text-sm transition ${fieldDrag === field.name ? 'opacity-40' : ''}`}
                  >
                    {fieldDrop?.name === field.name && (
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-indigo-500 ${fieldDrop.pos === 'before' ? '-top-1' : '-bottom-1'}`}
                      />
                    )}
                    <div className="flex items-center gap-2">
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
                      className="shrink-0 cursor-grab text-slate-500 transition dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    {renamingField === field.name ? (
                      <input
                        autoFocus
                        aria-label={`Rename field ${field.name}`}
                        className={`${glassInput} w-40 px-2 py-0.5 font-mono text-xs`}
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onBlur={() => commitRename(field.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitRename(field.name); }
                          if (e.key === 'Escape') { e.preventDefault(); setRenamingField(null); }
                        }}
                      />
                    ) : (
                      <span
                        className="w-40 cursor-text truncate font-mono text-xs"
                        title={`${field.name} — double-click to rename`}
                        onDoubleClick={() => { setRenamingField(field.name); setRenameText(field.name); }}
                      >
                        {field.name}
                      </span>
                    )}
                    {field.name === titleFieldName && (
                      <Tooltip tip="Used as the entry title in lists" side="top">
                        <span className="shrink-0 rounded bg-indigo-100 dark:bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
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
                          fs.map((f) => (f.name === field.name ? normalizeFieldForType({ ...f, type: e.target.value as FieldType }) : f)),
                        )
                      }
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <input
                        type="checkbox"
                        className={toggleInput}
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
                      <X className="h-4 w-4" />
                    </button>
                    </div>
                    {/* Per-field config for the config-driven types: select choices / reference target. */}
                    <FieldConfigEditor
                      field={field}
                      datasets={datasets}
                      onChange={(config) =>
                        setDraftFields((fs) => fs.map((f) => (f.name === field.name ? { ...f, config } : f)))
                      }
                    />
                    {/* Nested schema for a list/object field — recursive child-field editor. */}
                    {isGroupFieldType(field.type) && (
                      <NestedFieldsEditor
                        value={field.fields ?? []}
                        depth={2}
                        datasets={datasets}
                        onChange={(children) =>
                          setDraftFields((fs) => fs.map((f) => (f.name === field.name ? { ...f, fields: children } : f)))
                        }
                      />
                    )}
                  </li>
                ))}
                {draftFields.length === 0 && <li className="text-xs text-slate-500 dark:text-slate-400">No fields yet.</li>}
              </ul>

              {/* The add-field FORM is closed until asked for, and opens BELOW its own button. Two empty
                  inputs permanently under the schema read as part of it — a half-filled-in field that
                  is not there — and pushed the Save control away from the list it saves. */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setAddingField((v) => !v); setNewFieldName(''); }}
                  aria-expanded={addingField}
                  className={ghostButton}
                >
                  <Plus className="mr-1 inline h-3.5 w-3.5" /> Add field
                </button>
                <button
                  type="button"
                  onClick={saveSchema}
                  className={`${primaryButton} ml-auto`}
                >
                  Save schema
                </button>
              </div>
              {addingField && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-indigo-300/70 dark:border-indigo-500/30 p-2.5">
                  <input
                    autoFocus
                    aria-label="New field name"
                    className={`${glassInput} w-auto`}
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addField(); }
                      if (e.key === 'Escape') { e.preventDefault(); setAddingField(false); }
                    }}
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
                  <button type="button" onClick={addField} className={primaryButton}>
                    Add
                  </button>
                  <button type="button" onClick={() => setAddingField(false)} className={ghostButton}>
                    Cancel
                  </button>
                </div>
              )}

                  {/* Dataset-level actions, tucked inside the schema editor. */}
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200/60 dark:border-slate-700/60 pt-3">
                    <button
                      type="button"
                      aria-label="Revision history"
                      className={`${ghostButton} mr-auto`}
                      onClick={() => setHistoryOpen(true)}
                    >
                      <History className="h-4 w-4" aria-hidden /> History
                    </button>
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
              {/* ONE line: heading left, New entry right, the filter taking the space between them.
                  NOT flex-wrap — this lives in the narrow Data drawer, where a fixed-width input plus a
                  heading plus a button do not fit, so wrapping put the filter on a row of its own and
                  cost a line of the list. `flex-1 min-w-0` lets it give up width instead of wrapping
                  (min-w-0 is the part that matters: a flex item will not shrink below its intrinsic
                  content width without it). */}
              <div className="mb-3 flex items-center gap-2">
                {/* The match count rides in the HEADING rather than as a third item competing for the
                    row's width — and only while filtering, when "how many of them" is the question. */}
                <h3 className="flex shrink-0 items-baseline gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
                  Entries
                  {entryQuery.trim() !== '' && (
                    <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                      {`${shownEntries.length} of ${datasetEntries.length}`}
                    </span>
                  )}
                </h3>
                {datasetEntries.length > 0 && (
                  <input
                    type="search"
                    aria-label="Filter entries"
                    placeholder="Filter…"
                    className={`${glassInput} min-w-0 flex-1 px-2 py-1 text-xs`}
                    value={entryQuery}
                    onChange={(e) => setEntryQuery(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setNewEntry(true);
                    setEditingEntry({
                      id: newEntryId(new Set(datasetEntries.map((e) => e.id))),
                      dataset: selected.slug,
                      // New entries default to PUBLISHED — most authoring is "add it and it's live";
                      // the modal's Draft/Published switch flips it back when a draft is intended.
                      status: 'published',
                      values: defaultEntryValues(selected),
                    });
                  }}
                  className={`${ghostButton} ml-auto`}
                >
                  New entry
                </button>
              </div>

              <ul className="mb-3 flex flex-col gap-1">
                {shownEntries.map((e) => (
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
                      <span aria-hidden className="shrink-0 cursor-grab pl-3 text-slate-500 dark:text-slate-400 transition group-hover:text-white/70 active:cursor-grabbing"><GripVertical className="h-4 w-4" /></span>
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
                          e.status === 'published' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
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
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
                {datasetEntries.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No entries yet.</li>}
                {datasetEntries.length > 0 && shownEntries.length === 0 && (
                  <li className="text-sm text-slate-500 dark:text-slate-400">No entry matches “{entryQuery.trim()}”.</li>
                )}
              </ul>

              {editingEntry && (
                <EntryEditorModal
                  key={editingEntry.id}
                  dataset={selected}
                  entry={editingEntry}
                  projectId={project.id}
                  keyEditable={newEntry}
                  existingIds={new Set(datasetEntries.map((e) => e.id))}
                  allDatasets={datasets}
                  allEntries={entries}
                  // Reload the list/preview but KEEP the modal open (it resets its own dirty baseline);
                  // closing is an explicit user action (× / Esc / backdrop).
                  onSaved={() => void load()}
                  onClose={() => setEditingEntry(null)}
                />
              )}

              {renaming && (
                <RenameDatasetModal
                  key={selected.id}
                  projectId={project.id}
                  dataset={selected}
                  entries={datasetEntries}
                  existingSlugs={new Set(datasets.map((d) => d.slug))}
                  onRenamed={async () => {
                    // The server rename keeps the dataset's id stable (only its slug changes), so reselect
                    // by id. Await the reload BEFORE selecting so the schema-draft effect resolves the
                    // renamed dataset from fresh state (else draftFields would sync to []).
                    setRenaming(false);
                    await load();
                    setSelId(selected.id);
                  }}
                  onClose={() => setRenaming(false)}
                />
              )}
              {historyOpen && selected && (
                <RevisionHistoryModal
                  projectId={project.id}
                  kind="dataset"
                  entityId={selected.id}
                  label={selected.name}
                  onClose={() => setHistoryOpen(false)}
                  onRestored={() => void load()}
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
