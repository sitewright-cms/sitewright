import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { api, type ProjectRevisionRow } from '../api';
import { when, authorLabel, OP_PILL, KIND_LABEL } from './revision-format';
import { diffSnapshots, summarise, type FieldChange } from '../lib/revision-diff';

/**
 * What actually changed in one revision.
 *
 * ★ A history row says a page was saved. It cannot say that the only thing that moved was the meta
 * description — and for a page `source`, finding that out by reading two snapshots side by side is
 * hopeless. So this fetches THIS revision and the one before it for the same entity, and shows the
 * field-level difference: scalars as before → after, multi-line text as a line diff.
 *
 * The predecessor is found from the entity's own revision list rather than from the project feed,
 * because the feed is filtered and paginated — the row immediately above in the UI is frequently a
 * different entity entirely.
 */
export function RevisionDetailsModal({
  projectId,
  row,
  onClose,
}: {
  projectId: string;
  row: ProjectRevisionRow;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; changes: FieldChange[]; isFirst: boolean }
  >({ status: 'loading' });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await api.listRevisions(projectId, row.kind, row.entityId, row.dataset || undefined);
        const ordered = list.items;
        const idx = ordered.findIndex((r) => r.id === row.id);
        // The list is newest-first, so the PREVIOUS version of this entity is the next one along.
        const prev = idx >= 0 ? ordered[idx + 1] : undefined;
        const [thisRev, prevRev] = await Promise.all([
          api.getRevision(projectId, row.kind, row.entityId, row.id),
          prev ? api.getRevision(projectId, row.kind, row.entityId, prev.id) : Promise.resolve(null),
        ]);
        if (!live) return;
        setState({
          status: 'ready',
          changes: diffSnapshots(prevRev ? prevRev.revision.data : undefined, thisRev.revision.data),
          isFirst: !prev,
        });
      } catch (err) {
        if (live) setState({ status: 'error', message: err instanceof Error ? err.message : 'Could not load this revision' });
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId, row]);

  const pill = OP_PILL[row.op];
  return (
    <Modal title="What changed" onClose={onClose} size="2xl">
      <div className="flex h-[70dvh] flex-col gap-3 p-5">
        <header className="shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {pill && <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>}
            <span className="text-sm text-slate-500 dark:text-slate-400">{KIND_LABEL[row.kind] ?? row.kind} ·</span>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{row.label}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {authorLabel(row)} · {when(row.revisionAt)} · {new Date(row.revisionAt).toLocaleString()}
            {row.note ? ` · ${row.note}` : ''}
          </p>
        </header>

        {state.status === 'loading' && <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading the comparison…</p>}
        {state.status === 'error' && <p className="py-10 text-center text-sm text-rose-500 dark:text-rose-300">{state.message}</p>}
        {state.status === 'ready' && (
          <>
            <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
              {state.isFirst ? 'The first version of this item — everything in it was new.' : summarise(state.changes)}
            </p>
            <div className="min-h-0 flex-1 overflow-auto pr-1">
              {state.changes.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  This revision stored the same values as the one before it.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {state.changes.map((c) => (
                    <ChangeRow key={c.path} change={c} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const KIND_CHIP: Record<FieldChange['kind'], string> = {
  added: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  removed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  changed: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

function ChangeRow({ change }: { change: FieldChange }) {
  return (
    <li className="rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${KIND_CHIP[change.kind]}`}>{change.kind}</span>
        <code className="min-w-0 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{change.path || '(document)'}</code>
        {change.truncated && <span className="text-[10px] text-slate-400 dark:text-slate-500">shortened</span>}
      </div>
      {change.lines ? (
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2 text-[11px] leading-relaxed">
          {change.lines.map((l, i) => (
            <div
              key={i}
              className={
                l.kind === 'add'
                  ? 'text-emerald-300'
                  : l.kind === 'remove'
                    ? 'text-rose-300'
                    : 'text-slate-400'
              }
            >
              {l.kind === 'add' ? '+ ' : l.kind === 'remove' ? '- ' : '  '}
              {l.text}
            </div>
          ))}
        </pre>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {change.before !== undefined && <ValueBox tone="before" value={change.before} />}
          {change.after !== undefined && <ValueBox tone="after" value={change.after} />}
        </div>
      )}
    </li>
  );
}

function ValueBox({ tone, value }: { tone: 'before' | 'after'; value: string }) {
  return (
    <div>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{tone}</span>
      <pre
        className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg px-2 py-1.5 text-xs ${
          tone === 'before'
            ? 'bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200'
            : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
        }`}
      >
        {value === '' ? '(empty)' : value}
      </pre>
    </div>
  );
}
