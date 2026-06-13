import { useState } from 'react';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { coerceFieldValue, entryLabel, identifierize, readValue } from '../../lib/entry-form';
import { api } from '../../api';
import { glassInput, gradientSurface } from '../../theme';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { AssetField } from '../files/AssetField';
import { ACCEPT } from '../files/FileBrowser';

/** A single field's input, typed by the dataset field's kind. */
function FieldInput({
  field,
  value,
  projectId,
  onRaw,
}: {
  field: Field;
  value: unknown;
  projectId: string;
  onRaw: (raw: unknown) => void;
}) {
  const common = { id: `entry-${field.name}`, 'aria-label': field.name };
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
    case 'list':
    case 'object':
      // Nested fields: read-only summary for now (a structured recursive editor lands in a
      // follow-up). Crucially NOT an editable text input — that would coerce the stored array/
      // object to a string on the first keystroke. Shown so the value is at least visible.
      return (
        <div {...common} className={`${glassInput} min-h-10 whitespace-pre-wrap font-mono text-xs text-slate-300`}>
          {Array.isArray(value) || (typeof value === 'object' && value !== null) ? JSON.stringify(value, null, 2) : '—'}
          <span className="mt-1 block not-italic text-slate-500">Nested {field.type} — edit coming soon.</span>
        </div>
      );
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
            <FieldInput field={field} value={readValue(values, field.name)} projectId={projectId} onRaw={(raw) => setField(field, raw)} />
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {dialog}
    </Modal>
  );
}
