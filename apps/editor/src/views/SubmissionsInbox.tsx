import { useEffect, useState } from 'react';
import type { FormSubmission } from '@sitewright/schema';
import { api, type Project } from '../api';
import { glassCard, dangerButton, ghostButton } from '../theme';
import { useDialogs } from './ui/Dialogs';
import { SkeletonList } from './ui/Skeleton';
import { Tooltip } from './ui/Tooltip';

/**
 * Submissions inbox: the form submissions captured by the public endpoint, newest
 * first. Values are plain text (the engine stores text only) and rendered via
 * React (escaped by default), so visitor-supplied content cannot inject markup.
 *
 * `formId` scopes the inbox to one form (the Forms tab opens it in a modal per form); omitted,
 * it shows every form's submissions.
 */
/**
 * When a lead came in, to the minute, in the reader's own locale ("Nov 9, 2026, 9:30 AM" in en-US, "9 Nov 2026,
 * 09:30" in en-GB). The seconds were noise that wrapped the line on a phone; the exact instant stays in `<time>`.
 */
const submittedAt = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function SubmissionsInbox({ project, formId }: { project: Project; formId?: string }) {
  const { confirm, dialog } = useDialogs();
  const [items, setItems] = useState<FormSubmission[]>([]);
  // What each form calls its fields (and itself). Resolved server-side from the definition as it is
  // NOW, so renaming a label fixes every lead already in here rather than only the next one.
  const [forms, setForms] = useState<Record<string, { name: string; labels: Record<string, string> }>>({});
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
      setForms(res.forms ?? {});
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
              {/* Wraps like a form row: the summary takes the line, and Resend / Delete drop under it, on the
                  right, when a phone has no room beside it. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  className="min-w-0 flex-1 basis-48 break-words text-left"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} submission from ${s.formId}`}
                  onClick={() => setOpenId(open ? null : s.id)}
                >
                  {!formId && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{forms[s.formId]?.name ?? s.formId}</span>
                  )}{!formId && ' '}
                  <span className="text-slate-700 dark:text-slate-200">{summary.slice(0, 80)}</span>
                  {/* Day and time, no seconds; on a phone on its own line under the summary. */}
                  <time dateTime={s.createdAt} className="text-xs text-slate-500 max-sm:block sm:ml-2 dark:text-slate-400">
                    {submittedAt(s.createdAt)}
                  </time>
                </button>
                <span className="ml-auto flex shrink-0 items-center gap-3">
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
                </span>
              </div>
              {/* The label column is wider than it was for raw names — "Pickup Date in Windhoek"
                  needs room that `arrival_date` did not — but capped, so a long one cannot squeeze
                  the value it belongs to. On a phone two columns left the answer a 150px strip, so there
                  each label sits over its value instead. */}
              {open && (
                <dl className="mt-3 grid grid-cols-1 gap-x-3 border-t border-slate-100 pt-1 text-xs sm:grid-cols-[minmax(8rem,14rem)_1fr] sm:gap-y-1 sm:pt-3 dark:border-white/10">
                  {Object.entries(s.fields).map(([k, v]) => {
                    // No label → the field is not in the definition (what a hand-authored page posts
                    // beyond it). Those keys stay MONOSPACE: they are the raw name, and dressing one
                    // up as prose would hide which are the author's words and which are the wiring.
                    // The raw name stays reachable on hover either way.
                    const label = forms[s.formId]?.labels?.[k];
                    return (
                      <div key={k} className="contents">
                        <Tooltip tip={label ? k : undefined}>
                          {/* ★ A raw name is one unbroken word (`utm_source_campaign_identifier`): `break-all`, or
                              it runs out of its column over the value beside it. */}
                          <dt
                            className={`${label ? 'break-words ' : 'break-all font-mono '}min-w-0 text-slate-500 max-sm:mt-2 dark:text-slate-400`}
                          >
                            {label ?? k}
                          </dt>
                        </Tooltip>
                        <dd className="min-w-0 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">{v}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No submissions yet.</li>}
      </ul>
    </div>
  );
}
