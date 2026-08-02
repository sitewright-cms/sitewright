import { useEffect, useState } from 'react';
import type { FormSubmission } from '@sitewright/schema';
import { api, type Project } from '../api';
import { glassCard, dangerButton, ghostButton } from '../theme';
import { useDialogs } from './ui/Dialogs';
import { SkeletonList } from './ui/Skeleton';

/**
 * Submissions inbox: the form submissions captured by the public endpoint, newest
 * first. Values are plain text (the engine stores text only) and rendered via
 * React (escaped by default), so visitor-supplied content cannot inject markup.
 *
 * `formId` scopes the inbox to one form (the Forms tab folds this in per-row); omitted,
 * it shows every form's submissions.
 */
export function SubmissionsInbox({ project, formId }: { project: Project; formId?: string }) {
  const { confirm, dialog } = useDialogs();
  const [items, setItems] = useState<FormSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Delivery is best-effort — the visitor is thanked whether or not the mail left — so a broken
  // SMTP is otherwise invisible here. Emailing someone about broken email is circular, which is
  // why the alert lives in the one place they already come to read leads.
  const [undelivered, setUndelivered] = useState<{ count: number; lastError: string | null }>({ count: 0, lastError: null });
  const [resending, setResending] = useState(false);

  async function load(isActive: () => boolean = () => true) {
    try {
      // Scope server-side when asked (the Forms-tab "Show submissions" action) so the page +
      // `total` are correct per form — the endpoint paginates (newest 50), so filtering client-side
      // would both miscount and miss older submissions.
      const [res, owed] = await Promise.all([
        api.listSubmissions(project.id, formId),
        // Same scope as the list: a project-wide count here would announce another form's failure
        // over this form's rows.
        api.undeliveredSubmissions(project.id, formId).catch(() => ({ count: 0, lastError: null })),
      ]);
      if (!isActive()) return;
      setItems(res.items);
      setTotal(res.total);
      setUndelivered(owed);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load submissions');
    } finally {
      if (isActive()) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [project.id, formId]);

  async function remove(id: string) {
    if (!(await confirm({ title: 'Delete submission', message: 'Delete this submission?', confirmLabel: 'Delete' }))) return;
    try {
      await api.deleteSubmission(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete submission');
    }
  }

  async function resend(id: string) {
    setResending(true);
    setError(null);
    try {
      await api.resendSubmission(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to queue the resend');
    } finally {
      setResending(false);
    }
  }

  if (loading) return <SkeletonList rows={3} label="Loading submissions…" />;

  return (
    <div className="flex flex-col gap-3">
      {dialog}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {undelivered.count > 0 && (
        <div className={`${glassCard} border-l-4 border-amber-500 px-4 py-3 text-sm`} role="status">
          <p className="font-bold text-amber-700 dark:text-amber-400">
            {undelivered.count} submission{undelivered.count === 1 ? ' was' : 's were'} not emailed
          </p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            {undelivered.lastError ?? 'Delivery has not succeeded yet.'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The submissions themselves are safe below — only the notification failed. Fix the SMTP settings, then use
            Resend, or wait for the automatic retry.
          </p>
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">{total} submission{total === 1 ? '' : 's'}</p>
      <ul className="flex flex-col gap-2">
        {items.map((s) => {
          const open = openId === s.id;
          const summary = Object.values(s.fields)[0] ?? '';
          return (
            <li key={s.id} className={`${glassCard} px-4 py-3 text-sm`}>
              <div className="flex items-center gap-3">
                <button
                  className="flex-1 text-left"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} submission from ${s.formId}`}
                  onClick={() => setOpenId(open ? null : s.id)}
                >
                  {!formId && <code className="text-xs text-slate-400 dark:text-slate-500">{s.formId}</code>}{!formId && ' '}
                  <span className="text-slate-700 dark:text-slate-200">{summary.slice(0, 80)}</span>
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{new Date(s.createdAt).toLocaleString()}</span>
                </button>
                {/* ★ Gated on THIS ROW's state, not on the aggregate count. Keying it off the count
                    put a Resend beside every row the moment any one of them failed — one click on a
                    delivered row and the recipient gets the same lead twice. The server refuses it
                    too; this is so the button is not offered in the first place. */}
                {(s.deliveryState === 'pending' || s.deliveryState === 'failed') && (
                  <button
                    aria-label={`Resend submission ${s.id}`}
                    className={`${ghostButton} px-2 py-1 text-xs`}
                    disabled={resending}
                    onClick={() => void resend(s.id)}
                  >
                    Resend
                  </button>
                )}
                <button
                  aria-label={`Delete submission ${s.id}`}
                  className={dangerButton}
                  onClick={() => remove(s.id)}
                >
                  Delete
                </button>
              </div>
              {open && (
                <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 border-t border-slate-100 dark:border-white/10 pt-3 text-xs">
                  {Object.entries(s.fields).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-slate-500 dark:text-slate-400">{k}</dt>
                      <dd className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="text-sm text-slate-400 dark:text-slate-500">No submissions yet.</li>}
      </ul>
    </div>
  );
}
