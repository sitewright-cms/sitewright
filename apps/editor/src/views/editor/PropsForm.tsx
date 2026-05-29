import type { PageNode } from '@sitewright/schema';
import { descriptorFor, type FieldDescriptor } from '@sitewright/blocks';

interface PropsFormProps {
  node: PageNode;
  onChange: (key: string, value: unknown) => void;
}

/** Reads a prop without dynamic object indexing (lint- and pollution-safe). */
function readProp(props: Record<string, unknown>, key: string): unknown {
  return Object.entries(props).find(([k]) => k === key)?.[1];
}

function Field({
  field,
  value,
  idPrefix,
  onChange,
}: {
  field: FieldDescriptor;
  value: unknown;
  idPrefix: string;
  onChange: (value: unknown) => void;
}) {
  const id = `${idPrefix}-${field.key}`;
  const label = (
    <label htmlFor={id} className="text-xs font-medium text-slate-500">
      {field.label}
    </label>
  );

  if (field.input === 'textarea') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <textarea
          id={id}
          aria-label={field.label}
          className="min-h-16 rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.input === 'select') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <select
          id={id}
          aria-label={field.label}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={value === undefined || value === null ? String(field.default ?? '') : String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.input === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          id={id}
          type="checkbox"
          aria-label={field.label}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.input === 'number') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <input
          id={id}
          type="number"
          aria-label={field.label}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </div>
    );
  }

  // text / url
  return (
    <div className="flex flex-col gap-1">
      {label}
      <input
        id={id}
        type="text"
        aria-label={field.label}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Descriptor-driven property editor for the selected block. */
export function PropsForm({ node, onChange }: PropsFormProps) {
  const descriptor = descriptorFor(node.type);
  if (!descriptor || descriptor.fields.length === 0) {
    return <p className="text-xs text-slate-400">This block has no editable properties.</p>;
  }
  const props = node.props ?? {};
  return (
    <div className="flex flex-col gap-3">
      {descriptor.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          idPrefix={`field-${node.id}`}
          value={readProp(props, field.key)}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </div>
  );
}
