import { useEffect, useState } from 'react';
import type { FormSubmission } from '@sitewright/schema';
import { api, type Project } from '../api';

/**
 * Submissions inbox: the form submissions captured by the public endpoint, newest
 * first. Values are plain text (the engine stores text only) and rendered via
 * React (escaped by default), so visitor-supplied content cannot inject markup.
 *
 * `formId` scopes the inbox to one form (the Forms tab folds this in per-row); omitted,
 * it shows every form's submissions.
 */
export function SubmissionsInbox({ project, formId }: { project: Project; formId?: string }) {
  const [items, setItems] = useState<FormSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listSubmissions(project.id);
      if (!isActive()) return;
      // Scope to one form when asked (the Forms-tab "Show submissions" action).
      const scoped = formId ? res.items.filter((s) => s.formId === formId) : res.items;
      setItems(scoped);
      setTotal(formId ? scoped.length : res.total);
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
    if (!window.confirm('Delete this submission?')) return;
    try {
      await api.deleteSubmission(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete submission');
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading submissions…</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-500">{total} submission{total === 1 ? '' : 's'}</p>
      <ul className="flex flex-col gap-2">
        {items.map((s) => {
          const open = openId === s.id;
          const summary = Object.values(s.fields)[0] ?? '';
          return (
            <li key={s.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <div className="flex items-center gap-3">
                <button
                  className="flex-1 text-left"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} submission from ${s.formId}`}
                  onClick={() => setOpenId(open ? null : s.id)}
                >
                  {!formId && <code className="text-xs text-slate-400">{s.formId}</code>}{!formId && ' '}
                  <span className="text-slate-700">{summary.slice(0, 80)}</span>
                  <span className="ml-2 text-xs text-slate-400">{new Date(s.createdAt).toLocaleString()}</span>
                </button>
                <button
                  aria-label={`Delete submission ${s.id}`}
                  className="text-xs text-red-500 hover:text-red-700"
                  onClick={() => remove(s.id)}
                >
                  Delete
                </button>
              </div>
              {open && (
                <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs">
                  {Object.entries(s.fields).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-slate-500">{k}</dt>
                      <dd className="whitespace-pre-wrap break-words text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="text-sm text-slate-400">No submissions yet.</li>}
      </ul>
    </div>
  );
}
