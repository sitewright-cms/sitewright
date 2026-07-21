import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
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

const selectCls = 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-600 dark:text-slate-300';
const miniBtn = 'rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 text-slate-400 dark:text-slate-500 hover:border-rose-300 hover:text-rose-600 dark:hover:text-rose-400';

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
      className={`w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-700 dark:text-slate-200`}
    />
  );
}

/** Edits one JSON value: a type select + a type-appropriate input, recursing for object/array. */
function ValueEditor({ value, onChange }: { value: JsonValue; onChange: (v: JsonValue) => void }) {
  const t = jsonTypeOf(value);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <select aria-label="Value type" value={t} onChange={(e) => onChange(defaultFor(e.target.value as JsonType))} className={selectCls}>
          {TYPES.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        {t === 'string' && (
          <input aria-label="Value" value={value as string} onChange={(e) => onChange(e.target.value)} className={`${glassInput} py-1 text-sm`} />
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
            className={`${glassInput} py-1 text-sm`}
          />
        )}
        {t === 'boolean' && (
          <input aria-label="Value" type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className={toggleInput} />
        )}
        {t === 'null' && <span className="text-xs italic text-slate-400 dark:text-slate-500">null</span>}
      </div>
      {t === 'object' && <ObjectEditor obj={value as Record<string, JsonValue>} onChange={onChange} />}
      {t === 'array' && <ArrayEditor arr={value as JsonValue[]} onChange={onChange} />}
    </div>
  );
}

function ObjectEditor({ obj, onChange }: { obj: Record<string, JsonValue>; onChange: (v: JsonValue) => void }) {
  // All writes rebuild a fresh object from Object.entries (own enumerable keys only); the only
  // externally-supplied key (a rename) is guarded against RESERVED prototype-pollution keys.
  const setKeyVal = (k: string, v: JsonValue) => onChange({ ...obj, [k]: v });
  const removeKey = (k: string) => onChange(Object.fromEntries(Object.entries(obj).filter(([kk]) => kk !== k)));
  const rename = (oldK: string, newK: string) => {
    if (newK === oldK || newK === '' || newK.length > 200 || RESERVED.has(newK) || Object.prototype.hasOwnProperty.call(obj, newK)) return;
    onChange(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === oldK ? newK : k, v])));
  };
  const addKey = () => {
    let n = 1;
    let k = 'key';
    while (Object.prototype.hasOwnProperty.call(obj, k)) k = `key_${n++}`;
    onChange({ ...obj, [k]: '' });
  };
  return (
    <div className="ml-2 flex flex-col gap-2 border-l border-slate-200 dark:border-slate-700 pl-3">
      {Object.entries(obj).map(([k, v]) => (
        // Key on the object key itself (unique within an object) — index keys mis-map rows on delete.
        <div key={k} className="flex flex-col gap-1 rounded-lg bg-white/60 dark:bg-slate-900/60 p-2">
          <div className="flex items-center gap-2">
            <KeyField value={k} onCommit={(nk) => rename(k, nk)} />
            <button type="button" aria-label={`Remove ${k}`} onClick={() => removeKey(k)} className={miniBtn}><X className="h-4 w-4" /></button>
          </div>
          <ValueEditor value={v} onChange={(nv) => setKeyVal(k, nv)} />
        </div>
      ))}
      <button type="button" onClick={addKey} className={`${ghostButton} self-start px-2 py-0.5 text-xs`}>+ Add key</button>
    </div>
  );
}

function ArrayEditor({ arr, onChange }: { arr: JsonValue[]; onChange: (v: JsonValue) => void }) {
  return (
    <div className="ml-2 flex flex-col gap-2 border-l border-slate-200 dark:border-slate-700 pl-3">
      {arr.map((item, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-lg bg-white/60 dark:bg-slate-900/60 p-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-400 dark:text-slate-500">[{i}]</span>
            <button type="button" aria-label={`Remove item ${i}`} onClick={() => onChange(arr.filter((_, j) => j !== i))} className={miniBtn}><X className="h-4 w-4" /></button>
          </div>
          <ValueEditor value={item} onChange={(nv) => onChange(arr.map((x, j) => (j === i ? nv : x)))} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...arr, ''])} className={`${ghostButton} self-start px-2 py-0.5 text-xs`}>+ Add item</button>
    </div>
  );
}

/**
 * An editable JSON store editor: a graphical tree editor (add/rename keys, nest objects/arrays, pick
 * a type + value per node) with a raw-JSON SOURCE toggle for power edits. Edits a draft; the parent
 * persists it on Save (server re-validates against the bounded, prototype-safe schema). Reused for
 * `website.data` (default copy) and `page.data` (via `title`/`namespace`).
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
        <p className="text-xs text-slate-400 dark:text-slate-500">
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
          <ObjectEditor obj={isObjectRoot(draft) ? draft : {}} onChange={setDraft} />
        )}
      </div>
    </Modal>
  );
}
