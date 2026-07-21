import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, type MediaAsset } from '../../api';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { FileTypeIcon } from '../media/file-icons';
import { ghostButton, dangerButton } from '../../theme';

type Deleted = MediaAsset & { deletedAt: number };

/**
 * The File Manager Recycle Bin — soft-deleted media, restorable for 90 days (then auto-purged by the
 * server reaper). Restore brings an asset back into the library; "Delete forever" permanently removes
 * the row + the binary.
 */
export function RecycleBinModal({ projectId, onClose, onChanged }: { projectId: string; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<Deleted[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useDialogs();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Most-recently-deleted first, then by name — the server returns them unordered.
      const deleted = (await api.listDeletedMedia(projectId)).items;
      setItems([...deleted].sort((a, b) => b.deletedAt - a.deletedAt || a.filename.localeCompare(b.filename)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load the Recycle Bin');
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function restore(m: Deleted) {
    setError(null);
    try {
      await api.restoreMedia(projectId, m.id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'restore failed');
    }
  }

  async function purge(m: Deleted) {
    if (!(await confirm({ title: 'Delete forever', message: `Permanently delete “${m.filename}”? This cannot be undone.`, confirmLabel: 'Delete forever' }))) return;
    setError(null);
    try {
      await api.purgeMedia(projectId, m.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    }
  }

  return (
    <Modal title="Recycle Bin" size="xl" onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">Deleted files are kept here for 90 days, then permanently removed.</p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">The Recycle Bin is empty.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-white/10">
            {items.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                {m.kind === 'image' ? (
                  <img src={m.url} alt="" className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200 dark:ring-white/10" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-slate-500">
                    <FileTypeIcon filename={m.filename} className="h-5 w-5" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200" title={m.filename}>
                  {m.filename}
                </span>
                <button type="button" onClick={() => void restore(m)} className={`${ghostButton} px-2.5 py-1 text-xs`}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </button>
                <button type="button" onClick={() => void purge(m)} className={`${dangerButton} text-xs`}>
                  Delete forever
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
