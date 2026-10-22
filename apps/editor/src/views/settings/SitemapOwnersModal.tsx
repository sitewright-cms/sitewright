import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { SEARCH_CONSOLE_OWNERS_MAX, type SiteRegistrationView, type WebmasterService } from '@sitewright/schema';
import { api } from '../../api';
import { fieldLabel, ghostButton, glassInput, primaryButton } from '../../theme';
import { Modal } from '../ui/Modal';

/**
 * SITEMAP AND OWNERS — what a registration offers past the verification itself (agency staff only):
 *
 *   - the sitemap, handed to each search engine that verified the site: when that last happened, and "Submit again"
 *     (a search engine reads it again when it is submitted again — after new pages, say);
 *   - Google only: the Google accounts that own the site in Search Console beside the platform's service account,
 *     so staff (or the client) can open its reports there themselves.
 */

const ENGINES: ReadonlyArray<{ key: WebmasterService; name: string }> = [
  { key: 'google', name: 'Google Search Console' },
  { key: 'bing', name: 'Bing Webmaster Tools' },
];

/** Enough to catch a typo before Google is asked; Google decides whether it is a Google account. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const message = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function SitemapOwnersModal({
  projectId,
  view: initial,
  onChange,
  onClose,
}: {
  projectId: string;
  view: SiteRegistrationView;
  /** Every newer state the server answered with, for the tile behind. */
  onChange: (view: SiteRegistrationView) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [sitemapError, setSitemapError] = useState<string | null>(null);
  const [owners, setOwners] = useState<string[]>(initial.google.owners);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownersNote, setOwnersNote] = useState<{ ok: boolean; text: string } | null>(null);

  const adopt = (next: SiteRegistrationView): void => {
    setView(next);
    onChange(next);
  };

  const verified = ENGINES.filter((e) => view[e.key].enabled && view[e.key].status === 'verified');
  const googleReady = view.google.enabled && view.google.status === 'verified';

  async function submit(): Promise<void> {
    setSubmitting(true);
    setSitemapError(null);
    const failed: string[] = [];
    // Each search engine on its own: one that cannot be reached must not keep the sitemap from the other.
    for (const e of verified) {
      try {
        adopt((await api.submitSitemap(projectId, e.key)).view);
      } catch (err) {
        failed.push(`${e.name}: ${message(err, 'could not submit the sitemap')}`);
      }
    }
    if (failed.length) setSitemapError(failed.join(' · '));
    setSubmitting(false);
  }

  function add(): void {
    const email = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return setDraftError('Enter the email address of a Google account');
    if (owners.includes(email)) return setDraftError(`${email} is on the list already`);
    if (owners.length >= SEARCH_CONSOLE_OWNERS_MAX) return setDraftError(`At most ${SEARCH_CONSOLE_OWNERS_MAX} owners`);
    setOwners([...owners, email]);
    setDraft('');
    setDraftError(null);
  }

  async function saveOwners(): Promise<void> {
    setSaving(true);
    setOwnersNote(null);
    try {
      const res = await api.setSearchConsoleOwners(projectId, owners);
      adopt(res.view);
      // Refused: the list as typed stays, to fix and save again.
      if (res.result.ok) setOwners(res.view.google.owners);
      setOwnersNote({ ok: res.result.ok, text: res.result.detail });
    } catch (err) {
      setOwnersNote({ ok: false, text: message(err, 'Could not change the owners') });
    } finally {
      setSaving(false);
    }
  }

  // A list that did not get access at the last verification can be saved again as it is.
  const ownersChanged = !sameList(owners, view.google.owners) || view.google.ownersIssue !== null;
  return (
    <Modal title="Sitemap and owners" size="md" onClose={onClose}>
      <div className="flex flex-col gap-6 p-5">
        <section className="flex flex-col gap-3" aria-labelledby="sitemap-heading">
          <h3 id="sitemap-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Sitemap
          </h3>
          <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">{view.sitemapUrl ?? 'Set an https Production URL first'}</p>
          <ul className="flex flex-col gap-1.5 text-sm" aria-label="Sitemap per search engine">
            {ENGINES.filter((e) => view[e.key].enabled).map((e) => {
              const entry = view[e.key];
              const state =
                entry.status !== 'verified'
                  ? { text: 'Not verified yet: verify the site first', tone: 'text-slate-500 dark:text-slate-400' }
                  : !entry.sitemap
                    ? { text: 'Not submitted yet', tone: 'text-slate-500 dark:text-slate-400' }
                    : entry.sitemap.ok
                      ? { text: `Submitted ${when(entry.sitemap.at)}`, tone: 'text-emerald-700 dark:text-emerald-400' }
                      : { text: `Not taken ${when(entry.sitemap.at)}: ${entry.sitemap.detail}`, tone: 'text-rose-700 dark:text-rose-300' };
              return (
                <li key={e.key} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="shrink-0 font-medium text-slate-700 dark:text-slate-200">{e.name}</span>
                  <span className={`min-w-0 break-words text-xs ${state.tone}`}>{state.text}</span>
                </li>
              );
            })}
          </ul>
          {sitemapError && (
            <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">
              {sitemapError}
            </p>
          )}
          <span>
            <button type="button" className={ghostButton} disabled={verified.length === 0 || submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting…' : verified.some((e) => view[e.key].sitemap) ? 'Submit again' : 'Submit the sitemap'}
            </button>
          </span>
          <p className="text-xs text-slate-500 dark:text-slate-400">Verify now submits it too. Each search engine reads it later, on its own schedule.</p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="owners-heading">
          <h3 id="owners-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Search Console owners
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            These Google accounts own the site in Search Console beside the platform, so they can sign in at search.google.com/search-console and open its reports.
            Removing someone here takes that ownership away again.
          </p>
          {!googleReady ? (
            <p className="rounded-lg bg-slate-500/10 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
              {view.google.enabled ? 'Verify the site with Google first.' : 'Switch Google Search Console on and verify the site first.'}
            </p>
          ) : (
            <>
              {owners.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Only the platform owns the site.</p>
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="Owners">
                  {owners.map((o) => (
                    <li key={o} className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 text-sm dark:border-slate-700/70 dark:bg-white/5">
                      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{o}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${o}`}
                        className="rounded p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                        onClick={() => setOwners(owners.filter((x) => x !== o))}
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* Checked here, with its own words, rather than the browser's validation bubble. */}
              <form
                noValidate
                className="flex flex-col gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  add();
                }}
              >
                <label htmlFor="search-console-owner" className={fieldLabel}>
                  Add a Google account
                </label>
                <span className="flex gap-2">
                  <input
                    id="search-console-owner"
                    type="email"
                    className={`${glassInput} min-w-0 flex-1`}
                    placeholder="name@example.com"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setDraftError(null);
                    }}
                    aria-invalid={draftError ? true : undefined}
                    aria-describedby={draftError ? 'search-console-owner-error' : undefined}
                  />
                  <button type="submit" className={ghostButton} disabled={!draft.trim()}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Add
                  </button>
                </span>
                {draftError && (
                  <span id="search-console-owner-error" className="text-xs text-rose-700 dark:text-rose-300">
                    {draftError}
                  </span>
                )}
              </form>
              {view.google.ownersIssue && !ownersNote && (
                <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-300">
                  {view.google.ownersIssue}. Save owners tries again.
                </p>
              )}
              {ownersNote && (
                <p role="status" className={`text-xs ${ownersNote.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300'}`}>
                  {ownersNote.text}
                </p>
              )}
              <span>
                <button type="button" className={primaryButton} disabled={!ownersChanged || saving} onClick={() => void saveOwners()}>
                  {saving ? 'Saving…' : 'Save owners'}
                </button>
              </span>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
