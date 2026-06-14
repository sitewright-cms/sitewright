import { useState } from 'react';
import { ChevronUp, ChevronDown, X, Plus } from 'lucide-react';
import type { Field, FieldType } from '@sitewright/schema';
import { MAX_FIELD_DEPTH } from '@sitewright/schema';
import { identifierize } from '../../lib/entry-form';
import { glassInput, toggleInput } from '../../theme';
import { FieldConfigEditor, type DatasetRef } from './FieldConfigEditor';

/** Scalar (leaf) field types — every type except the two structural group types. */
export const SCALAR_FIELD_TYPES: readonly FieldType[] = ['text', 'richtext', 'number', 'boolean', 'date', 'time', 'datetime', 'image', 'reference', 'select', 'json'];

/** `list` (ordered repeatable group) and `object` (named sub-group) carry child `fields`. */
export function isGroupFieldType(t: FieldType): boolean {
  return t === 'list' || t === 'object';
}

/**
 * Reconcile a field's `fields` with its (possibly just-changed) type: a group type GAINS an empty
 * child list (so the nested editor shows + the user can add children); a scalar SHEDS any stray
 * children (DatasetSchema forbids children on scalars). Use wherever a field's `type` changes.
 */
export function normalizeFieldForType(field: Field): Field {
  if (isGroupFieldType(field.type)) return field.fields ? field : { ...field, fields: [] };
  if (field.fields === undefined) return field;
  const next: Field = { ...field };
  delete next.fields;
  return next;
}

/** True if any field (recursively) is a group with no children — DatasetSchema rejects these, so the
 *  schema editor blocks the save up front rather than round-tripping to a generic server error. */
export function fieldsHaveEmptyGroup(fields: readonly Field[]): boolean {
  return fields.some((f) => (isGroupFieldType(f.type) ? !f.fields?.length || fieldsHaveEmptyGroup(f.fields) : false));
}

/**
 * Recursive editor for the child `fields` of a `list`/`object` field — add / remove / reorder /
 * retype children, nesting further while the depth budget allows. `depth` is the 1-indexed schema
 * LEVEL of the children shown here (a top-level field is level 1, so a top-level group's children are
 * level 2). A child may itself be a group only while `depth < MAX_FIELD_DEPTH` (matching the schema's
 * depth-bounded parse). Updates are by index (names are unique within a group but a sibling rename is
 * not offered — remove + re-add, mirroring the top-level schema editor).
 */
export function NestedFieldsEditor({
  value,
  onChange,
  depth,
  datasets,
}: {
  value: Field[];
  onChange: (fields: Field[]) => void;
  depth: number;
  /** Project datasets — for a child `reference` field's target picker. */
  datasets: readonly DatasetRef[];
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [error, setError] = useState<string | null>(null);

  // Children here are at level `depth`; a child may nest (be a group) only if its OWN children
  // (level depth+1) would still be within the cap — i.e. depth < MAX_FIELD_DEPTH.
  const canNest = depth < MAX_FIELD_DEPTH;
  const types = canNest ? [...SCALAR_FIELD_TYPES, 'list' as const, 'object' as const] : SCALAR_FIELD_TYPES;

  const setChild = (i: number, patch: Partial<Field>) =>
    onChange(value.map((f, j) => (j === i ? normalizeFieldForType({ ...f, ...patch }) : f)));
  const removeChild = (i: number) => onChange(value.filter((_, j) => j !== i));
  const moveChild = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const addChild = () => {
    const n = identifierize(name);
    if (!n) return setError('field name must contain letters or numbers');
    if (value.some((f) => f.name === n)) return setError(`field "${n}" already exists`);
    setError(null);
    onChange([...value, normalizeFieldForType({ name: n, type, required: false, localized: false })]);
    setName('');
  };

  return (
    <div className="mt-2 space-y-2 border-l-2 border-indigo-200/60 pl-3">
      <ul className="space-y-1.5">
        {value.map((field, i) => (
          <li key={field.name} className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-32 truncate font-mono text-xs" title={field.name}>{field.name}</span>
              <select
                aria-label={`Type of ${field.name}`}
                className={`${glassInput} w-auto px-2 py-1 text-xs`}
                value={field.type}
                onChange={(e) => setChild(i, { type: e.target.value as FieldType })}
              >
                {/* Keep the current type selectable even past the nest cap (so an imported deeper field renders). */}
                {(types.includes(field.type) ? types : [...types, field.type]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  className={toggleInput}
                  aria-label={`${field.name} required`}
                  checked={field.required}
                  onChange={(e) => setChild(i, { required: e.target.checked })}
                />
                required
              </label>
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label={`Move ${field.name} up`} disabled={i === 0} onClick={() => moveChild(i, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label={`Move ${field.name} down`} disabled={i === value.length - 1} onClick={() => moveChild(i, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button type="button" className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove field ${field.name}`} onClick={() => removeChild(i)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Per-field config for the config-driven types: select choices / reference target. */}
            <FieldConfigEditor field={field} datasets={datasets} onChange={(config) => setChild(i, { config })} />
            {/* `depth < MAX_FIELD_DEPTH` guards the recursion even if malformed (over-deep) data ever
                reached the client — the schema rejects writing it, but the render stays bounded. */}
            {isGroupFieldType(field.type) && depth < MAX_FIELD_DEPTH && (
              <NestedFieldsEditor value={field.fields ?? []} depth={depth + 1} datasets={datasets} onChange={(children) => setChild(i, { fields: children })} />
            )}
          </li>
        ))}
        {value.length === 0 && <li className="text-xs text-amber-600">Add at least one field — a list/object needs children to save.</li>}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="New nested field name"
          className={`${glassInput} w-32 px-2 py-1 text-xs`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChild(); } }}
          placeholder="field"
        />
        <select aria-label="New nested field type" className={`${glassInput} w-auto px-2 py-1 text-xs`} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {types.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <button
          type="button"
          onClick={addChild}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300/70 px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add field
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
