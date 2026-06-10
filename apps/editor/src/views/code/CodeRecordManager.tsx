import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditorModal } from '../ui/CodeEditorModal';
import { useDialogs } from '../ui/Dialogs';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { primaryButton, ghostButton, glassPanel } from '../../theme';
import { SnippetPreviewButton } from './SnippetPreviewButton';

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
  /** Tailwind classes for the record-chip grid. Defaults to a responsive up-to-4-column grid. */
  gridClassName?: string;
  /** When set, each chip gets an eye button that previews the rendered record on hover. Returns the
   *  sandboxed preview iframe URL for a record at a scope. */
  previewUrl?: (rec: CodeRecord, scope: Scope) => string;
  /**
   * Edit a record's display NAME in the editor. `editableName` keeps the stable id (templates — page
   * references survive). `renamable` RE-KEYS (snippets — the id IS the `{{> name}}` include, so a
   * rename can't auto-update existing references; the user is warned). Use one or the other.
   */
  editableName?: boolean;
  renamable?: boolean;
}

const byName = (a: CodeRecord, b: CodeRecord) => a.name.localeCompare(b.name);

/**
 * A CRUD manager for "named Handlebars source" records (snippets, templates). Lists the project's own
 * records and the shared GLOBAL library; creates one (name → generated id → empty source → straight
 * into the editor) at a chosen scope; edits a record's source in the {@link CodeEditorModal}; deletes
 * with a confirm. Storage-agnostic via injected adapters. Project users manage only their own records;
 * an instance admin can additionally edit/delete globals and create at the global scope.
 */
export function CodeRecordManager({ projectId, noun, load, save, remove, makeId, hint, nameHint, globalAdapters, isAdmin, includeRef, gridClassName, previewUrl, editableName, renamable }: CodeRecordManagerProps) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  const [records, setRecords] = useState<CodeRecord[]>([]);
  const [globals, setGlobals] = useState<CodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rec: CodeRecord; scope: Scope } | null>(null);
  // The in-progress display name while the editor is open (only used when `editableName`). Seeded
  // from the record on open; the stable `id` is never touched, so page references survive a rename.
  const [editName, setEditName] = useState('');
  const { confirm, prompt, dialog } = useDialogs();
  // Uniqueness is checked against the LATEST lists at submit time (the name dialog is async).
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const globalsRef = useRef(globals);
  globalsRef.current = globals;

  // Seed the editable name whenever the editor opens on a record (no-op visually unless `editableName`).
  useEffect(() => {
    if (editing) setEditName(editing.rec.name);
  }, [editing]);

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

  /** Validate a proposed new name for an existing record: unchanged is always OK; otherwise it must
   *  pass `makeId` (format + uniqueness) against the OTHER records in the same scope. */
  const validateRename = (name: string, { rec, scope }: { rec: CodeRecord; scope: Scope }): string | null => {
    const n = name.trim();
    if (n === rec.name) return null;
    const others = (scope === 'global' ? globalsRef.current : recordsRef.current).filter((r) => r.id !== rec.id);
    const res = makeId(n, others);
    return 'error' in res ? res.error : null;
  };

  // Rejects on failure so the editor stays open (it only closes on a resolved save). Two name modes:
  // `editableName` (templates) edits the display NAME but KEEPS the stable id, so page references
  // survive. `renamable` (snippets) RE-KEYS — a snippet's id IS its name (the `{{> id}}` partial) — so
  // a rename writes a new record + removes the old, and existing references won't auto-update.
  const persist = async ({ rec, scope }: { rec: CodeRecord; scope: Scope }, source: string, newName?: string) => {
    const adapters = adaptersFor(scope);
    const setList = scope === 'global' ? setGlobals : setRecords;
    const trimmed = newName?.trim();
    const renamed = renamable && trimmed !== undefined && trimmed !== '' && trimmed !== rec.name;
    try {
      if (renamed) {
        const others = (scope === 'global' ? globalsRef.current : recordsRef.current).filter((r) => r.id !== rec.id);
        const res = makeId(trimmed, others);
        if ('error' in res) {
          setError(res.error);
          throw new Error('invalid name');
        }
        const next: CodeRecord = { id: res.id, name: trimmed, source };
        // Save the new record FIRST (so a failure can't lose the snippet), then drop the old key.
        await adapters.save(projectId, next);
        try {
          await adapters.remove(projectId, rec.id);
        } catch {
          // The rename succeeded; only the old copy lingers (the user can delete it).
        }
        setList((rs) => [...rs.filter((r) => r.id !== rec.id && r.id !== next.id), next].sort(byName));
        setError(null);
        const ref = includeRef ? includeRef(rec) : `“${rec.name}”`;
        toast.show(`Renamed to “${next.name}”. Existing ${ref} references won’t update automatically.`);
        return;
      }
      // editableName (templates): keep the stable id, apply the edited display name (empty → old name).
      const name = editableName ? trimmed || rec.name : rec.name;
      const next = { ...rec, name, source };
      await adapters.save(projectId, next);
      setList((rs) => rs.map((r) => (r.id === rec.id ? next : r)).sort(byName));
      setError(null);
    } catch (err) {
      if (!(err instanceof Error && err.message === 'invalid name')) {
        setError(`Couldn’t save the ${noun} — your changes are still in the editor; try again.`);
      }
      throw err instanceof Error ? err : new Error('save failed');
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
      {previewUrl && <SnippetPreviewButton url={previewUrl(r, scope)} label={r.name} />}
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

  const grid = gridClassName ?? 'grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

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
          // Reflect the edited name live (via nameEdit.onChange → editName) so the heading doesn't go stale.
          title={`${(editableName || renamable) && editName.trim() ? editName.trim() : editing.rec.name} — ${editing.scope === 'global' ? 'global ' : ''}${noun}`}
          value={editing.rec.source}
          hint={hint}
          // Templates edit the display name (id kept). Snippets RENAME (re-key) — PROJECT scope only,
          // since a global snippet's `{{> id}}` is referenced across every project. Rename is validated.
          nameEdit={
            editableName || (renamable && editing.scope !== 'global')
              ? { value: editing.rec.name, label: `${noun} name`, onChange: setEditName, validate: renamable ? (name) => validateRename(name, editing) : undefined }
              : undefined
          }
          onSave={(src, name) => persist(editing, src, name)}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog}
    </div>
  );
}
