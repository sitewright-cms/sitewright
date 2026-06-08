import { useState } from 'react';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { coerceFieldValue, entryLabel, identifierize, readValue } from '../../lib/entry-form';
import { api } from '../../api';
import { glassInput } from '../../theme';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The entry's id (its key). For a new entry the author may set a clean slug; empty keeps the
  // auto-generated id. The id is immutable once saved.
  const customKey = keyEditable && keyInput.trim() !== '';
  // An IDENTIFIER (underscores, not hyphens) so the key works as a bare Handlebars path —
  // {{item.services.web_development.title}} — without needing [bracket] segment syntax.
  const computedId = customKey ? identifierize(keyInput) : entry.id;
  // existingIds holds only SAVED entries (never this new one's auto id), so a plain membership test.
  const keyTaken = customKey && !!existingIds?.has(computedId);
  const keyInvalid = customKey && computedId === ''; // typed only stripped chars → no usable key
  const dirty = status !== entry.status || JSON.stringify(values) !== JSON.stringify(entry.values) || customKey;

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

  const statusToggle = (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
      <span className={status === 'draft' ? 'text-slate-700' : ''}>Draft</span>
      <input
        type="checkbox"
        className="toggle toggle-success toggle-sm"
        aria-label="Published"
        checked={status === 'published'}
        onChange={(e) => setStatus(e.target.checked ? 'published' : 'draft')}
      />
      <span className={status === 'published' ? 'text-emerald-600' : ''}>Published</span>
    </label>
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
      headerExtra={statusToggle}
    >
      <div className="flex flex-col gap-3 p-5">
        {keyEditable ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">
              Key <span className="text-slate-300">— the id used in <code>{`{{item.${dataset.slug}.<key>}}`}</code> (letters, digits, _)</span>
            </span>
            <input
              aria-label="Entry key"
              className={glassInput}
              placeholder={`${entry.id} (auto)`}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <span className={`text-[11px] ${keyTaken || keyInvalid ? 'text-rose-500' : 'text-slate-400'}`}>
              {keyInvalid ? 'enter letters, digits, or underscores' : <>→ <code>{computedId}</code>{keyTaken ? ' · already used in this dataset' : ''}</>}
            </span>
          </label>
        ) : (
          <p className="text-[11px] text-slate-400">
            Key: <code className="rounded bg-slate-100 px-1 py-0.5">{entry.id}</code> — read it directly with{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">{`{{item.${dataset.slug}.${entry.id}.…}}`}</code>
          </p>
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
