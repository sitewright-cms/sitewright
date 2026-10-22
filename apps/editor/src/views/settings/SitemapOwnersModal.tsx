import { useState } from 'react';
import type { SiteRegistrationView, WebmasterService } from '@sitewright/schema';
import { api } from '../../api';
import { ghostButton } from '../../theme';
import { Modal } from '../ui/Modal';
import { OutboundLink } from '../ui/OutboundLink';
import { Tabs } from '../ui/Tabs';
import { SearchConsoleOwners } from './SearchConsoleOwners';

/**
 * SITEMAP AND OWNERS — what a registration offers past the verification itself (agency staff only), one tab each:
 *
 *   - Sitemap: handed to each search engine that verified the site: when that last happened, and "Submit again"
 *     (a search engine reads it again when it is submitted again — after new pages, say);
 *   - Search Console owners (Google only): the Google accounts that own the site in Search Console beside the
 *     platform's service account, so staff (or the client) can open its reports there themselves.
 */

type Section = 'sitemap' | 'owners';
const SECTIONS = [
  { id: 'sitemap', label: 'Sitemap' },
  { id: 'owners', label: 'Search Console owners' },
] as const;

const ENGINES: ReadonlyArray<{ key: WebmasterService; name: string; report: (siteUrl: string) => string; who: string }> = [
  {
    key: 'google',
    name: 'Google Search Console',
    report: (siteUrl) => `https://search.google.com/search-console/sitemaps?resource_id=${encodeURIComponent(siteUrl)}`,
    who: 'for its Search Console owners',
  },
  {
    key: 'bing',
    name: 'Bing Webmaster Tools',
    report: (siteUrl) => `https://www.bing.com/webmasters/sitemaps?siteUrl=${encodeURIComponent(siteUrl)}`,
    who: 'for the platform’s Bing account',
  },
];

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const message = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);

function SitemapPanel({ projectId, view, adopt }: { projectId: string; view: SiteRegistrationView; adopt: (view: SiteRegistrationView) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = ENGINES.filter((e) => view[e.key].enabled && view[e.key].status === 'verified');

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    const failed: string[] = [];
    // Each search engine on its own: one that cannot be reached must not keep the sitemap from the other.
    for (const e of verified) {
      try {
        adopt((await api.submitSitemap(projectId, e.key)).view);
      } catch (err) {
        failed.push(`${e.name}: ${message(err, 'could not submit the sitemap')}`);
      }
    }
    if (failed.length) setError(failed.join(' · '));
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {view.sitemapUrl ? (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-xs text-slate-600 dark:text-slate-300">{view.sitemapUrl}</span>
          <OutboundLink href={view.sitemapUrl} label="Open the sitemap">
            Open
          </OutboundLink>
        </span>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-300">Set an https Production URL first</p>
      )}
      <ul className="flex flex-col gap-2 text-sm" aria-label="Sitemap per search engine">
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
            <li key={e.key} className="flex flex-col gap-1">
              <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <span className="shrink-0 font-medium text-slate-700 dark:text-slate-200">{e.name}</span>
                <span className={`min-w-0 break-words text-xs ${state.tone}`}>{state.text}</span>
              </span>
              {entry.status === 'verified' && view.siteUrl && (
                <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <OutboundLink href={e.report(view.siteUrl)} label={`The sitemap report at ${e.name}`}>
                    Sitemap report
                  </OutboundLink>
                  {e.who}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
      <span>
        <button type="button" className={ghostButton} disabled={verified.length === 0 || submitting} onClick={() => void submit()}>
          {submitting ? 'Submitting…' : verified.some((e) => view[e.key].sitemap) ? 'Submit again' : 'Submit the sitemap'}
        </button>
      </span>
      <p className="text-xs text-slate-500 dark:text-slate-400">Verify now submits it too. Each search engine reads it later, on its own schedule.</p>
    </div>
  );
}

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
  // Owners that did not get access are the one thing here that needs doing: open on them.
  const [section, setSection] = useState<Section>(initial.google.ownersIssue ? 'owners' : 'sitemap');

  const adopt = (next: SiteRegistrationView): void => {
    setView(next);
    onChange(next);
  };

  return (
    <Modal title="Sitemap and owners" size="md" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <Tabs ariaLabel="Sitemap and owners" active={section} onSelect={setSection} tabs={SECTIONS} className="self-start" />
        {/* Both panels stay mounted, so an owner typed but not saved survives a look at the sitemap. */}
        <div role="tabpanel" aria-label="Sitemap" hidden={section !== 'sitemap'}>
          <SitemapPanel projectId={projectId} view={view} adopt={adopt} />
        </div>
        <div role="tabpanel" aria-label="Search Console owners" hidden={section !== 'owners'}>
          <SearchConsoleOwners projectId={projectId} view={view} adopt={adopt} />
        </div>
      </div>
    </Modal>
  );
}
