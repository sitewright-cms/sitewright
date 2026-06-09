import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditorModal } from '../ui/CodeEditorModal';
import { useDialogs } from '../ui/Dialogs';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { primaryButton, ghostButton, glassPanel } from '../../theme';

/** The shared shape of a name + Handlebars source record (snippet, template). */
export interface CodeRecord {
  id: string;
  name: string;
  source: string;
}

/** Turn a typed name into a valid, unique id — or an error to show. */
export type MakeId = (name: string, existing: readonly CodeRecord[]) => { id: string } | { error: string };

/** load/save/remove for one scope. The global adapters ignore the projectId (instance-wide). */
export interface RecordAdapters {
  load: (projectId: string) => Promise<CodeRecord[]>;
  save: (projectId: string, rec: CodeRecord) => Promise<unknown>;
  remove: (projectId: string, id: string) => Promise<unknown>;
}

type Scope = 'project' | 'global';

export interface CodeRecordManagerProps {
  projectId: string;
  /** Singular noun for labels/messages, e.g. `snippet` / `template`. */
  noun: string;
  load: RecordAdapters['load'];
  save: RecordAdapters['save'];
  remove: RecordAdapters['remove'];
  makeId: MakeId;
  /** One-line hint shown above the source editor (bindings / how to reference it). */
  hint?: string;
  /** Help text under the toolbar (naming rules). */
  nameHint?: string;
  /** Adapters for the GLOBAL (instance-wide) library — present → a "Global" section is shown. */
  globalAdapters?: RecordAdapters;
  /** True for an instance admin: globals become editable + a global scope can be chosen on create. */
  isAdmin?: boolean;
  /** How to reference a record for the copy button (snippets → `{{> name}}`); omit for templates. */
  includeRef?: (rec: CodeRecord) => string;
}

const byName = (a: CodeRecord, b: CodeRecord) => a.name.localeCompare(b.name);

/**
 * A CRUD manager for "named Handlebars source" records (snippets, templates). Lists the project's own
 * records and the shared GLOBAL library; creates one (name → generated id → empty source → straight
 * into the editor) at a chosen scope; edits a record's source in the {@link CodeEditorModal}; deletes
 * with a confirm. Storage-agnostic via injected adapters. Project users manage only their own records;
 * an instance admin can additionally edit/delete globals and create at the global scope.
 */
export function CodeRecordManager({ projectId, noun, load, save, remove, makeId, hint, nameHint, globalAdapters, isAdmin, includeRef }: CodeRecordManagerProps) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  const [records, setRecords] = useState<CodeRecord[]>([]);
  const [globals, setGlobals] = useState<CodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rec: CodeRecord; scope: Scope } | null>(null);
  const { confirm, prompt, dialog } = useDialogs();
  // Uniqueness is checked against the LATEST lists at submit time (the name dialog is async).
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const globalsRef = useRef(globals);
  globalsRef.current = globals;

  const adaptersFor = useCallback(
    (scope: Scope): RecordAdapters => (scope === 'global' && globalAdapters ? globalAdapters : { load, save, remove }),
    [globalAdapters, load, save, remove],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([load(projectId), globalAdapters ? globalAdapters.load(projectId) : Promise.resolve([])])
      .then(([rs, gs]) => {
        if (!alive) return;
        setRecords([...rs].sort(byName));
        setGlobals([...gs].sort(byName));
        setLoading(false);
      })
      .catch(() => alive && (setError(`Couldn’t load the ${noun}s.`), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [projectId, noun, load, globalAdapters]);

  const create = useCallback(
    async (scope: Scope) => {
      const name = await prompt({ title: scope === 'global' ? `New global ${noun}` : `New ${noun}`, label: 'Name', placeholder: nameHint });
      if (!name) return;
      const existing = scope === 'global' ? globalsRef.current : recordsRef.current;
      const res = makeId(name, existing);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      const rec: CodeRecord = { id: res.id, name, source: '' };
      try {
        await adaptersFor(scope).save(projectId, rec);
        const setList = scope === 'global' ? setGlobals : setRecords;
        setList((rs) => [...rs.filter((r) => r.id !== rec.id), rec].sort(byName));
        setError(null);
        setEditing({ rec, scope }); // open the editor on the new record immediately
      } catch {
        setError(`Couldn’t create the ${scope === 'global' ? 'global ' : ''}${noun}.`);
      }
    },
    [prompt, noun, nameHint, makeId, adaptersFor, projectId],
  );

  // Rejects on failure so the editor stays open (it only closes on a resolved save).
  const persist = async ({ rec, scope }: { rec: CodeRecord; scope: Scope }, source: string) => {
    const next = { ...rec, source };
    try {
      await adaptersFor(scope).save(projectId, next);
      const setList = scope === 'global' ? setGlobals : setRecords;
      setList((rs) => rs.map((r) => (r.id === rec.id ? next : r)));
      setError(null);
    } catch {
      setError(`Couldn’t save the ${noun} — your changes are still in the editor; try again.`);
      throw new Error('save failed');
    }
  };

  const del = async (rec: CodeRecord, scope: Scope) => {
    if (!(await confirm({ title: `Delete ${scope === 'global' ? 'global ' : ''}${noun}`, message: `Delete “${rec.name}”? This cannot be undone.`, confirmLabel: 'Delete' }))) return;
    try {
      await adaptersFor(scope).remove(projectId, rec.id);
      const setList = scope === 'global' ? setGlobals : setRecords;
      setList((rs) => rs.filter((r) => r.id !== rec.id));
    } catch {
      setError(`Couldn’t delete the ${noun}.`);
    }
  };

  /** One record chip: edit/delete (when editable) or copy (read-only globals for non-admins). */
  const chip = (r: CodeRecord, scope: Scope, editable: boolean) => (
    <li key={`${scope}:${r.id}`} className={`${glassPanel} flex items-center gap-2 rounded-xl px-3 py-2`}>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={r.name}>
        {r.name}
      </span>
      {editable ? (
        <>
          <button className={`${ghostButton} px-2 py-1 text-xs`} aria-label={`Edit ${r.name}`} onClick={() => setEditing({ rec: r, scope })}>
            Edit
          </button>
          <button className="px-1.5 text-xs text-slate-400 transition hover:text-rose-600" aria-label={`Delete ${r.name}`} onClick={() => void del(r, scope)}>
            ✕
          </button>
        </>
      ) : (
        <>
          {includeRef && (
            <button className={`${ghostButton} px-2 py-1 font-mono text-[11px]`} aria-label={`Copy ${includeRef(r)}`} title={`Copy ${includeRef(r)}`} onClick={() => copy(includeRef(r), `inc-${r.id}`)}>
              {copiedId === `inc-${r.id}` ? '✓' : '{{>}}'}
            </button>
          )}
          <button className={`${ghostButton} px-2 py-1 text-[11px]`} aria-label={`Copy ${r.name} source`} title="Copy source" onClick={() => copy(r.source, `src-${r.id}`)}>
            {copiedId === `src-${r.id}` ? '✓' : 'Source'}
          </button>
        </>
      )}
    </li>
  );

  const grid = 'grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <div className="p-3">
      {globalAdapters && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Global {noun}s {isAdmin ? '· editable' : '· built-in, read-only'}
            </p>
            {isAdmin && (
              <button className={`${ghostButton} px-2 py-0.5 text-[11px]`} onClick={() => void create('global')}>
                + New global
              </button>
            )}
          </div>
          {globals.length === 0 ? (
            <p className="text-[11px] text-slate-400">No global {noun}s.</p>
          ) : (
            <ul className={grid}>{globals.map((g) => chip(g, 'global', !!isAdmin))}</ul>
          )}
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your {noun}s</p>
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button className={`${primaryButton} px-3 py-1.5 text-xs`} onClick={() => void create('project')}>
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
        <ul className={grid}>{records.map((r) => chip(r, 'project', true))}</ul>
      )}
      {editing && (
        <CodeEditorModal
          title={`${editing.rec.name} — ${editing.scope === 'global' ? 'global ' : ''}${noun}`}
          value={editing.rec.source}
          hint={hint}
          onSave={(src) => persist(editing, src)}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog}
    </div>
  );
}
