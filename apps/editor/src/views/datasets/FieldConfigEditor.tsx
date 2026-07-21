import { useRef } from 'react';
import { X, Plus } from 'lucide-react';
import type { Field } from '@sitewright/schema';
import { fieldReferenceDataset } from '../../lib/entry-form';
import { glassInput } from '../../theme';

/** Minimal dataset shape the reference picker needs (the target list). */
export interface DatasetRef {
  slug: string;
  name: string;
}

// Monotonic key source for select-option rows (stable React keys so removing a middle option keeps
// focus on the rows after it — option strings are empty/duplicate-able while typing, so they can't key).
let optKeySeq = 0;

/**
 * Per-field configuration for the two config-driven field types — a `select`'s list of allowed
 * CHOICES (`config.options`) and a `reference`'s TARGET dataset (`config.dataset`). Rendered just
 * under the field's row in the schema editor (top-level and nested alike); writes the whole `config`
 * object back via `onChange`. Renders nothing for any other field type.
 */
export function FieldConfigEditor({
  field,
  datasets,
  onChange,
}: {
  field: Field;
  datasets: readonly DatasetRef[];
  onChange: (config: Record<string, unknown>) => void;
}) {
  // Stable per-row keys for the select options (declared before the early returns — rules of hooks).
  const optionKeys = useRef<number[]>([]);
  const cfg = field.config ?? {};

  if (field.type === 'reference') {
    const target = fieldReferenceDataset(field);
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-xs">
        <span className="text-slate-400 dark:text-slate-500">links to</span>
        <select
          aria-label={`Reference target for ${field.name}`}
          className={`${glassInput} w-auto px-2 py-1 text-xs`}
          value={datasets.some((d) => d.slug === target) ? target : ''}
          onChange={(e) => onChange({ ...cfg, dataset: e.target.value })}
        >
          <option value="">— choose dataset —</option>
          {datasets.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name} /{d.slug}
            </option>
          ))}
        </select>
        {target === '' && <span className="text-amber-600 dark:text-amber-400">pick a dataset to choose entries from</span>}
      </div>
    );
  }

  if (field.type === 'select') {
    // Edit the RAW options array (including in-progress empty rows) so typing works; the entry editor
    // filters empties/dupes via fieldSelectOptions when building the dropdown.
    const raw = Array.isArray(cfg.options) ? (cfg.options as unknown[]).map((o) => (typeof o === 'string' ? o : '')) : [];
    // Keep the row keys aligned to the options (the length sync covers external resets; the ops below
    // splice/push to preserve identity through add/remove).
    while (optionKeys.current.length < raw.length) optionKeys.current.push(optKeySeq++);
    if (optionKeys.current.length > raw.length) optionKeys.current.length = raw.length;
    const editOpt = (i: number, v: string) => onChange({ ...cfg, options: raw.map((o, j) => (j === i ? v : o)) });
    const removeOpt = (i: number) => {
      optionKeys.current.splice(i, 1);
      onChange({ ...cfg, options: raw.filter((_, j) => j !== i) });
    };
    const addOpt = () => {
      optionKeys.current.push(optKeySeq++);
      onChange({ ...cfg, options: [...raw, ''] });
    };
    return (
      <div className="mt-1.5 space-y-1 pl-6">
        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Choices</span>
        {raw.length === 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">Add choices — without them the entry editor shows a plain text box.</p>
        )}
        {raw.map((opt, i) => (
          <div key={optionKeys.current[i]} className="flex items-center gap-1.5">
            <input
              aria-label={`Choice ${i + 1} for ${field.name}`}
              className={`${glassInput} max-w-xs px-2 py-1 text-xs`}
              value={opt}
              placeholder="Option label"
              onChange={(e) => editOpt(i, e.target.value)}
            />
            <button
              type="button"
              aria-label={`Remove choice ${i + 1}`}
              className="rounded p-1 text-slate-400 dark:text-slate-500 transition hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
              onClick={() => removeOpt(i)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300/70 px-2 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 transition hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
          onClick={addOpt}
        >
          <Plus className="h-3 w-3" /> Add choice
        </button>
      </div>
    );
  }

  return null;
}
