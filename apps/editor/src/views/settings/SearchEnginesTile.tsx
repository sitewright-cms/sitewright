import { useCallback, useEffect, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import type { SiteRegistrationEntry, SiteRegistrationView, WebmasterService } from '@sitewright/schema';
import { api } from '../../api';
import { useDialogs } from '../ui/Dialogs';
import { PartRow, Row, RowBlock, SwitchRow, Tile } from './board/Tile';
import type { TileStatus } from './board/summaries';
import { SearchEngineVerify } from './SearchEngineVerify';
import { SitemapOwnersModal } from './SitemapOwnersModal';

/**
 * SEARCH ENGINES — the site registered with the platform's Google and Bing accounts, so a client needs no Search
 * Console or Bing account of their own. Agency staff only (the server refuses anyone else):
 *
 *   - a switch per search engine, usable once the website has an https Production URL and the platform has that
 *     account; switching one OFF removes the site from it;
 *   - "Verify now", which deploys the site with the tags, asks each switched-on search engine to confirm, then hands
 *     each one that verified the sitemap;
 *   - "Sitemap & owners": the sitemap again on demand, and who owns the site in Search Console besides the platform.
 *
 * Nothing is registered on its own: a deploy only keeps the tags of the switched-on search engines on the pages.
 */

const HELP =
  'Registers this site with the platform’s Google Search Console and Bing Webmaster Tools accounts, so the client needs no account of their own. Switch a search engine on, then Verify now: it deploys the site with that search engine’s tag, asks it to confirm, and submits the sitemap. The tag stays on every later deploy. Sitemap & owners submits the sitemap again, and makes Google accounts owners in Search Console. Once verified, Statistics → Search performance shows the site’s clicks and searches. Switching a search engine off removes the site from its account.';

const ENGINES: ReadonlyArray<{ key: WebmasterService; name: string; short: string }> = [
  { key: 'google', name: 'Google Search Console', short: 'Google' },
  { key: 'bing', name: 'Bing Webmaster Tools', short: 'Bing' },
];

const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const STATE: Record<SiteRegistrationEntry['status'], { word: string; tone: string }> = {
  off: { word: '', tone: '' },
  none: { word: 'not verified', tone: 'text-slate-500 dark:text-slate-400' },
  pending: { word: 'not verified', tone: 'text-slate-500 dark:text-slate-400' },
  verified: { word: 'verified', tone: 'text-emerald-700 dark:text-emerald-400' },
  failed: { word: 'failed', tone: 'text-rose-700 dark:text-rose-400' },
};

export function searchEnginesStatus(view: SiteRegistrationView | null): TileStatus {
  const on = view ? ENGINES.filter((e) => view[e.key].enabled).map((e) => view[e.key]) : [];
  if (on.length === 0) return { kind: 'default', label: 'Off' };
  if (on.every((e) => e.status === 'verified')) return { kind: 'set', label: 'Verified' };
  if (on.some((e) => e.status === 'failed')) return { kind: 'attention', label: 'Failed' };
  return { kind: 'attention', label: 'Not verified' };
}

/** Whether the tile's line reports something that went wrong. */
const attention = (view: SiteRegistrationView): boolean =>
  ENGINES.some((e) => view[e.key].enabled && (view[e.key].status === 'failed' || view[e.key].sitemap?.ok === false));

/** The one line the tile has for words: what is wrong, else what was done, else what to do next. */
function headline(view: SiteRegistrationView, error: string | null): string {
  if (error) return error;
  if (!view.siteUrl) return view.notice === 'not-https' ? 'The Production URL must be https' : 'Set an https Production URL first';
  const failed = ENGINES.find((e) => view[e.key].enabled && view[e.key].status === 'failed');
  if (failed) return `${failed.short}: ${view[failed.key].detail ?? 'not verified'}`;
  const sitemap = ENGINES.find((e) => view[e.key].enabled && view[e.key].sitemap?.ok === false);
  if (sitemap) return `${sitemap.short}: sitemap not taken: ${view[sitemap.key].sitemap?.detail ?? ''}`;
  const removed = ENGINES.find((e) => !view[e.key].enabled && view[e.key].detail);
  if (removed) return `${removed.short}: ${view[removed.key].detail}`;
  const on = ENGINES.filter((e) => view[e.key].enabled);
  if (on.length === 0) return 'Switch a search engine on to register the site';
  if (on.every((e) => view[e.key].status === 'verified')) {
    const last = on.map((e) => view[e.key].verifiedAt ?? '').sort().at(-1) ?? null;
    return `Verified${last ? ` · ${day(last)}` : ''}`;
  }
  return 'Not verified yet: Verify now deploys the site, then asks';
}

export function SearchEnginesTile({ projectId }: { projectId: string }) {
  const [view, setView] = useState<SiteRegistrationView | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [extras, setExtras] = useState(false);
  const { confirm, dialog } = useDialogs();

  const load = useCallback(async () => {
    try {
      setView(await api.getSiteRegistration(projectId));
      setUnavailable(null);
    } catch (err) {
      setUnavailable(err instanceof Error ? err.message : 'Search engine registration is not available');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(service: WebmasterService, name: string, on: boolean): Promise<void> {
    if (!view) return;
    if (!on) {
      const ok = await confirm({
        title: `Switch ${name} off`,
        message: `Remove ${view.siteUrl ?? 'this site'} from the platform’s ${name} account, if it is registered there? Its tag leaves the site with the next deploy.`,
        confirmLabel: 'Switch off',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.setSiteRegistration(projectId, { [service]: on });
      setView(res.view);
      // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
      const removal = res.removed[service];
      if (removal && !removal.ok) setError(removal.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the search engine');
    } finally {
      setBusy(false);
    }
  }

  const reason = (service: WebmasterService): string | undefined => {
    if (!view) return undefined;
    // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
    const entry = view[service];
    if (!entry.configured && !entry.enabled) return `An instance admin adds the platform’s ${service === 'google' ? 'Google service account' : 'Bing Webmaster account'} in System Settings → Integrations.`;
    if (!view.siteUrl && !entry.enabled) return 'Set an https Production URL first (the Site tile).';
    if (busy || verifying) return 'Working…';
    return undefined;
  };
  const anyOn = Boolean(view && ENGINES.some((e) => view[e.key].enabled));
  const line = view ? headline(view, error) : '';

  return (
    <>
      {dialog}
      <Tile title="Search engines" icon={<ScanSearch className="h-4 w-4" />} status={searchEnginesStatus(view)} span="c6" md={6} help={HELP}>
        <RowBlock n={4}>
          {/* Nothing until the first read answers: switches drawn before it would read "locked" to staff. */}
          {!view && !unavailable ? null : unavailable || !view ? (
            <Row label="Unavailable" value={unavailable ?? ''} />
          ) : (
            <>
              {ENGINES.map((e) => {
                const entry = view[e.key];
                const state = STATE[entry.status];
                return (
                  <SwitchRow
                    key={e.key}
                    label={e.name}
                    ariaLabel={`Register the site with ${e.name}`}
                    checked={entry.enabled}
                    onChange={(on) => void toggle(e.key, e.name, on)}
                    disabledReason={reason(e.key)}
                    value={state.word ? <span className={state.tone}>{state.word}</span> : undefined}
                  />
                );
              })}
              <Row tip={line} label={<span className={error || attention(view) ? 'text-rose-700 dark:text-rose-300' : ''}>{line}</span>} />
              {/* Two actions share the last row; a one-column grid makes each button fill its half. */}
              <span className="flex min-w-0 shrink-0 gap-1.5">
                <span className="grid min-w-0 flex-1">
                  <PartRow
                    label="Verify now"
                    ariaLabel="Verify the site with the switched-on search engines"
                    onClick={() => setVerifying(true)}
                    disabled={!view.siteUrl || !anyOn || busy || verifying}
                  />
                </span>
                <span className="grid min-w-0 flex-1">
                  <PartRow label="Sitemap & owners" ariaLabel="Sitemap and Search Console owners" onClick={() => setExtras(true)} disabled={!anyOn || busy || verifying} />
                </span>
              </span>
            </>
          )}
        </RowBlock>
      </Tile>
      {extras && view && (
        <SitemapOwnersModal
          projectId={projectId}
          view={view}
          onChange={setView}
          onClose={() => {
            setExtras(false);
            void load();
          }}
        />
      )}
      {verifying && view && (
        <SearchEngineVerify
          projectId={projectId}
          view={view}
          onClose={() => {
            setVerifying(false);
            void load();
          }}
        />
      )}
    </>
  );
}
