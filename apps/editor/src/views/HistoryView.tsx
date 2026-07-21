import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, eventsUrl, type Project, type ProjectRevisionRow } from '../api';
import { useDialogs } from './ui/Dialogs';
import { useToast } from './ui/Toast';
import { glassCard } from '../theme';
import { when, OP_PILL, authorLabel, KIND_LABEL } from './revision-format';

const PAGE = 50;
const KIND_FILTERS = ['page', 'template', 'snippet', 'translation', 'dataset', 'entry', 'form', 'settings'];
const OP_FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'put', label: 'Saved' },
  { value: 'restore', label: 'Restored' },
  { value: 'delete', label: 'Deleted' },
];
const selectCls = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-300 shadow-sm';

/**
 * Project-wide revision activity feed (the History nav tab). Lists every revision across all content
 * (pages, datasets, entries, settings, …) newest-first, filterable by kind/action, with non-destructive
 * Restore per row — including DELETED items (a tombstone row restores/recreates the entity). The
 * per-editor History buttons remain the in-context shortcut; this is the global log + restore-deleted home.
 */
export function HistoryView({ project }: { project: Project }) {
  const { confirm, dialog } = useDialogs();
  const toast = useToast();
  const [items, setItems] = useState<ProjectRevisionRow[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [op, setOp] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listProjectRevisions(project.id, { kind: kind || undefined, op: op || undefined, limit: PAGE });
      setItems(res.items);
      setNextBefore(res.nextBefore);
    } catch {
      setItems([]);
      setNextBefore(null);
    }
  }, [project.id, kind, op]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  // Live-append: a save / agent edit / delete anywhere in the project refreshes the first page.
  useEffect(() => {
    const src = new EventSource(eventsUrl(project.id), { withCredentials: true });
    let handle: ReturnType<typeof setTimeout> | undefined;
    src.addEventListener('content', () => {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => void load(), 500);
    });
    return () => {
      if (handle) clearTimeout(handle);
      src.close();
    };
  }, [project.id, load]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await api.listProjectRevisions(project.id, { kind: kind || undefined, op: op || undefined, limit: PAGE, before: nextBefore });
      setItems((prev) => [...(prev ?? []), ...res.items]);
      setNextBefore(res.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  };

  const restore = async (r: ProjectRevisionRow) => {
    const ok = await confirm({
      title: 'Restore this version?',
      message: `Restore ${KIND_LABEL[r.kind] ?? r.kind} "${r.label}" to its version from ${when(r.revisionAt)} (${authorLabel(r)})${r.op === 'delete' ? ' — this recreates the deleted item' : ''}. Reversible — the current version stays in history.`,
      confirmLabel: 'Restore',
      danger: false,
    });
    if (!ok) return;
    setRestoringId(r.id);
    try {
      await api.restoreRevision(project.id, r.kind, r.entityId, r.id, r.dataset);
      toast.show('Revision restored', 'success');
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">History</h2>
        <div className="flex items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by content type" className={selectCls}>
            <option value="">All content</option>
            {KIND_FILTERS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
          <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Filter by action" className={selectCls}>
            {OP_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {items === null ? (
        <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">Loading history…</p>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No revisions yet for this filter.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r) => {
            const pill = OP_PILL[r.op];
            return (
              <li key={r.id} className={`${glassCard} flex items-center gap-3 px-4 py-3 text-sm`}>
                <span className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-700 dark:text-slate-200" title={new Date(r.revisionAt).toLocaleString()}>
                    <span className="text-slate-400 dark:text-slate-500">{KIND_LABEL[r.kind] ?? r.kind} · </span>
                    <span className="font-medium">{r.label}</span>
                  </div>
                  <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                    {authorLabel(r)} · {when(r.revisionAt)}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={restoringId !== null}
                  onClick={() => void restore(r)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-default disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {restoringId === r.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {nextBefore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mx-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-40"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
      {dialog}
    </div>
  );
}
