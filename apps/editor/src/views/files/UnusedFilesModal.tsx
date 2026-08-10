import { useCallback, useEffect, useState } from 'react';
import { Trash2, History } from 'lucide-react';
import { api, type MediaAsset } from '../../api';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { FileTypeIcon } from '../media/file-icons';
import { ghostButton, dangerButton, toggleInput } from '../../theme';

type Unused = MediaAsset & { onlyInHistory?: boolean };

interface Scanned {
  assets: number;
  contentRows: number;
  globalRows: number;
  revisionRows: number;
}

const kb = (n?: number) => (typeof n === 'number' ? `${(n / 1024).toFixed(0)} KB` : '');

/**
 * "Unused files" — media nothing in the project refers to.
 *
 * ★ SELECT-ALL IS THE DEFAULT, which is only defensible because two things are true. Deleting here
 * moves an asset to the RECYCLE BIN, recoverable for 90 days, so a mistake is not final. And the scan
 * errs towards "used": it searches every page, template, snippet, translation, dataset, entry, form,
 * image map and the settings document (logo, icon, OG image, critical CSS, project scripts), plus the
 * global library — so a file offered here is one nothing points at, not one the search failed to see.
 *
 * Assets referenced ONLY by version history are shown but NOT pre-selected. Deleting one breaks a
 * restore rather than a page — a different decision, and not one to make on somebody's behalf.
 */
export function UnusedFilesModal({ projectId, onClose, onChanged }: { projectId: string; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<Unused[]>([]);
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useDialogs();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.unusedMedia(projectId);
      const sorted = [...res.items].sort((a, b) => a.filename.localeCompare(b.filename));
      setItems(sorted);
      setScanned(res.scanned);
      // Everything except the history-only ones — see the note above.
      setSelected(new Set(sorted.filter((m) => !m.onlyInHistory).map((m) => m.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the scan could not be run');
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;

  async function remove() {
    const ids = items.filter((m) => selected.has(m.id)).map((m) => m.id);
    if (!ids.length) return;
    const historyCount = items.filter((m) => selected.has(m.id) && m.onlyInHistory).length;
    const ok = await confirm({
      title: `Move ${ids.length} file${ids.length === 1 ? '' : 's'} to the Recycle Bin?`,
      message: historyCount
        ? `${historyCount} of these are still referenced by version history — restoring an older revision would come back with them missing. Everything here stays recoverable for 90 days.`
        : 'They stay in the Recycle Bin for 90 days, so this can be undone.',
      confirmLabel: 'Move to Recycle Bin',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await api.deleteMedia(projectId, id);
      } catch {
        failed.push(id);
      }
    }
    setBusy(false);
    onChanged();
    if (failed.length) {
      // Re-scan FIRST, then report: `load()` clears the error banner as its first act, so setting the
      // message before it would wipe the one thing the author needs to see. Say how many did NOT go,
      // rather than reporting a clean sweep and leaving them on screen.
      await load();
      setError(`${failed.length} file${failed.length === 1 ? '' : 's'} could not be deleted.`);
      return;
    }
    onClose();
  }

  return (
    <Modal title="Unused files" onClose={onClose} size="lg">
      {dialog}
      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Searching every page, template, snippet, dataset, form and setting…</p>}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Nothing unused — every file in this project is referenced somewhere.
        </p>
      )}

      {!loading && items.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            {items.length} file{items.length === 1 ? '' : 's'} that nothing refers to.{' '}
            {scanned && (
              <span className="text-slate-500 dark:text-slate-400">
                Searched {scanned.contentRows} content record{scanned.contentRows === 1 ? '' : 's'}, {scanned.globalRows} global
                librar{scanned.globalRows === 1 ? 'y item' : 'y items'} and {scanned.revisionRows} version
                {scanned.revisionRows === 1 ? '' : 's'} of history.
              </span>
            )}
          </p>

          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className={toggleInput}
              aria-label="Select all"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m.id)))}
            />
            Select all
          </label>

          <ul className="max-h-96 divide-y divide-slate-200 overflow-y-auto dark:divide-white/10">
            {items.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  className={toggleInput}
                  aria-label={`Select ${m.filename}`}
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                />
                <FileTypeIcon asset={m} />
                <span className="min-w-0 flex-1 truncate text-sm">{m.filename}</span>
                {m.onlyInHistory && (
                  <span
                    className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                    title="Only referenced by version history — deleting it would break a restore, not a page."
                  >
                    <History size={11} aria-hidden />
                    in history
                  </span>
                )}
                <span className="text-xs text-slate-500 dark:text-slate-400">{kb(m.bytes)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" className={ghostButton} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={dangerButton} onClick={() => void remove()} disabled={busy || selected.size === 0}>
              <Trash2 size={14} aria-hidden className="mr-1 inline" />
              {busy ? 'Deleting…' : `Move ${selected.size} to Recycle Bin`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
