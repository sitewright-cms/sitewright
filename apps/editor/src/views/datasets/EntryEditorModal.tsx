import { useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { coerceFieldValue, defaultFieldValues, entryLabel, identifierize, readValue } from '../../lib/entry-form';
import { api } from '../../api';
import { glassInput, gradientSurface } from '../../theme';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { AssetField } from '../files/AssetField';
import { ACCEPT } from '../files/FileBrowser';

// Monotonic key source for list items (stable React keys that travel with an item across reorder,
// without polluting the saved data shape). See ListField.
let listKeySeq = 0;

/** A labelled stack of child-field inputs — shared by the modal body, an `object` field, and each
 *  item of a `list` field. Each child change is coerced to the child's type before bubbling up.
 *  `path` makes DOM ids unique across the tree; `itemIndex` (set inside a list) disambiguates the
 *  accessible labels of repeated fields ("caption (item 2)"). */
function FieldGroup({
  fields,
  values,
  projectId,
  path,
  itemIndex,
  onChange,
}: {
  fields: readonly Field[];
  values: Record<string, unknown>;
  projectId: string;
  path: string;
  itemIndex?: number;
  onChange: (name: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <label key={f.name} htmlFor={`entry-${path}.${f.name}`} className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            {f.name}
            {f.required ? <span className="text-rose-400"> *</span> : null}
          </span>
          <FieldInput
            field={f}
            value={readValue(values, f.name)}
            projectId={projectId}
            path={`${path}.${f.name}`}
            ariaLabel={itemIndex === undefined ? f.name : `${f.name} (item ${itemIndex + 1})`}
            onRaw={(raw) => onChange(f.name, coerceFieldValue(f.type, raw))}
          />
        </label>
      ))}
    </div>
  );
}

/** A `list` field: an ordered array of item records (each shaped by `field.fields`) with
 *  add / remove / move-up / move-down. Items are plain objects with no id, so a parallel `keys`
 *  ref is kept in lockstep with the ops — React keys then follow an item through a reorder (rather
 *  than the index, which would swap a child's local state, e.g. an open AssetField picker). */
function ListField({
  field,
  value,
  projectId,
  path,
  onRaw,
}: {
  field: Field;
  value: unknown;
  projectId: string;
  path: string;
  onRaw: (next: Record<string, unknown>[]) => void;
}) {
  const malformed = value !== undefined && !Array.isArray(value);
  const items = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
  const sub = field.fields ?? [];
  const keys = useRef<string[]>([]);
  // Keep the key list length in sync with items (initial load + any external replacement); the
  // explicit ops below keep identity aligned through move/remove/add.
  while (keys.current.length < items.length) keys.current.push(`li${listKeySeq++}`);
  if (keys.current.length > items.length) keys.current.length = items.length;

  const setItem = (i: number, name: string, value_: unknown) =>
    onRaw(items.map((it, idx) => (idx === i ? { ...it, [name]: value_ } : it)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    [keys.current[i], keys.current[j]] = [keys.current[j]!, keys.current[i]!];
    onRaw(next);
  };
  const remove = (i: number) => {
    keys.current.splice(i, 1);
    onRaw(items.filter((_, idx) => idx !== i));
  };
  const add = () => {
    keys.current.push(`li${listKeySeq++}`);
    onRaw([...items, defaultFieldValues(sub)]);
  };
  const iconBtn = 'rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="space-y-2.5 rounded-lg border border-white/10 p-3">
      {malformed ? (
        <p className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">This field's stored value isn't a list and is shown empty — saving will replace it.</p>
      ) : null}
      {items.length === 0 ? <p className="text-xs text-slate-500">No items yet.</p> : null}
      {items.map((item, i) => (
        <div key={keys.current[i]} className="rounded-md border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">#{i + 1}</span>
            <div className="flex gap-0.5">
              <button type="button" className={iconBtn} aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ChevronUp className="h-4 w-4" />
              </button>
              <button type="button" className={iconBtn} aria-label={`Move item ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <ChevronDown className="h-4 w-4" />
              </button>
              <button type="button" className={iconBtn} aria-label={`Remove item ${i + 1}`} onClick={() => remove(i)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <FieldGroup fields={sub} values={item} projectId={projectId} path={`${path}.${i}`} itemIndex={i} onChange={(name, v) => setItem(i, name, v)} />
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
        onClick={add}
      >
        <Plus className="h-3.5 w-3.5" /> Add item
      </button>
    </div>
  );
}

/** A single field's input, typed by the dataset field's kind. Recurses for `object`/`list`.
 *  `path` is a tree-unique id segment; `ariaLabel` is the human label (item-disambiguated). */
function FieldInput({
  field,
  value,
  projectId,
  onRaw,
  path,
  ariaLabel,
}: {
  field: Field;
  value: unknown;
  projectId: string;
  onRaw: (raw: unknown) => void;
  path: string;
  ariaLabel?: string;
}) {
  const common = { id: `entry-${path}`, 'aria-label': ariaLabel ?? field.name };
  switch (field.type) {
    case 'richtext':
      return <textarea {...common} className={`${glassInput} min-h-20`} value={typeof value === 'string' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'json':
      return (
        <textarea
          {...common}
          className={`${glassInput} min-h-20 font-mono text-xs`}
          value={typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2)}
          onChange={(e) => onRaw(e.target.value)}
        />
      );
    case 'number':
      return <input {...common} type="number" className={glassInput} value={typeof value === 'number' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'boolean':
      return <input {...common} type="checkbox" checked={value === true} onChange={(e) => onRaw(e.target.checked)} />;
    case 'date':
      return <input {...common} type="date" className={glassInput} value={typeof value === 'string' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'image':
      return (
        <AssetField
          label={field.name}
          inputId={common.id}
          hideLabel
          value={typeof value === 'string' ? value : ''}
          onChange={onRaw}
          projectId={projectId}
          accept={ACCEPT.image}
          placeholder="/photo.jpg"
        />
      );
    case 'object': {
      // A named sub-group: render its child fields, persisting into a nested record.
      const isObj = !!value && typeof value === 'object' && !Array.isArray(value);
      const rec = isObj ? (value as Record<string, unknown>) : {};
      const malformed = value !== undefined && !isObj;
      return (
        <div className="rounded-lg border border-white/10 p-3">
          {malformed ? (
            <p className="mb-2 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">This field's stored value isn't an object and is shown empty — saving will replace it.</p>
          ) : null}
          <FieldGroup fields={field.fields ?? []} values={rec} projectId={projectId} path={path} onChange={(name, v) => onRaw({ ...rec, [name]: v })} />
        </div>
      );
    }
    case 'list':
      return <ListField field={field} value={value} projectId={projectId} path={path} onRaw={onRaw} />;
    default:
      // text, reference, select — a plain text input (richer pickers come later).
      return <input {...common} type="text" className={glassInput} value={typeof value === 'string' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
  }
}

interface EntryEditorModalProps {
  projectId: string;
  dataset: Dataset;
  entry: Entry;
  /** When true (a NEW entry), the author can set the entry KEY (its id) — used as {{item.<set>.<key>}}.
   *  False/omitted: the key is shown read-only (the id is immutable after creation). */
  keyEditable?: boolean;
  /** The dataset's existing entry ids — to reject a duplicate key. */
  existingIds?: ReadonlySet<string>;
  /** Called after a successful save; the parent reloads its list / refreshes the preview + closes. */
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Field-typed editor for ONE dataset entry, in its own stacked Modal — used from the Data side-panel
 * AND (via the preview bridge, a later PR) from clicking a rendered entry. The draft/published state
 * is a toggle in the modal's top-right (header). The modal owns the `putEntry` call; the parent only
 * reloads its list / refreshes the preview via `onSaved`.
 */
export function EntryEditorModal({ projectId, dataset, entry, keyEditable = false, existingIds, onSaved, onClose }: EntryEditorModalProps) {
  const { confirm, dialog } = useDialogs();
  const [values, setValues] = useState<Record<string, unknown>>(entry.values);
  const [status, setStatus] = useState<'draft' | 'published'>(entry.status);
  const [keyInput, setKeyInput] = useState('');
  // For an EXISTING entry the key is read-only until the author opts in via "Edit key"; a NEW entry's
  // key is always settable.
  const [editKey, setEditKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The entry's id (its key). New entry → author may set a clean key (empty keeps the auto id).
  // Existing entry → settable only after clicking "Edit key" (placeholder shows the current id).
  const keyFieldOpen = keyEditable || editKey;
  const typedKey = keyFieldOpen && keyInput.trim() !== '';
  // An IDENTIFIER (underscores, not hyphens) so the key works as a bare Handlebars path —
  // {{item.services.web_development.title}} — without needing [bracket] segment syntax.
  const computedId = typedKey ? identifierize(keyInput) : entry.id;
  const idChanged = computedId !== entry.id;
  // existingIds includes an EXISTING entry's own id, so exclude self via idChanged.
  const keyTaken = idChanged && !!existingIds?.has(computedId);
  const keyInvalid = typedKey && computedId === ''; // typed only stripped chars → no usable key
  // Changing an ALREADY-SAVED entry's key recreates it under the new id and deletes the old row.
  const recreating = !keyEditable && idChanged;
  const dirty = status !== entry.status || JSON.stringify(values) !== JSON.stringify(entry.values) || idChanged;

  function setField(field: Field, raw: unknown) {
    setValues((prev) => ({ ...prev, [field.name]: coerceFieldValue(field.type, raw) }));
  }

  async function submit() {
    if (keyInvalid) {
      setError('Enter a key with letters, digits, or underscores.');
      return;
    }
    if (keyTaken) {
      setError(`The key “${computedId}” is already used in this dataset.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.putEntry(projectId, { ...entry, id: computedId, status, values });
      // Recreate: the new id is now saved, so drop the old row. (PUT-then-DELETE: a failure leaves
      // the new copy rather than losing the entry.)
      if (recreating) await api.deleteEntry(projectId, entry.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  /** Confirm before discarding unsaved edits on Esc / × / backdrop. */
  async function confirmClose(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({ title: 'Discard changes', message: 'Discard unsaved entry changes?', confirmLabel: 'Discard' });
  }

  // A segmented Draft|Published switch — mirrors the page editor's Code/Content mode switch.
  const statusSwitch = (
    <div
      role="group"
      aria-label="Status"
      className="flex items-center rounded-xl border border-white/60 bg-white/50 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl"
    >
      {(['draft', 'published'] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={status === s}
          onClick={() => setStatus(s)}
          className={`waves-effect rounded-lg px-2.5 py-1 capitalize transition ${
            status === s ? `${gradientSurface} font-bold` : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      title={`Edit ${entryLabel(dataset, entry)}`}
      size="lg"
      onClose={onClose}
      onBeforeClose={confirmClose}
      onSave={() => void submit()}
      saving={saving}
      saveDisabled={keyTaken || keyInvalid}
      headerExtra={statusSwitch}
    >
      <div className="flex flex-col gap-3 p-5">
        {keyFieldOpen ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">
              Key <span className="text-slate-300">— the id used in <code>{`{{item.${dataset.slug}.<key>}}`}</code> (letters, digits, _)</span>
            </span>
            <input
              aria-label="Entry key"
              className={glassInput}
              placeholder={`${entry.id}${keyEditable ? ' (auto)' : ''}`}
              value={keyInput}
              autoFocus={editKey}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <span className={`text-[11px] ${keyTaken || keyInvalid ? 'text-rose-500' : 'text-slate-400'}`}>
              {keyInvalid ? 'enter letters, digits, or underscores' : <>→ <code>{computedId}</code>{keyTaken ? ' · already used in this dataset' : ''}</>}
            </span>
            {recreating && (
              <span className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                Renaming the key recreates this entry as <code>{computedId}</code> and deletes the old{' '}
                <code>{entry.id}</code> — update any <code>{`{{item.${dataset.slug}.${entry.id}}}`}</code> references in your pages.
              </span>
            )}
          </label>
        ) : (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[11px] text-slate-400">
              Key: <code className="rounded bg-slate-100 px-1 py-0.5">{entry.id}</code> — read it directly with{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5">{`{{item.${dataset.slug}.${entry.id}.…}}`}</code>
            </p>
            <button
              type="button"
              className="waves-effect shrink-0 rounded-lg border border-white/60 bg-white/50 px-2 py-1 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-white"
              onClick={() => setEditKey(true)}
            >
              Edit key
            </button>
          </div>
        )}
        {dataset.fields.length === 0 && <p className="text-xs text-slate-400">This dataset has no fields yet — add some first.</p>}
        {dataset.fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <label htmlFor={`entry-${field.name}`} className="text-xs font-medium text-slate-500">
              {field.name}
              <span className="ml-1 text-slate-300">({field.type})</span>
              {field.required && <span className="ml-1 text-red-400">*</span>}
            </label>
            <FieldInput field={field} value={readValue(values, field.name)} projectId={projectId} path={field.name} onRaw={(raw) => setField(field, raw)} />
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {dialog}
    </Modal>
  );
}
