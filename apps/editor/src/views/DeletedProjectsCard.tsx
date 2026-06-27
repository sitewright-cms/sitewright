import { useCallback, useEffect, useState } from 'react';
import { api, type DeletedProject } from '../api';
import { dangerButton, ghostButton, glassCard } from '../theme';

const solidDanger =
  'waves-effect inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The instance-admin "Deleted projects" surface: every soft-deleted project, each with RESTORE (un-delete)
 * and DELETE (permanent reap — rows, files, and any orphaned client accounts), plus a "remove all" sweep.
 * The permanent actions take a simple inline confirm (the destructive type-to-confirm gate lives on the
 * in-app delete, not here). Self-contained — it loads its own data and is not part of the settings form.
 */
export function DeletedProjectsCard() {
  const [items, setItems] = useState<DeletedProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id being acted on (or 'all'), or null
  const [confirming, setConfirming] = useState<string | null>(null); // id (or 'all') awaiting confirm

  const load = useCallback(async () => {
    try {
      setItems((await api.listDeletedProjects()).projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load deleted projects.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, run: () => Promise<unknown>, failMsg: string) => {
    setBusy(key);
    setError(null);
    setConfirming(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : failMsg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`${glassCard} p-4`}>
      <h2 className="mb-1 text-sm font-bold text-slate-700">Deleted projects</h2>
      <p className="mb-3 text-xs text-slate-500">
        Soft-deleted projects are hidden and their sites are offline, but recoverable. <strong>Restore</strong>{' '}
        brings one back intact; <strong>Delete</strong> permanently erases its data, files, and any client
        left with no other project (your agency staff are never removed).
      </p>
      {error && (
        <p role="alert" className="mb-2 text-sm text-rose-600">
          {error}
        </p>
      )}
      {items === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">No deleted projects.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">
                    {p.name} <span className="font-normal text-slate-400">/{p.slug}</span>
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    Deleted {p.deletedAt ? new Date(p.deletedAt).toLocaleString() : ''}
                    {p.deletedBy ? ` by ${p.deletedBy}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(p.id, () => api.restoreProject(p.id), 'Restore failed.')}
                    className={ghostButton}
                  >
                    Restore
                  </button>
                  {confirming === p.id ? (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void act(p.id, () => api.reapProject(p.id), 'Delete failed.')}
                        className={solidDanger}
                      >
                        Delete forever
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className={ghostButton}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={busy !== null} onClick={() => setConfirming(p.id)} className={dangerButton}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            {confirming === 'all' ? (
              <>
                <span className="text-rose-700">Permanently remove all {items.length}?</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act('all', () => api.reapAllDeletedProjects(), 'Could not remove all.')}
                  className={solidDanger}
                >
                  Confirm
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={ghostButton}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirming('all')}
                className="font-medium text-rose-600 transition hover:underline disabled:opacity-50"
              >
                Remove all deleted projects
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
