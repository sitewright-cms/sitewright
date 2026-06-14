import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronUp, ChevronDown, Trash2, Plus, Copy, GripVertical } from 'lucide-react';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { compareEntryOrder } from '@sitewright/core';
import {
  coerceFieldValue,
  defaultFieldValues,
  entryLabel,
  fieldReferenceDataset,
  fieldSelectOptions,
  identifierize,
  isJsonValid,
  readValue,
} from '../../lib/entry-form';
import { api } from '../../api';
import { ghostButton, glassInput, gradientSurface, toggleInput } from '../../theme';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { useToast } from '../ui/Toast';
import { isGroupFieldType } from './NestedFieldsEditor';
import { RichTextField } from './RichTextField';
import { AssetField } from '../files/AssetField';
import { ACCEPT } from '../files/FileBrowser';

// Monotonic key source for list items (stable React keys that travel with an item across reorder,
// without polluting the saved data shape). See ListField.
let listKeySeq = 0;

// Stable empty fallbacks for the optional project-data props — a fresh `[]` default on every render
// would change the EntryFormContext identity each render and re-fire the json-validity effect (a
// re-render loop for an invalid field). Module constants keep the context stable when omitted.
const NO_DATASETS: readonly Dataset[] = [];
const NO_ENTRIES: readonly Entry[] = [];

/**
 * Project-wide data the entry form's leaf inputs need: the dataset/entry lists (for a `reference`
 * field's picker) and a validity sink (json fields report parse errors here so the modal can block
 * Save). Provided once by the modal; read by ReferenceField / JsonField.
 */
interface EntryFormCtx {
  datasets: readonly Dataset[];
  entries: readonly Entry[];
  reportValidity: (path: string, valid: boolean) => void;
}
const EntryFormContext = createContext<EntryFormCtx | null>(null);

/** Plain-text preview of an item — the first text/richtext field's value, HTML stripped + clipped. */
function itemSummary(fields: readonly Field[], item: Record<string, unknown>): string {
  const f = fields.find((x) => x.type === 'text' || x.type === 'richtext');
  if (!f) return '';
  const v = readValue(item, f.name);
  if (typeof v !== 'string' || v === '') return '';
  const text = v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** A labelled stack of child-field inputs — shared by the modal body, an `object` field, and each
 *  item of a `list` field. Each child change is coerced to the child's type before bubbling up.
 *  `path` makes DOM ids unique across the tree; `itemIndex` (set inside a list) disambiguates the
 *  accessible labels of repeated fields ("caption (item 2)"). A group field (list/object) renders its
 *  OWN titled header, so only scalar fields get a heading here. */
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
      {fields.map((f) => {
        const childPath = `${path}.${f.name}`;
        const aria = itemIndex === undefined ? f.name : `${f.name} (item ${itemIndex + 1})`;
        const input = (
          <FieldInput
            field={f}
            value={readValue(values, f.name)}
            projectId={projectId}
            path={childPath}
            ariaLabel={aria}
            onRaw={(raw) => onChange(f.name, coerceFieldValue(f.type, raw))}
          />
        );
        if (isGroupFieldType(f.type)) return <div key={f.name}>{input}</div>;
        return (
          <div key={f.name}>
            <label htmlFor={`entry-${childPath}`} className="mb-1 block text-xs font-medium text-slate-500">
              {f.name}
              {f.required ? <span className="text-rose-400"> *</span> : null}
            </label>
            {input}
          </div>
        );
      })}
    </div>
  );
}

/** A collapsible, titled shell for a group (`list`/`object`) field — collapsed by default to keep the
 *  entry form compact. `meta` is a small count badge; `actions` sit on the right of the header. */
function GroupShell({
  title,
  required,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string;
  required?: boolean;
  meta: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/70">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="truncate text-xs font-semibold text-slate-600">
            {title}
            {required ? <span className="text-rose-400"> *</span> : null}
          </span>
          <span className="shrink-0 rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{meta}</span>
        </button>
      </div>
      {open ? <div className="space-y-2 px-2.5 pb-2.5">{children}</div> : null}
    </div>
  );
}

/** An `object` field: a named sub-group, rendered as a collapsible shell around its child fields. */
function ObjectField({
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
  onRaw: (raw: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const isObj = !!value && typeof value === 'object' && !Array.isArray(value);
  const rec = isObj ? (value as Record<string, unknown>) : {};
  const malformed = value !== undefined && !isObj;
  const count = (field.fields ?? []).length;
  return (
    <GroupShell title={field.name} required={field.required} meta={`${count} ${count === 1 ? 'field' : 'fields'}`} open={open} onToggle={() => setOpen((v) => !v)}>
      {malformed ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">This field's stored value isn't an object and is shown empty — saving will replace it.</p>
      ) : null}
      <FieldGroup fields={field.fields ?? []} values={rec} projectId={projectId} path={path} onChange={(name, v) => onRaw({ ...rec, [name]: v })} />
    </GroupShell>
  );
}

/** A `list` field: an ordered array of item records (each shaped by `field.fields`). Collapsible;
 *  items support drag-reorder (by the grip), duplicate-after, and remove; a parallel `keys` ref keeps
 *  React identity aligned with each item through every op (so an item's local UI state — e.g. an open
 *  AssetField picker — follows the item rather than its index). */
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
  while (keys.current.length < items.length) keys.current.push(`li${listKeySeq++}`);
  if (keys.current.length > items.length) keys.current.length = items.length;

  const [open, setOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ idx: number; pos: 'before' | 'after' } | null>(null);

  const commit = (nextItems: Record<string, unknown>[], nextKeys: string[]) => {
    keys.current = nextKeys;
    onRaw(nextItems);
  };
  const setItem = (i: number, name: string, v: unknown) => onRaw(items.map((it, idx) => (idx === i ? { ...it, [name]: v } : it)));
  const remove = (i: number) => {
    const nk = [...keys.current];
    nk.splice(i, 1);
    commit(items.filter((_, idx) => idx !== i), nk);
  };
  const duplicate = (i: number) => {
    // Items hold only JSON-serializable values (the field tree forbids anything else), so a JSON
    // round-trip is a safe deep clone. The copy lands DIRECTLY AFTER its source.
    const clone = JSON.parse(JSON.stringify(items[i] ?? {})) as Record<string, unknown>;
    const nextItems = [...items.slice(0, i + 1), clone, ...items.slice(i + 1)];
    const nk = [...keys.current];
    nk.splice(i + 1, 0, `li${listKeySeq++}`);
    commit(nextItems, nk);
  };
  const add = () => {
    const nk = [...keys.current, `li${listKeySeq++}`];
    commit([...items, defaultFieldValues(sub)], nk);
    setOpen(true);
  };
  const moveTo = (from: number, toIdx: number, pos: 'before' | 'after') => {
    let target = toIdx + (pos === 'after' ? 1 : 0);
    if (from < target) target -= 1;
    if (from === target) return;
    const nextItems = [...items];
    const nextKeys = [...keys.current];
    const [mi] = nextItems.splice(from, 1);
    const [mk] = nextKeys.splice(from, 1);
    nextItems.splice(target, 0, mi!);
    nextKeys.splice(target, 0, mk!);
    commit(nextItems, nextKeys);
  };
  // Keyboard-accessible reorder (drag is mouse-only): swap with the neighbour.
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const nextItems = [...items];
    const nextKeys = [...keys.current];
    [nextItems[i], nextItems[j]] = [nextItems[j]!, nextItems[i]!];
    [nextKeys[i], nextKeys[j]] = [nextKeys[j]!, nextKeys[i]!];
    commit(nextItems, nextKeys);
  };

  const iconBtn = 'rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <GroupShell title={field.name} required={field.required} meta={`${items.length} ${items.length === 1 ? 'item' : 'items'}`} open={open} onToggle={() => setOpen((v) => !v)}>
      {malformed ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">This field's stored value isn't a list and is shown empty — saving will replace it.</p>
      ) : null}
      {items.length === 0 ? <p className="text-xs text-slate-400">No items yet.</p> : null}
      {items.map((item, i) => (
        <div
          key={keys.current[i]}
          onDragOver={(ev) => {
            if (dragIdx === null || dragIdx === i) return;
            ev.preventDefault();
            const r = ev.currentTarget.getBoundingClientRect();
            const pos = ev.clientY < r.top + r.height / 2 ? 'before' : 'after';
            setDrop((d) => (d && d.idx === i && d.pos === pos ? d : { idx: i, pos }));
          }}
          onDragLeave={(ev) => {
            if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDrop((d) => (d?.idx === i ? null : d));
          }}
          onDrop={(ev) => {
            ev.preventDefault();
            if (dragIdx !== null && drop) moveTo(dragIdx, drop.idx, drop.pos);
            setDragIdx(null);
            setDrop(null);
          }}
          className={`relative rounded-md border border-slate-200 bg-white shadow-sm transition ${dragIdx === i ? 'opacity-40' : ''}`}
        >
          {drop?.idx === i ? (
            <span aria-hidden className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-indigo-500 ${drop.pos === 'before' ? '-top-1' : '-bottom-1'}`} />
          ) : null}
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1">
            <span
              aria-hidden
              draggable
              onDragStart={(ev) => {
                setDragIdx(i);
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/plain', String(i));
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setDrop(null);
              }}
              title="Drag to reorder"
              className="shrink-0 cursor-grab text-slate-300 transition hover:text-slate-500 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-slate-400">#{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{itemSummary(sub, item)}</span>
            <button type="button" className={iconBtn} aria-label={`Move item ${i + 1} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={iconBtn} aria-label={`Move item ${i + 1} down`} title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={iconBtn} aria-label={`Duplicate item ${i + 1}`} title="Duplicate" onClick={() => duplicate(i)}>
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={`${iconBtn} hover:bg-rose-50 hover:text-rose-600`} aria-label={`Remove item ${i + 1}`} title="Remove" onClick={() => remove(i)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-2.5">
            <FieldGroup fields={sub} values={item} projectId={projectId} path={`${path}.${i}`} itemIndex={i} onChange={(name, v) => setItem(i, name, v)} />
          </div>
        </div>
      ))}
      <button type="button" className={`${ghostButton} w-full justify-center border border-dashed border-indigo-300/70 text-indigo-600`} onClick={add}>
        <Plus className="h-4 w-4" /> Add item
      </button>
    </GroupShell>
  );
}

/** A `select` field: a dropdown of the schema-configured choices (config.options); falls back to a
 *  plain text input when no choices are configured yet. A stored value not in the list is preserved. */
function SelectField({ field, value, onRaw, id, ariaLabel }: { field: Field; value: unknown; onRaw: (raw: unknown) => void; id: string; ariaLabel: string }) {
  const options = fieldSelectOptions(field);
  const cur = typeof value === 'string' ? value : '';
  if (options.length === 0) {
    return <input id={id} aria-label={ariaLabel} className={glassInput} value={cur} onChange={(e) => onRaw(e.target.value)} />;
  }
  const missing = cur !== '' && !options.includes(cur);
  return (
    <select id={id} aria-label={ariaLabel} className={glassInput} value={cur} onChange={(e) => onRaw(e.target.value)}>
      <option value="">— choose —</option>
      {missing ? <option value={cur}>{cur} (not an option)</option> : null}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** A `reference` field: a dropdown of the target dataset's entries (config.dataset), each shown by its
 *  label; stores the chosen entry's id (read in templates via {{item.<target>.<id>.…}}). Falls back to
 *  a text input + hint when no target dataset is configured. */
function ReferenceField({ field, value, onRaw, id, ariaLabel }: { field: Field; value: unknown; onRaw: (raw: unknown) => void; id: string; ariaLabel: string }) {
  const ctx = useContext(EntryFormContext);
  const targetSlug = fieldReferenceDataset(field);
  const targetDataset = ctx?.datasets.find((d) => d.slug === targetSlug);
  const options = useMemo(() => {
    if (!ctx || !targetDataset) return [] as { id: string; label: string }[];
    return ctx.entries
      .filter((e) => e.dataset === targetSlug)
      .slice()
      .sort(compareEntryOrder)
      .map((e) => ({ id: e.id, label: entryLabel(targetDataset, e) }));
  }, [ctx, targetSlug, targetDataset]);
  const cur = typeof value === 'string' ? value : '';
  if (!targetSlug || !targetDataset) {
    return (
      <>
        <input id={id} aria-label={ariaLabel} className={glassInput} value={cur} onChange={(e) => onRaw(e.target.value)} />
        <p className="mt-1 text-[11px] text-amber-600">No target dataset set — configure this reference in the schema editor.</p>
      </>
    );
  }
  const missing = cur !== '' && !options.some((o) => o.id === cur);
  return (
    <select id={id} aria-label={ariaLabel} className={glassInput} value={cur} onChange={(e) => onRaw(e.target.value)}>
      <option value="">— none —</option>
      {missing ? <option value={cur}>{cur} (missing)</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A `json` field: a monospace textarea with live syntax validation. Keeps its OWN text state so a
 *  parsed value isn't re-pretty-printed mid-keystroke; reports validity (by `path`) so the modal can
 *  block Save while the JSON is malformed. */
function JsonField({ value, onRaw, id, ariaLabel, path }: { value: unknown; onRaw: (raw: unknown) => void; id: string; ariaLabel: string; path: string }) {
  const ctx = useContext(EntryFormContext);
  const [text, setText] = useState(() => (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2)));
  const valid = isJsonValid(text);
  useEffect(() => {
    ctx?.reportValidity(path, valid);
    return () => ctx?.reportValidity(path, true);
  }, [ctx, path, valid]);
  return (
    <>
      <textarea
        id={id}
        aria-label={ariaLabel}
        aria-invalid={!valid}
        className={`${glassInput} min-h-20 font-mono text-xs ${valid ? '' : 'border-rose-400 focus:border-rose-400'}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onRaw(e.target.value);
        }}
      />
      {valid ? null : <p className="mt-1 text-[11px] text-rose-500">Invalid JSON — fix the syntax to save.</p>}
    </>
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
  const id = `entry-${path}`;
  const aria = ariaLabel ?? field.name;
  const common = { id, 'aria-label': aria };
  switch (field.type) {
    case 'richtext':
      return <RichTextField id={id} ariaLabel={aria} value={typeof value === 'string' ? value : ''} onChange={onRaw} />;
    case 'json':
      return <JsonField id={id} ariaLabel={aria} path={path} value={value} onRaw={onRaw} />;
    case 'number':
      return <input {...common} type="number" className={glassInput} value={typeof value === 'number' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'boolean':
      return <input {...common} type="checkbox" className={toggleInput} checked={value === true} onChange={(e) => onRaw(e.target.checked)} />;
    case 'date':
      return <input {...common} type="date" className={glassInput} value={typeof value === 'string' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'time':
      return <input {...common} type="time" className={glassInput} value={typeof value === 'string' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'datetime':
      return <input {...common} type="datetime-local" className={glassInput} value={typeof value === 'string' ? value : ''} onChange={(e) => onRaw(e.target.value)} />;
    case 'image':
      return (
        <AssetField label={field.name} inputId={id} hideLabel value={typeof value === 'string' ? value : ''} onChange={onRaw} projectId={projectId} accept={ACCEPT.image} placeholder="/photo.jpg" />
      );
    case 'select':
      return <SelectField field={field} value={value} onRaw={onRaw} id={id} ariaLabel={aria} />;
    case 'reference':
      return <ReferenceField field={field} value={value} onRaw={onRaw} id={id} ariaLabel={aria} />;
    case 'object':
      return <ObjectField field={field} value={value} projectId={projectId} path={path} onRaw={onRaw} />;
    case 'list':
      return <ListField field={field} value={value} projectId={projectId} path={path} onRaw={onRaw} />;
    default:
      // text
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
  /** All datasets + entries in the project — powers a `reference` field's entry picker. */
  allDatasets?: readonly Dataset[];
  allEntries?: readonly Entry[];
  /** Called after a successful save; the parent reloads its list / refreshes the preview. The modal
   *  STAYS OPEN (it resets its dirty baseline) — closing is an explicit user action. */
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Field-typed editor for ONE dataset entry, in its own stacked Modal. The draft/published state is a
 * toggle in the header. Save is enabled only when there are unsaved changes (or the entry is new);
 * saving persists via `putEntry`, surfaces a toast, and keeps the modal open (the baseline resets so
 * the form is no longer dirty) — the parent only reloads its list / refreshes the preview.
 */
export function EntryEditorModal({ projectId, dataset, entry, keyEditable = false, existingIds, allDatasets, allEntries, onSaved, onClose }: EntryEditorModalProps) {
  const { confirm, dialog } = useDialogs();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, unknown>>(entry.values);
  const [status, setStatus] = useState<'draft' | 'published'>(entry.status);
  const [keyInput, setKeyInput] = useState('');
  const [editKey, setEditKey] = useState(false);
  const [saving, setSaving] = useState(false);
  // The last SAVED snapshot — the dirty baseline. Starts from `entry`; updates on each save so the
  // modal can stay open and recompute "dirty" from the freshly-persisted state.
  const [base, setBase] = useState<{ id: string; status: 'draft' | 'published'; values: Record<string, unknown> }>({ id: entry.id, status: entry.status, values: entry.values });
  // Has this entry been written to the server yet? A brand-new entry hasn't — so Save is enabled even
  // with no edits (you're creating it). After the first save it has, so Save then requires a change.
  const [existsServer, setExistsServer] = useState(!keyEditable);
  // Malformed-JSON paths reported by JsonField children — Save is blocked while any is invalid.
  const [invalidPaths, setInvalidPaths] = useState<ReadonlySet<string>>(() => new Set());

  const reportValidity = useCallback((path: string, valid: boolean) => {
    setInvalidPaths((prev) => {
      const has = prev.has(path);
      if (valid === !has) return prev; // (valid && !has) or (invalid && has) → no change
      const next = new Set(prev);
      if (valid) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const ctx = useMemo<EntryFormCtx>(() => ({ datasets: allDatasets ?? NO_DATASETS, entries: allEntries ?? NO_ENTRIES, reportValidity }), [allDatasets, allEntries, reportValidity]);

  const keyFieldOpen = keyEditable || editKey;
  const typedKey = keyFieldOpen && keyInput.trim() !== '';
  // An IDENTIFIER (underscores, not hyphens) so the key works as a bare Handlebars path.
  const computedId = typedKey ? identifierize(keyInput) : base.id;
  const idChanged = computedId !== base.id;
  const keyTaken = idChanged && !!existingIds?.has(computedId);
  const keyInvalid = typedKey && computedId === '';
  const hasInvalidJson = invalidPaths.size > 0;
  const dirty = status !== base.status || JSON.stringify(values) !== JSON.stringify(base.values) || idChanged;
  // Save is live when there is something to persist (a change, or an as-yet-uncreated new entry) AND
  // the key + every json field are valid.
  const canSave = (dirty || !existsServer) && !keyTaken && !keyInvalid && !hasInvalidJson;

  function setField(field: Field, raw: unknown) {
    setValues((prev) => ({ ...prev, [field.name]: coerceFieldValue(field.type, raw) }));
  }

  async function submit() {
    if (keyInvalid) {
      toast.show('Enter a key with letters, digits, or underscores.', 'error');
      return;
    }
    if (keyTaken) {
      toast.show(`The key “${computedId}” is already used in this dataset.`, 'error');
      return;
    }
    setSaving(true);
    try {
      await api.putEntry(projectId, { ...entry, id: computedId, status, values });
      // An EXISTING entry whose key changed is recreated under the new id; drop the old row.
      // (PUT-then-DELETE: a failure leaves the new copy rather than losing the entry.)
      if (existsServer && idChanged) await api.deleteEntry(projectId, base.id);
      setBase({ id: computedId, status, values });
      setExistsServer(true);
      setKeyInput('');
      setEditKey(false);
      toast.show('Entry saved', 'success');
      onSaved(); // parent reloads its list / refreshes the preview — the modal stays open
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to save entry', 'error');
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
    <div role="group" aria-label="Status" className="flex items-center rounded-xl border border-white/60 bg-white/50 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl">
      {(['draft', 'published'] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={status === s}
          onClick={() => setStatus(s)}
          className={`waves-effect rounded-lg px-2.5 py-1 capitalize transition ${status === s ? `${gradientSurface} font-bold` : 'text-slate-500 hover:text-slate-800'}`}
        >
          {s}
        </button>
      ))}
    </div>
  );

  // Title reflects the CURRENT (possibly unsaved) first-text-field value, not the stale prop.
  const title = `Edit ${entryLabel(dataset, { ...entry, id: base.id, values })}`;

  return (
    <Modal title={title} size="lg" onClose={onClose} onBeforeClose={confirmClose} onSave={() => void submit()} saving={saving} saveDisabled={!canSave} headerExtra={statusSwitch}>
      <EntryFormContext.Provider value={ctx}>
        <div className="flex flex-col gap-3 p-5">
          {keyFieldOpen ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">
                Key <span className="text-slate-300">— the id used in <code>{`{{item.${dataset.slug}.<key>}}`}</code> (letters, digits, _)</span>
              </span>
              <input
                aria-label="Entry key"
                className={glassInput}
                placeholder={`${base.id}${keyEditable ? ' (auto)' : ''}`}
                value={keyInput}
                autoFocus={editKey}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <span className={`text-[11px] ${keyTaken || keyInvalid ? 'text-rose-500' : 'text-slate-400'}`}>
                {keyInvalid ? 'enter letters, digits, or underscores' : <>→ <code>{computedId}</code>{keyTaken ? ' · already used in this dataset' : ''}</>}
              </span>
              {existsServer && idChanged ? (
                <span className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                  Renaming the key recreates this entry as <code>{computedId}</code> and deletes the old <code>{base.id}</code> — update any{' '}
                  <code>{`{{item.${dataset.slug}.${base.id}}}`}</code> references in your pages.
                </span>
              ) : null}
            </label>
          ) : (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[11px] text-slate-400">
                Key: <code className="rounded bg-slate-100 px-1 py-0.5">{base.id}</code> — read it directly with{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5">{`{{item.${dataset.slug}.${base.id}.…}}`}</code>
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
          {dataset.fields.map((field) => {
            const group = isGroupFieldType(field.type);
            return (
              <div key={field.name} className="flex flex-col gap-1">
                {group ? null : (
                  <label htmlFor={`entry-${field.name}`} className="text-xs font-medium text-slate-500">
                    {field.name}
                    <span className="ml-1 text-slate-300">({field.type})</span>
                    {field.required && <span className="ml-1 text-red-400">*</span>}
                  </label>
                )}
                <FieldInput field={field} value={readValue(values, field.name)} projectId={projectId} path={field.name} ariaLabel={field.name} onRaw={(raw) => setField(field, raw)} />
              </div>
            );
          })}
        </div>
      </EntryFormContext.Provider>
      {dialog}
    </Modal>
  );
}
