import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, eventsUrl, type RevisionMeta } from '../api';
import { Modal } from './ui/Modal';
import { useDialogs } from './ui/Dialogs';
import { useToast } from './ui/Toast';
import { glassCard } from '../theme';
import { when, OP_PILL, authorLabel } from './revision-format';

interface RevisionHistoryModalProps {
  projectId: string;
  /** Revisioned content kind: 'page' | 'dataset' | 'entry' | 'settings' | … */
  kind: string;
  entityId: string;
  /** A human label shown next to the title (page title, dataset/entry name). */
  label?: string;
  onClose: () => void;
  /** Called after a successful restore so the parent reloads the (now-changed) content. */
  onRestored: () => void;
}

/**
 * Read-only history of one content entity with per-row Restore. Restore is non-destructive — it re-saves
 * the chosen snapshot (the current version stays in history) and recreates a deleted entity. Used across
 * the page editor, dataset/entry editors, and settings; the parent's `onRestored` reloads its content.
 */
export function RevisionHistoryModal({ projectId, kind, entityId, label, onClose, onRestored }: RevisionHistoryModalProps) {
  const { confirm, dialog } = useDialogs();
  const toast = useToast();
  const [items, setItems] = useState<RevisionMeta[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listRevisions(projectId, kind, entityId);
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, [projectId, kind, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live-refresh while open: a save / agent edit to this entity appends a revision.
  useEffect(() => {
    const src = new EventSource(eventsUrl(projectId), { withCredentials: true });
    let handle: ReturnType<typeof setTimeout> | undefined;
    src.addEventListener('content', () => {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => void load(), 400);
    });
    return () => {
      if (handle) clearTimeout(handle);
      src.close();
    };
  }, [projectId, load]);

  const restore = async (r: RevisionMeta) => {
    const ok = await confirm({
      title: 'Restore this version?',
      message: `Replace the current ${kind} with the version from ${when(r.revisionAt)} (${authorLabel(r)}). This is reversible — the current version stays in history.`,
      confirmLabel: 'Restore',
      danger: false,
    });
    if (!ok) return;
    setRestoringId(r.id);
    try {
      await api.restoreRevision(projectId, kind, entityId, r.id);
      toast.show('Revision restored', 'success');
      onRestored();
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Modal
      title="Revision history"
      titleExtra={label ? <span className="text-sm font-normal text-slate-400">· {label}</span> : undefined}
      size="lg"
      onClose={onClose}
    >
      {items === null ? (
        <p className="px-2 py-10 text-center text-sm text-slate-400">Loading history…</p>
      ) : items.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-slate-400">
          No history yet — nothing has been saved for this {kind} since revisions were enabled.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r, i) => {
            const pill = OP_PILL[r.op];
            // The newest non-delete revision IS the live content — restoring it is a no-op.
            const isCurrent = i === 0 && r.op !== 'delete';
            return (
              <li key={r.id} className={`${glassCard} flex items-center gap-3 px-4 py-3 text-sm`}>
                <span className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-700" title={new Date(r.revisionAt).toLocaleString()}>
                    <span className="font-medium">{authorLabel(r)}</span>
                    <span className="text-slate-400"> · {when(r.revisionAt)}</span>
                    {isCurrent && (
                      <span className="ml-2 rounded bg-indigo-100/80 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">current</span>
                    )}
                  </div>
                  {r.note && <div className="truncate text-xs text-slate-400">{r.note}</div>}
                </div>
                <button
                  type="button"
                  disabled={restoringId !== null || isCurrent}
                  onClick={() => void restore(r)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-default disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {restoringId === r.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </Modal>
  );
}
