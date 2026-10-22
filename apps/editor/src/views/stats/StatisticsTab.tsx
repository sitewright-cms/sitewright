import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Search, TrendingUp } from 'lucide-react';
import { WEBMASTER_SERVICES, type ProjectRankings, type SiteRegistrationView, type WebmasterService } from '@sitewright/schema';
import { api, type Project } from '../../api';
import type { OpenSystemSettings, OpenWebsiteSettings } from '../../lib/settings-links';
import { rankingsLive } from '../../lib/statistics-enabled';
import { accentChip, glassCard } from '../../theme';
import { Tabs } from '../ui/Tabs';
import { RankingsGuide, SearchGuide, VisitsGuide } from './FeatureGuides';
import { RankingsView } from './RankingsView';
import { SEARCH_PERFORMANCE_DEFAULT_DAYS, SearchPerformanceView } from './SearchPerformanceView';
import { StatsView } from './StatsView';

type View = 'visits' | 'rankings' | 'search';

/**
 * The project's STATISTICS tab: the visit counter, the search rankings and the search performance.
 *
 * A client sees each view only while its feature is SET UP (System Settings) and ENABLED (this project): the built-in
 * statistics switched on (they need no setup); a rank-tracking provider plus a tracked domain with a keyword; a search
 * engine account the site is switched on and verified with. Agency staff always see all three, and a view that is not
 * live yet holds a guide to setting it up instead (FeatureGuides) — for rankings above the setup that adds keywords.
 */
const TABS: Record<View, { id: View; label: string; icon: ReactNode }> = {
  visits: { id: 'visits', label: 'Visits', icon: <BarChart3 className="h-5 w-5" aria-hidden /> },
  rankings: { id: 'rankings', label: 'Search rankings', icon: <TrendingUp className="h-5 w-5" aria-hidden /> },
  search: { id: 'search', label: 'Search performance', icon: <Search className="h-5 w-5" aria-hidden /> },
};

export function StatisticsTab({
  project,
  onOpenSettings,
  visitsAvailable = true,
  visitsEnabled,
  isStaff = false,
  onOpenSystemSettings,
}: {
  project: Project;
  /** Opens Website Settings, at a tile when given. */
  onOpenSettings?: OpenWebsiteSettings;
  /** Whether the visit counter is shown. False for a client while the built-in statistics are off. */
  visitsAvailable?: boolean;
  /**
   * Whether the built-in statistics are switched on. Staff see how to switch them on while off; nothing while it is not
   * known yet (undefined); the counter, which reads the setting for itself, when it could not be read (null).
   */
  visitsEnabled?: boolean | null;
  /** Agency staff (an admin or a developer): every view, with a setup guide where one is not live. */
  isStaff?: boolean;
  /** Opens System Settings — an instance admin's alone; a developer's guide says who does it instead. */
  onOpenSystemSettings?: OpenSystemSettings;
}) {
  // Staff always have the visits, first.
  const [view, setView] = useState<View>(isStaff || visitsAvailable ? 'visits' : 'rankings');
  // Which search engines have numbers for the site: their own view when there are any. Undefined until it answers, null
  // when it could not be read (a client then has no view; staff fall back to the registration below).
  const [search, setSearch] = useState<WebmasterService[] | null | undefined>(undefined);
  // Staff only: the site's registration with the platform's search engine accounts — whether the platform HAS an
  // account (System Settings), and where each one stands. Undefined until it answers, null when it could not be read.
  const [registration, setRegistration] = useState<SiteRegistrationView | null | undefined>(undefined);
  // One read decides whether the rankings are worth a tab; the view reuses it as its first answer and keeps it
  // current, so coming back to the tab starts from the newest list.
  const [rankings, setRankings] = useState<ProjectRankings | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const probe = (attempt: number): void => {
      void api
        .getRankings(project.id)
        .then((r) => {
          if (live) setRankings(r);
        })
        .catch(() => {
          // One passing failure must not hide the tab for good — staff set tracking up from it. Ask once more.
          if (live && attempt === 0) retry = setTimeout(() => probe(1), 15_000);
          else if (live) setRankings(null);
        });
    };
    probe(0);
    // A failed read means no search numbers: for a client the view is only ever an addition.
    void Promise.resolve()
      .then(() => api.getSearchPerformanceAvailability(project.id))
      .then((r) => {
        if (!live) return;
        setSearch(r.services);
        // Ask for the numbers Search performance opens on now, while the visits show: the search engines take a second
        // or two, and the server keeps the answer (and joins a read already under way), so the view finds it ready.
        const first = r.services[0];
        // Its own chain: nothing it does may reach the catch below, which would read as "no search engine".
        if (first) {
          void Promise.resolve()
            .then(() => api.getSearchPerformance(project.id, first, SEARCH_PERFORMANCE_DEFAULT_DAYS))
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (live) setSearch(null);
      });
    // ★ Unreadable is not "no account": the guide then says it could not be checked, and shows the setup anyway.
    if (isStaff) {
      void Promise.resolve()
        .then(() => api.getSiteRegistration(project.id))
        .then((r) => {
          if (live) setRegistration(r);
        })
        .catch(() => {
          if (live) setRegistration(null);
        });
    }
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
    };
  }, [project.id, isStaff]);

  // Without the visit counter, the rankings keep their place while they are read (as before there was a third view),
  // so a quicker search answer does not flick the tab to it and back.
  const showRankings = rankings === undefined ? !visitsAvailable : rankingsLive(rankings);
  // ★ Staff: all three from the first render, so the strip never grows or shrinks under them.
  const views: View[] = isStaff
    ? ['visits', 'rankings', 'search']
    : [...(visitsAvailable ? (['visits'] as const) : []), ...(showRankings ? (['rankings'] as const) : []), ...(search?.length ? (['search'] as const) : [])];
  // The chosen view while it is there; else the first one that is (visits, then rankings, then search).
  const shown: View = views.includes(view) ? view : (views[0] ?? 'rankings');
  // Staff, rankings not live: the guide sits above the setup (the setup is how keywords are added).
  const rankingsGuide = isStaff && rankings ? !rankingsLive(rankings) : false;
  const searchConfigured = registration ? registration.google.configured || registration.bing.configured : null;
  // ★ Staff, availability unreadable: the engines the registration says are verified, rather than "not verified yet"
  // beside a list that says verified. The view reports its own refusals.
  const searchServices: WebmasterService[] =
    search === null && registration
      ? // eslint-disable-next-line security/detect-object-injection -- s is a WEBMASTER_SERVICES literal
        WEBMASTER_SERVICES.filter((s) => registration[s].configured && registration[s].enabled && registration[s].status === 'verified')
      : (search ?? []);

  // ★ One stable shape: the tab strip APPEARS above an unmoved Visits view when the read answers, so the counter
  // (its range, its filters) is not torn down and fetched again because a second tab became available.
  return (
    <div className="flex flex-col gap-3">
      {views.length > 1 && (
        <div className="flex justify-center">
          <Tabs<View>
            ariaLabel="Statistics"
            variant="prominent"
            active={shown}
            onSelect={setView}
            tabs={views.map((id) => TABS[id])}
          />
        </div>
      )}
      {shown === 'visits' ? (
        // Staff: nothing until it is known whether statistics are on, so neither the guide nor the counter flashes first.
        isStaff && visitsEnabled === false ? (
          <VisitsGuide onOpenSettings={onOpenSettings} />
        ) : isStaff && visitsEnabled === undefined ? null : (
          <StatsView project={project} onOpenSettings={onOpenSettings} />
        )
      ) : shown === 'search' ? (
        !isStaff || searchServices.length ? (
          <SearchPerformanceView projectId={project.id} services={searchServices} />
        ) : search === undefined || registration === undefined ? null : (
          <SearchGuide configured={searchConfigured} registration={registration} onOpenSystemSettings={onOpenSystemSettings} onOpenSettings={onOpenSettings} />
        )
      ) : (
        <section className={`${glassCard} overflow-hidden`} aria-labelledby="rankings-heading">
          <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 bg-slate-100/70 px-5 py-3 dark:border-slate-700/70 dark:bg-white/10">
            <span className={accentChip} aria-hidden>
              <TrendingUp className="h-4 w-4" />
            </span>
            <h2 id="rankings-heading" className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Search rankings
            </h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">Where the site appears in Google for chosen keywords</span>
          </header>
          <div className="flex flex-col gap-4 p-5">
            {rankingsGuide && rankings && (
              <RankingsGuide configured={rankings.configured} tracked={rankings.tracking !== null} onOpenSystemSettings={onOpenSystemSettings} />
            )}
            <RankingsView project={project} initial={rankings} onLoaded={setRankings} guided={rankingsGuide} />
          </div>
        </section>
      )}
    </div>
  );
}
