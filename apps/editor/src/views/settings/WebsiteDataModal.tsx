import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, GripVertical, X } from 'lucide-react';
import type { JsonValue } from '@sitewright/schema';
import { Modal } from '../ui/Modal';
import { ghostButton, glassInput, primaryButton, toggleInput } from '../../theme';

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
const TYPES: readonly JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array'];
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

function jsonTypeOf(v: JsonValue): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  return t === 'object' ? 'object' : (t as JsonType);
}
function defaultFor(t: JsonType): JsonValue {
  switch (t) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'null': return null;
    case 'array': return [];
    case 'object': return {};
    default: return '';
  }
}
const isBranch = (t: JsonType): boolean => t === 'object' || t === 'array';

/** How many children a branch holds — shown next to its type so a collapsed node still says how big it is. */
function childCount(v: JsonValue): number {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

/**
 * A lightweight, stack-safe pre-flight over a parsed JSON value for the in-modal "JSON source" path:
 * returns a human-readable reason if it contains a prototype-pollution key or an over-long key, else
 * null. The SERVER schema (isJsonValue) is the authoritative gate — this only gives the author
 * immediate, contextual feedback instead of a generic save-settings error after the round-trip.
 */
function firstBadKey(root: JsonValue): string | null {
  const stack: JsonValue[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (RESERVED.has(k)) return `the key "${k}" is reserved`;
        if (k.length > 200) return `the key "${k.slice(0, 24)}…" is too long (max 200 chars)`;
        stack.push(val);
      }
    }
  }
  return null;
}

// The store is a root OBJECT (website.data/page.data are key→value maps). A non-object value (legacy
// or hand-edited) coerces to {} so the tree editor always shows the object surface.
const isObjectRoot = (v: JsonValue): v is Record<string, JsonValue> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const selectCls =
  'shrink-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 py-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400';
const iconBtn =
  'shrink-0 rounded p-1 text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent';
const removeBtn = `${iconBtn} hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400`;

/** The rail down the left of a nested group. It turns BRAND on hover, so pointing anywhere in a group
 *  shows you exactly how far it reaches — the one thing a flat indent cannot tell you. */
const nestRail =
  'ml-2 border-l border-slate-200 dark:border-slate-700 pl-3 transition-colors hover:border-[var(--sw-brand-1)]';

/** A key input that commits a rename only on blur/Enter (so typing doesn't remount the row). */
function KeyField({ value, onCommit }: { value: string; onCommit: (k: string) => void }) {
  const [k, setK] = useState(value);
  useEffect(() => setK(value), [value]);
  return (
    <input
      aria-label="Key"
      value={k}
      onChange={(e) => setK(e.target.value)}
      onBlur={() => onCommit(k.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(k.trim());
        }
      }}
      className="w-40 shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-700 dark:text-slate-200"
    />
  );
}

/** Where a dragged row would land. */
type Drop = { idx: number; pos: 'before' | 'after' } | null;

/** The drag state + handlers a container hands to each of its rows. */
interface DragBind {
  readonly index: number;
  readonly dragging: boolean;
  readonly drop: Drop;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (e: React.DragEvent) => void;
  readonly onDragLeave: (e: React.DragEvent) => void;
  readonly onDrop: (e: React.DragEvent) => void;
  readonly onMove: (dir: -1 | 1) => void;
  readonly canUp: boolean;
  readonly canDown: boolean;
}

/** Wire one container's rows for drag-reorder: returns a `bind(i)` the rows spread onto themselves. */
function useReorder(count: number, move: (from: number, to: number, pos: 'before' | 'after') => void) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const bind = (i: number): DragBind => ({
    index: i,
    dragging: dragIdx === i,
    drop: drop?.idx === i ? drop : null,
    onDragStart: () => setDragIdx(i),
    onDragEnd: () => {
      setDragIdx(null);
      setDrop(null);
    },
    onDragOver: (e) => {
      if (dragIdx === null || dragIdx === i) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      setDrop((d) => (d && d.idx === i && d.pos === pos ? d : { idx: i, pos }));
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop((d) => (d?.idx === i ? null : d));
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragIdx !== null && drop) move(dragIdx, drop.idx, drop.pos);
      setDragIdx(null);
      setDrop(null);
    },
    // Keyboard parity: drag is mouse-only, so every reorder is also reachable as a one-step swap.
    onMove: (dir) => {
      const j = i + dir;
      if (j >= 0 && j < count) move(i, j, dir === -1 ? 'before' : 'after');
    },
    canUp: i > 0,
    canDown: i < count - 1,
  });
  return bind;
}

/**
 * One node of the tree: its NAME (or index), its TYPE, and — for a scalar — its value, all on ONE row.
 * A branch (object/array) collapses; it starts collapsed, because a data store with three nested levels
 * otherwise opens as a wall of inputs with no way to see its shape.
 */
function DataNode({
  name,
  label,
  value,
  onChange,
  onRemove,
  depth,
  drag,
}: {
  /** The key input for an object member, or the `[i]` badge for an array item. */
  name: React.ReactNode;
  /** Plain-text identity of this node, for the accessible names of its row controls. */
  label: string;
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  onRemove: () => void;
  depth: number;
  drag: DragBind;
}) {
  const [open, setOpen] = useState(false);
  const t = jsonTypeOf(value);
  const branch = isBranch(t);
  const count = childCount(value);
  return (
    <div
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
      className={`relative rounded-lg transition ${drag.dragging ? 'opacity-40' : ''} ${
        // Only the TOP level is tinted: at depth 0 the rows are the store's own keys and the tint is what
        // separates them; nested rows sit inside a rail that already groups them.
        depth === 0 ? 'bg-slate-500/5 dark:bg-white/5 p-1.5' : ''
      }`}
    >
      {drag.drop ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--sw-brand-1)] ${
            drag.drop.pos === 'before' ? '-top-1' : '-bottom-1'
          }`}
        />
      ) : null}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          draggable
          onDragStart={(e) => {
            drag.onDragStart();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(drag.index));
          }}
          onDragEnd={drag.onDragEnd}
          title="Drag to reorder"
          className="shrink-0 cursor-grab text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        {branch ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => setOpen((v) => !v)}
            className={iconBtn}
          >
            <ChevronRight aria-hidden className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span aria-hidden className="h-4 w-6 shrink-0" />
        )}
        {name}
        <select
          aria-label="Value type"
          value={t}
          onChange={(e) => {
            onChange(defaultFor(e.target.value as JsonType));
            setOpen(true); // switching TO a branch: show it, or the change looks like it did nothing
          }}
          className={selectCls}
        >
          {TYPES.map((x) => (
            <option key={x} value={x}>
              [{x}]
            </option>
          ))}
        </select>
        {/* Scalars carry their value on this same row; a branch shows how much it holds instead. */}
        {t === 'string' && (
          <input aria-label="Value" value={value as string} onChange={(e) => onChange(e.target.value)} className={`${glassInput} min-w-0 flex-1 py-1 text-sm`} />
        )}
        {t === 'number' && (
          <input
            aria-label="Value"
            type="number"
            value={Number.isFinite(value as number) ? (value as number) : 0}
            onChange={(e) => {
              // Guard against NaN/Infinity (rejected server-side) ever reaching the draft — a
              // non-finite value would silently serialize to null in JSON.
              const n = e.target.value === '' ? 0 : Number(e.target.value);
              onChange(Number.isFinite(n) ? n : 0);
            }}
            className={`${glassInput} min-w-0 flex-1 py-1 text-sm`}
          />
        )}
        {t === 'boolean' && (
          <input aria-label="Value" type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className={toggleInput} />
        )}
        {t === 'null' && <span className="flex-1 text-xs italic text-slate-500 dark:text-slate-400">null</span>}
        {branch && (
          <span className="flex-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {count} {t === 'array' ? (count === 1 ? 'item' : 'items') : count === 1 ? 'key' : 'keys'}
          </span>
        )}
        <button type="button" className={iconBtn} aria-label={`Move ${label} up`} title="Move up" disabled={!drag.canUp} onClick={() => drag.onMove(-1)}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={iconBtn} aria-label={`Move ${label} down`} title="Move down" disabled={!drag.canDown} onClick={() => drag.onMove(1)}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove} className={removeBtn}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {branch && open && (
        <div className="mt-1.5">
          {t === 'object' ? (
            <ObjectEditor obj={value as Record<string, JsonValue>} onChange={onChange} depth={depth + 1} />
          ) : (
            <ArrayEditor arr={value as JsonValue[]} onChange={onChange} depth={depth + 1} />
          )}
        </div>
      )}
    </div>
  );
}

function ObjectEditor({ obj, onChange, depth }: { obj: Record<string, JsonValue>; onChange: (v: JsonValue) => void; depth: number }) {
  // All writes rebuild a fresh object from Object.entries (own enumerable keys only); the only
  // externally-supplied key (a rename) is guarded against RESERVED prototype-pollution keys.
  const entries = Object.entries(obj);
  const setKeyVal = (k: string, v: JsonValue) => onChange({ ...obj, [k]: v });
  const removeKey = (k: string) => onChange(Object.fromEntries(entries.filter(([kk]) => kk !== k)));
  const rename = (oldK: string, newK: string) => {
    if (newK === oldK || newK === '' || newK.length > 200 || RESERVED.has(newK) || Object.prototype.hasOwnProperty.call(obj, newK)) return;
    onChange(Object.fromEntries(entries.map(([k, v]) => [k === oldK ? newK : k, v])));
  };
  const addKey = () => {
    let n = 1;
    let k = 'key';
    while (Object.prototype.hasOwnProperty.call(obj, k)) k = `key_${n++}`;
    onChange({ ...obj, [k]: '' });
  };
  // Reorder rebuilds the object in the new key order. NOTE: JS objects hoist INTEGER-LIKE keys ("0",
  // "12") to the front in ascending order regardless of insertion order, so a store keyed by numbers
  // cannot be reordered this way — that is a language rule, not something the editor can override. An
  // array is the right shape for ordered data and the type select is one click away.
  const move = (from: number, toIdx: number, pos: 'before' | 'after') => {
    let target = toIdx + (pos === 'after' ? 1 : 0);
    if (from < target) target -= 1;
    if (from === target) return;
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved!);
    onChange(Object.fromEntries(next));
  };
  const bind = useReorder(entries.length, move);
  return (
    // Depth 0 is the store itself: no rail, no indent — the whole panel IS the object, and a border
    // around everything only wastes width.
    <div className={`flex flex-col gap-2 ${depth === 0 ? '' : nestRail}`}>
      {entries.map(([k, v], i) => (
        // Key on the object key itself (unique within an object) — index keys mis-map rows on delete.
        <DataNode
          key={k}
          name={<KeyField value={k} onCommit={(nk) => rename(k, nk)} />}
          label={k}
          value={v}
          onChange={(nv) => setKeyVal(k, nv)}
          onRemove={() => removeKey(k)}
          depth={depth}
          drag={bind(i)}
        />
      ))}
      <button type="button" onClick={addKey} className={`${ghostButton} self-start px-2 py-0.5 text-xs`}>+ Add key</button>
    </div>
  );
}

let itemKeySeq = 0;

function ArrayEditor({ arr, onChange, depth }: { arr: JsonValue[]; onChange: (v: JsonValue) => void; depth: number }) {
  // A parallel key list keeps React identity (and therefore each row's open/closed state) with the ITEM
  // through a reorder or a delete — index keys would leave the collapsed/expanded flags behind.
  const keys = useRef<string[]>([]);
  while (keys.current.length < arr.length) keys.current.push(`di${itemKeySeq++}`);
  if (keys.current.length > arr.length) keys.current.length = arr.length;

  const move = (from: number, toIdx: number, pos: 'before' | 'after') => {
    let target = toIdx + (pos === 'after' ? 1 : 0);
    if (from < target) target -= 1;
    if (from === target) return;
    const next = [...arr];
    const nextKeys = [...keys.current];
    const [mi] = next.splice(from, 1);
    const [mk] = nextKeys.splice(from, 1);
    next.splice(target, 0, mi!);
    nextKeys.splice(target, 0, mk!);
    keys.current = nextKeys;
    onChange(next);
  };
  const remove = (i: number) => {
    const nextKeys = [...keys.current];
    nextKeys.splice(i, 1);
    keys.current = nextKeys;
    onChange(arr.filter((_, j) => j !== i));
  };
  const bind = useReorder(arr.length, move);
  return (
    <div className={`flex flex-col gap-2 ${depth === 0 ? '' : nestRail}`}>
      {arr.map((item, i) => (
        <DataNode
          key={keys.current[i]}
          name={<span className="w-40 shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">[{i}]</span>}
          label={`item ${i + 1}`}
          value={item}
          onChange={(nv) => onChange(arr.map((x, j) => (j === i ? nv : x)))}
          onRemove={() => remove(i)}
          depth={depth}
          drag={bind(i)}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          keys.current = [...keys.current, `di${itemKeySeq++}`];
          onChange([...arr, '']);
        }}
        className={`${ghostButton} self-start px-2 py-0.5 text-xs`}
      >
        + Add item
      </button>
    </div>
  );
}

/**
 * An editable JSON store editor: a graphical tree editor (add/rename keys, nest objects/arrays, pick
 * a type + value per node, drag to reorder) with a raw-JSON SOURCE toggle for power edits. Edits a
 * draft; the parent persists it on Save (server re-validates against the bounded, prototype-safe
 * schema). Reused for `website.data` (default copy) and `page.data` (via `title`/`namespace`).
 */
export function WebsiteDataModal({
  value,
  onSave,
  onClose,
  title = 'Site data',
  namespace = 'website.data',
}: {
  value: JsonValue;
  onSave: (v: JsonValue) => void;
  onClose: () => void;
  /** Modal title (also its accessible dialog name). Default "Site data". */
  title?: string;
  /** The binding namespace shown in the hint, e.g. "website.data" or "page.data". */
  namespace?: string;
}) {
  const [draft, setDraft] = useState<JsonValue>(isObjectRoot(value) ? value : {});
  const [sourceView, setSourceView] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);

  const openSource = () => {
    setSourceText(JSON.stringify(draft, null, 2));
    setSourceError(null);
    setSourceView(true);
  };
  // Parse the source text; returns the value or null (sets an error). Also pre-flights for the
  // reserved/over-long keys the server rejects, so the author sees the reason here, not a generic
  // save error after the round-trip.
  const parseSource = (): { ok: true; value: JsonValue } | { ok: false } => {
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(sourceText) as JsonValue;
    } catch (e) {
      setSourceError(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
      return { ok: false };
    }
    if (!isObjectRoot(parsed)) {
      setSourceError('Must be a JSON object — { "key": "value", … }.');
      return { ok: false };
    }
    const bad = firstBadKey(parsed);
    if (bad) {
      setSourceError(`Not allowed: ${bad}.`);
      return { ok: false };
    }
    return { ok: true, value: parsed };
  };
  const applySource = () => {
    const r = parseSource();
    if (r.ok) {
      setDraft(r.value);
      setSourceError(null);
      setSourceView(false);
    }
  };
  function save() {
    if (sourceView) {
      const r = parseSource();
      if (!r.ok) return; // stay open, error shown
      onSave(r.value);
    } else {
      onSave(draft);
    }
    onClose();
  }

  return (
    <Modal
      title={title}
      size="xl"
      onClose={onClose}
      onSave={save}
      headerExtra={
        sourceView ? (
          <button type="button" onClick={applySource} className={`${primaryButton} px-3 py-1 text-xs`}>Apply JSON</button>
        ) : (
          <button type="button" onClick={openSource} className={ghostButton}>&lt;/&gt; JSON source</button>
        )
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          A free-form object available in templates as <code>{`{{${namespace}.<key>}}`}</code> and{' '}
          <code>{`{{#each ${namespace}.<array>}}`}</code> — in the preview and the published site.
        </p>
        {sourceView ? (
          <>
            <textarea
              aria-label="JSON source"
              className={`min-h-[22rem] font-mono text-xs ${glassInput}`}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              spellCheck={false}
            />
            {sourceError && <p className="text-sm text-rose-500 dark:text-rose-300">{sourceError}</p>}
          </>
        ) : (
          // Root is always an OBJECT (no type selector here) — only its keys' values are typed.
          <ObjectEditor obj={isObjectRoot(draft) ? draft : {}} onChange={setDraft} depth={0} />
        )}
      </div>
    </Modal>
  );
}
