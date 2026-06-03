import { useState, type FormEvent } from 'react';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { coerceFieldValue, readValue } from '../../lib/entry-form';
import { glassCard, glassInput, primaryButton, ghostButton } from '../../theme';

interface EntryEditorProps {
  dataset: Dataset;
  entry: Entry;
  onSave: (entry: Entry) => Promise<void> | void;
  onCancel: () => void;
}

function FieldInput({
  field,
  value,
  onRaw,
}: {
  field: Field;
  value: unknown;
  onRaw: (raw: unknown) => void;
}) {
  const common = { id: `entry-${field.name}`, 'aria-label': field.name };

  switch (field.type) {
    case 'richtext':
      return (
        <textarea
          {...common}
          className={`${glassInput} min-h-20`}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onRaw(e.target.value)}
        />
      );
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
      return (
        <input
          {...common}
          type="number"
          className={glassInput}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onRaw(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onRaw(e.target.checked)}
        />
      );
    case 'date':
      return (
        <input
          {...common}
          type="date"
          className={glassInput}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onRaw(e.target.value)}
        />
      );
    default:
      // text, image, reference, select — a plain text input (pickers come later).
      return (
        <input
          {...common}
          type="text"
          className={glassInput}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.type === 'image' ? '/photo.jpg' : undefined}
          onChange={(e) => onRaw(e.target.value)}
        />
      );
  }
}

/** Field-typed form for editing a single dataset entry. */
export function EntryEditor({ dataset, entry, onSave, onCancel }: EntryEditorProps) {
  const [values, setValues] = useState<Record<string, unknown>>(entry.values);
  const [status, setStatus] = useState<'draft' | 'published'>(entry.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(field: Field, raw: unknown) {
    setValues((prev) => ({ ...prev, [field.name]: coerceFieldValue(field.type, raw) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...entry, status, values });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-3 ${glassCard} p-4`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Entry</h4>
        <select
          aria-label="Entry status"
          className={`${glassInput} w-auto px-2 py-1 text-xs`}
          value={status}
          onChange={(e) => setStatus(e.target.value === 'published' ? 'published' : 'draft')}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>

      {dataset.fields.length === 0 && (
        <p className="text-xs text-slate-400">This dataset has no fields yet — add some first.</p>
      )}

      {dataset.fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1">
          <label htmlFor={`entry-${field.name}`} className="text-xs font-medium text-slate-500">
            {field.name}
            <span className="ml-1 text-slate-300">({field.type})</span>
            {field.required && <span className="ml-1 text-red-400">*</span>}
          </label>
          <FieldInput field={field} value={readValue(values, field.name)} onRaw={(raw) => setField(field, raw)} />
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className={primaryButton}
        >
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <button type="button" onClick={onCancel} className={ghostButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
