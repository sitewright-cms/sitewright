import { useState } from 'react';
import { Check, Copy, Plus, X } from 'lucide-react';
import { SEARCH_CONSOLE_OWNERS_MAX, type SiteRegistrationView } from '@sitewright/schema';
import { api } from '../../api';
import { fieldLabel, ghostButton, glassInput, primaryButton, smallGhostButton } from '../../theme';
import { OutboundLink } from '../ui/OutboundLink';
import { useCopy } from '../ui/useCopy';

/**
 * SEARCH CONSOLE OWNERS — the Google accounts that own the site in Search Console beside the platform's service
 * account, and what each of them still does once: being an owner does not put the site in their Search Console list,
 * so they add it there as a URL-prefix property (Google confirms the ownership at once).
 */

/** Enough to catch a typo before Google is asked; Google decides whether it is a Google account. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SEARCH_CONSOLE = 'https://search.google.com/search-console';
/** Search Console's property-type chooser ("URL prefix" or "Domain"). */
const ADD_PROPERTY = 'https://search.google.com/search-console/welcome';
/** One property's reports, for an account that has it. */
export const searchConsoleProperty = (siteUrl: string): string => `${SEARCH_CONSOLE}?resource_id=${encodeURIComponent(siteUrl)}`;

const message = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** What a new owner does once, in their own Google account, before the site shows in their Search Console. */
function AddPropertySteps({ siteUrl }: { siteUrl: string }) {
  const [copied, copy] = useCopy();
  return (
    <section aria-labelledby="owner-steps-heading" className="flex flex-col gap-2 rounded-lg border border-sky-200/80 bg-sky-50/70 px-3 py-2.5 text-xs text-slate-700 dark:border-sky-400/20 dark:bg-sky-400/5 dark:text-slate-200">
      <h4 id="owner-steps-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Each new owner, once
      </h4>
      <p>Being an owner does not put the site in their Search Console list. Each owner adds it there themselves, signed in with the Google account added here:</p>
      <ol className="flex list-decimal flex-col gap-2 pl-4">
        <li>
          Open Search Console and choose <strong>Add property</strong> (the property menu, top left).
          <span className="mt-1 flex flex-wrap gap-1.5">
            <OutboundLink href={ADD_PROPERTY}>Add property</OutboundLink>
          </span>
        </li>
        <li>
          Pick <strong>URL prefix</strong>, not Domain, and enter exactly:
          <span className="mt-1 flex min-w-0 items-center gap-1.5">
            <code className="min-w-0 break-all rounded bg-white/80 px-1.5 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-white/10 dark:text-slate-100">{siteUrl}</code>
            <button type="button" className={smallGhostButton} aria-label={copied === 'site' ? 'Copied the property address' : 'Copy the property address'} onClick={() => copy(siteUrl, 'site')}>
              {copied === 'site' ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied === 'site' ? 'Copied' : 'Copy'}
            </button>
          </span>
        </li>
        <li>
          Google confirms the ownership straight away, without asking for a verification method. The reports are then one click away.
          <span className="mt-1 flex flex-wrap gap-1.5">
            <OutboundLink href={searchConsoleProperty(siteUrl)}>Open the site’s reports</OutboundLink>
          </span>
        </li>
      </ol>
      <p className="text-slate-500 dark:text-slate-400">
        A <strong>Domain</strong> property is a different one: Google asks for a DNS record for it, and this ownership does not count there. The numbers start on the day
        Google verified the site and arrive a day or two late.
      </p>
    </section>
  );
}

export function SearchConsoleOwners({
  projectId,
  view,
  adopt,
}: {
  projectId: string;
  view: SiteRegistrationView;
  /** A newer state the server answered with. */
  adopt: (view: SiteRegistrationView) => void;
}) {
  const [owners, setOwners] = useState<string[]>(view.google.owners);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const googleReady = view.google.enabled && view.google.status === 'verified';

  function add(): void {
    const email = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return setDraftError('Enter the email address of a Google account');
    if (owners.includes(email)) return setDraftError(`${email} is on the list already`);
    if (owners.length >= SEARCH_CONSOLE_OWNERS_MAX) return setDraftError(`At most ${SEARCH_CONSOLE_OWNERS_MAX} owners`);
    setOwners([...owners, email]);
    setDraft('');
    setDraftError(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setNote(null);
    try {
      const res = await api.setSearchConsoleOwners(projectId, owners);
      adopt(res.view);
      // Refused: the list as typed stays, to fix and save again.
      if (res.result.ok) setOwners(res.view.google.owners);
      setNote({ ok: res.result.ok, text: res.result.detail });
    } catch (err) {
      setNote({ ok: false, text: message(err, 'Could not change the owners') });
    } finally {
      setSaving(false);
    }
  }

  // A list that did not get access at the last verification can be saved again as it is.
  const changed = !sameList(owners, view.google.owners) || view.google.ownersIssue !== null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        These Google accounts own the site in Search Console beside the platform, so they can open its reports there. Removing someone here takes that ownership away
        again.
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
          {view.google.ownersIssue && !note && (
            <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-300">
              {view.google.ownersIssue}. Save owners tries again.
            </p>
          )}
          {note && (
            <p role="status" className={`text-xs ${note.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300'}`}>
              {note.text}
            </p>
          )}
          <span>
            <button type="button" className={primaryButton} disabled={!changed || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save owners'}
            </button>
          </span>
          {view.siteUrl && <AddPropertySteps siteUrl={view.siteUrl} />}
        </>
      )}
    </div>
  );
}
