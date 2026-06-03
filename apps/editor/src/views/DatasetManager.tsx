import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Dataset, Entry, Field, FieldType } from '@sitewright/schema';
import { api, type Project } from '../api';
import { defaultEntryValues, entryLabel, identifierize, slugify } from '../lib/entry-form';
import { EntryEditor } from './datasets/EntryEditor';

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
  const lastSyncedSel = useRef<string | null>(null);

  const selected = datasets.find((d) => d.id === selId) ?? null;

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

  async function removeDataset(id: string) {
    setError(null);
    try {
      await api.deleteDataset(project.id, id);
      if (selId === id) setSelId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete dataset');
    }
  }

  async function saveEntry(entry: Entry) {
    try {
      await api.putEntry(project.id, entry);
      await load();
      setEditingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save entry');
      throw err; // re-throw so EntryEditor surfaces it inline too
    }
  }

  async function removeEntry(id: string) {
    try {
      await api.deleteEntry(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete entry');
    }
  }

  const datasetEntries = selected
    ? entries.filter((e) => e.dataset === selected.slug)
    : [];

  return (
    <div className="flex gap-6">
      {/* Dataset list + create */}
      <aside className="w-64 shrink-0">
        <ul className="mb-3 flex flex-col gap-1">
          {datasets.map((d) => (
            <li key={d.id}>
              <button
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  d.id === selId ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
                onClick={() => setSelId(d.id)}
              >
                <span className="font-medium">{d.name}</span>{' '}
                <span className="text-xs text-slate-400">/{d.slug}</span>
              </button>
            </li>
          ))}
          {datasets.length === 0 && <li className="text-sm text-slate-400">No datasets yet.</li>}
        </ul>
        <form onSubmit={createDataset} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-xs font-medium text-slate-500">New dataset</label>
          <input
            aria-label="Dataset name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Posts"
            required
          />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
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
            {/* Schema editor */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  {selected.name} <span className="text-xs text-slate-400">schema</span>
                </h3>
                <button
                  aria-label="Delete dataset"
                  className="text-xs text-red-500 hover:text-red-700"
                  onClick={() => removeDataset(selected.id)}
                >
                  Delete dataset
                </button>
              </div>

              <ul className="mb-3 flex flex-col gap-1.5">
                {draftFields.map((field) => (
                  <li key={field.name} className="flex items-center gap-2 text-sm">
                    <span className="w-40 font-mono text-xs">{field.name}</span>
                    <select
                      aria-label={`Type of ${field.name}`}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      value={field.type}
                      onChange={(e) =>
                        setDraftFields(
                          draftFields.map((f) =>
                            f.name === field.name ? { ...f, type: e.target.value as FieldType } : f,
                          ),
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
                          setDraftFields(
                            draftFields.map((f) =>
                              f.name === field.name ? { ...f, required: e.target.checked } : f,
                            ),
                          )
                        }
                      />
                      required
                    </label>
                    <button
                      aria-label={`Remove field ${field.name}`}
                      className="ml-auto text-xs text-red-400 hover:text-red-700"
                      onClick={() => setDraftFields(draftFields.filter((f) => f.name !== field.name))}
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
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="title"
                />
                <select
                  aria-label="New field type"
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
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
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500"
                >
                  Add field
                </button>
                <button
                  type="button"
                  onClick={saveSchema}
                  className="ml-auto rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white"
                >
                  Save schema
                </button>
              </div>
            </div>

            {/* Entries */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Entries</h3>
                <button
                  type="button"
                  onClick={() =>
                    setEditingEntry({
                      id: newEntryId(selected.slug),
                      dataset: selected.slug,
                      status: 'draft',
                      values: defaultEntryValues(selected),
                    })
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500"
                >
                  New entry
                </button>
              </div>

              <ul className="mb-3 flex flex-col gap-1">
                {datasetEntries.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <button className="text-left hover:underline" onClick={() => setEditingEntry(e)}>
                      {entryLabel(selected, e)}
                    </button>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        e.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {e.status}
                    </span>
                    <button
                      aria-label={`Delete entry ${e.id}`}
                      className="ml-auto text-xs text-red-400 hover:text-red-700"
                      onClick={() => removeEntry(e.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {datasetEntries.length === 0 && <li className="text-sm text-slate-400">No entries yet.</li>}
              </ul>

              {editingEntry && (
                <EntryEditor
                  dataset={selected}
                  entry={editingEntry}
                  onSave={saveEntry}
                  onCancel={() => setEditingEntry(null)}
                />
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
