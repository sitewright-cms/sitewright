import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditorModal } from '../ui/CodeEditorModal';
import { useDialogs } from '../ui/Dialogs';
import { primaryButton, ghostButton, glassPanel } from '../../theme';

/** The shared shape of a name + Handlebars source record (snippet, template). */
export interface CodeRecord {
  id: string;
  name: string;
  source: string;
}

/** Turn a typed name into a valid, unique id — or an error to show. */
export type MakeId = (name: string, existing: readonly CodeRecord[]) => { id: string } | { error: string };

export interface CodeRecordManagerProps {
  projectId: string;
  /** Singular noun for labels/messages, e.g. `snippet` / `template`. */
  noun: string;
  load: (projectId: string) => Promise<CodeRecord[]>;
  save: (projectId: string, rec: CodeRecord) => Promise<unknown>;
  remove: (projectId: string, id: string) => Promise<unknown>;
  makeId: MakeId;
  /** One-line hint shown above the source editor (bindings / how to reference it). */
  hint?: string;
  /** Help text under the toolbar (naming rules). */
  nameHint?: string;
  /** Built-in, read-only starters shown above the project records — each copyable as `{{> name}}` or
   *  its raw source. */
  globals?: readonly { name: string; label: string; source: string }[];
}

const byName = (a: CodeRecord, b: CodeRecord) => a.name.localeCompare(b.name);

/** Copy-to-clipboard with a transient "copied" flag keyed by an id (timer cleared on unmount). */
function useCopy(): [string | null, (text: string, id: string) => void] {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback((text: string, id: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id);
        // Cancel any in-flight reset so a rapid second copy (e.g. across the two buttons on one
        // row) doesn't orphan the previous timer.
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
      })
      .catch(() => setCopiedId(null));
  }, []);
  return [copiedId, copy];
}

/**
 * A small CRUD manager for "named Handlebars source" records (snippets, templates). Lists the
 * records, creates one (name → generated id → empty source → straight into the editor), edits a
 * record's source in the shared {@link CodeEditorModal}, and deletes with a confirm. Storage-agnostic
 * via the injected `load`/`save`/`remove` adapters, so one component powers every code rail.
 */
export function CodeRecordManager({ projectId, noun, load, save, remove, makeId, hint, nameHint, globals }: CodeRecordManagerProps) {
  const [copiedId, copy] = useCopy();
  const [records, setRecords] = useState<CodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CodeRecord | null>(null);
  const { confirm, prompt, dialog } = useDialogs();
  // The name dialog is async; check uniqueness against the LATEST list at submit time, not the
  // snapshot from when "+ New" was clicked.
  const recordsRef = useRef(records);
  recordsRef.current = records;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load(projectId)
      .then((rs) => alive && (setRecords([...rs].sort(byName)), setLoading(false)))
      .catch(() => alive && (setError(`Couldn’t load the ${noun}s.`), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [projectId, noun, load]);

  const create = useCallback(async () => {
    const name = await prompt({ title: `New ${noun}`, label: 'Name', placeholder: nameHint });
    if (!name) return;
    const res = makeId(name, recordsRef.current);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    const rec: CodeRecord = { id: res.id, name, source: '' };
    try {
      await save(projectId, rec);
      setRecords((rs) => [...rs.filter((r) => r.id !== rec.id), rec].sort(byName));
      setError(null);
      setEditing(rec); // open the editor on the new record immediately
    } catch {
      setError(`Couldn’t create the ${noun}.`);
    }
  }, [prompt, noun, nameHint, makeId, save, projectId]);

  // Rejects on failure so the editor stays open (CodeEditorModal only closes on a resolved save),
  // keeping the in-progress source instead of discarding it.
  const persist = async (rec: CodeRecord, source: string) => {
    const next = { ...rec, source };
    try {
      await save(projectId, next);
      setRecords((rs) => rs.map((r) => (r.id === rec.id ? next : r)));
      setError(null);
    } catch {
      setError(`Couldn’t save the ${noun} — your changes are still in the editor; try again.`);
      throw new Error('save failed');
    }
  };

  const del = async (rec: CodeRecord) => {
    if (!(await confirm({ title: `Delete ${noun}`, message: `Delete “${rec.name}”? This cannot be undone.`, confirmLabel: 'Delete' }))) return;
    try {
      await remove(projectId, rec.id);
      setRecords((rs) => rs.filter((r) => r.id !== rec.id));
    } catch {
      setError(`Couldn’t delete the ${noun}.`);
    }
  };

  return (
    <div className="p-3">
      {globals && globals.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Starters (built-in · copyable)</p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {globals.map((g) => (
              <li key={g.name} className={`${glassPanel} flex items-center gap-1.5 rounded-xl px-3 py-2`}>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={`${g.label} — {{> ${g.name}}}`}>
                  {g.label}
                </span>
                <button
                  className={`${ghostButton} px-2 py-1 font-mono text-[11px]`}
                  aria-label={`Copy {{> ${g.name}}}`}
                  title={`Copy {{> ${g.name}}}`}
                  onClick={() => copy(`{{> ${g.name}}}`, `inc-${g.name}`)}
                >
                  {copiedId === `inc-${g.name}` ? '✓' : '{{>}}'}
                </button>
                <button
                  className={`${ghostButton} px-2 py-1 text-[11px]`}
                  aria-label={`Copy ${g.label} source`}
                  title="Copy source"
                  onClick={() => copy(g.source, `src-${g.name}`)}
                >
                  {copiedId === `src-${g.name}` ? '✓' : 'Source'}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your {noun}s</p>
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button className={`${primaryButton} px-3 py-1.5 text-xs`} onClick={() => void create()}>
          + New {noun}
        </button>
        {nameHint && <span className="text-[11px] text-slate-400">{nameHint}</span>}
      </div>
      {error && <p className="mb-2 text-xs text-rose-500">{error}</p>}
      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : records.length === 0 ? (
        <p className="text-xs text-slate-400">No {noun}s yet — create one to get started.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {records.map((r) => (
            <li key={r.id} className={`${glassPanel} flex items-center gap-2 rounded-xl px-3 py-2`}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={r.name}>
                {r.name}
              </span>
              <button className={`${ghostButton} px-2 py-1 text-xs`} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                Edit
              </button>
              <button
                className="px-1.5 text-xs text-slate-400 transition hover:text-rose-600"
                aria-label={`Delete ${r.name}`}
                onClick={() => void del(r)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CodeEditorModal
          title={`${editing.name} — ${noun}`}
          value={editing.source}
          hint={hint}
          onSave={(src) => persist(editing, src)}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog}
    </div>
  );
}
