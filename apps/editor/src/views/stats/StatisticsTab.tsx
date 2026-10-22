import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Search, TrendingUp } from 'lucide-react';
import { WEBMASTER_SERVICES, type ProjectRankings, type SiteRegistrationView, type WebmasterService } from '@sitewright/schema';
import { api, type Project } from '../../api';
import type { OpenSystemSettings, OpenWebsiteSettings } from '../../lib/settings-links';
import { clientSees, rankingsLive, type StatisticsAccess } from '../../lib/statistics-enabled';
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

const ORDER: readonly View[] = ['visits', 'rankings', 'search'];

export function StatisticsTab({
  project,
  access,
  onOpenSettings,
  isStaff = false,
  onOpenSystemSettings,
}: {
  project: Project;
  /**
   * What the project has (App's useStatisticsAccess) — the ONE answer the tab strip goes by too, so the two never
   * disagree. A client sees exactly the views it says are live; staff take whether visits are on, and the search engines.
   */
  access: StatisticsAccess;
  /** Opens Website Settings, at a tile when given. */
  onOpenSettings?: OpenWebsiteSettings;
  /** Agency staff (an admin or a developer): every view, with a setup guide where one is not live. */
  isStaff?: boolean;
  /** Opens System Settings — an instance admin's alone; a developer's guide says who does it instead. */
  onOpenSystemSettings?: OpenSystemSettings;
}) {
  // The view picked in the strip; until then the first one there is.
  const [picked, setPicked] = useState<View | null>(null);
  // Staff only: the site's registration with the platform's search engine accounts — whether the platform HAS an
  // account (System Settings), and where each one stands. Undefined until it answers, null when it could not be read.
  const [registration, setRegistration] = useState<SiteRegistrationView | null | undefined>(undefined);
  // The rankings themselves (not whether a client sees them — `access` says that): the view's first answer, kept
  // current by it, and for staff what the setup guide goes by.
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
          // One passing failure must not leave staff without the guide for good. Ask once more.
          if (live && attempt === 0) retry = setTimeout(() => probe(1), 15_000);
          else if (live) setRankings(null);
        });
    };
    probe(0);
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

  // Ask for the numbers Search performance opens on now, while the visits show: the search engines take a second or
  // two, and the server keeps the answer (and joins a read already under way), so the view finds it ready.
  const firstEngine = access.search?.[0];
  useEffect(() => {
    if (!firstEngine) return;
    void Promise.resolve()
      .then(() => api.getSearchPerformance(project.id, firstEngine, SEARCH_PERFORMANCE_DEFAULT_DAYS))
      .catch(() => undefined);
  }, [project.id, firstEngine]);

  // A client: each view only on a positive answer (so never while its read has not answered).
  const sees = clientSees(access);
  // ★ Staff: all three from the first render, so the strip never grows or shrinks under them.
  // eslint-disable-next-line security/detect-object-injection -- v is a View literal
  const views: View[] = isStaff ? [...ORDER] : ORDER.filter((v) => sees[v]);
  // The picked view while it is there; else staff start on the visits, and a client on the first live one — ★ never one
  // that is not (with none, it shows nothing; App hides the tab). A slow read holds up nobody.
  const shown: View | null = picked && views.includes(picked) ? picked : isStaff ? 'visits' : (views[0] ?? null);
  // ★ A client's view stays where it is when another answers later (an earlier one in the order, say): what is on
  // screen is pinned as if picked, so a view never flicks away, and the counter is never torn down for a new tab.
  useEffect(() => {
    if (!isStaff && shown && shown !== picked) setPicked(shown);
  }, [isStaff, shown, picked]);
  // Staff, rankings not live: the guide sits above the setup (the setup is how keywords are added).
  const rankingsGuide = isStaff && rankings ? !rankingsLive(rankings) : false;
  const searchConfigured = registration ? registration.google.configured || registration.bing.configured : null;
  // ★ Staff, availability unreadable: the engines the registration says are verified, rather than "not verified yet"
  // beside a list that says verified. The view reports its own refusals.
  const searchServices: WebmasterService[] =
    access.search === null && registration
      ? // eslint-disable-next-line security/detect-object-injection -- s is a WEBMASTER_SERVICES literal
        WEBMASTER_SERVICES.filter((s) => registration[s].configured && registration[s].enabled && registration[s].status === 'verified')
      : (access.search ?? []);
  const visitsEnabled = access.statistics;

  // ★ One stable shape: the tab strip APPEARS above an unmoved Visits view when the read answers, so the counter
  // (its range, its filters) is not torn down and fetched again because a second tab became available.
  return (
    <div className="flex flex-col gap-3">
      {views.length > 1 && (
        <div className="flex justify-center">
          <Tabs<View>
            ariaLabel="Statistics"
            variant="prominent"
            active={shown ?? views[0]!}
            onSelect={setPicked}
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
        ) : access.search === undefined || registration === undefined ? null : (
          <SearchGuide configured={searchConfigured} registration={registration} onOpenSystemSettings={onOpenSystemSettings} onOpenSettings={onOpenSettings} />
        )
      ) : shown === 'rankings' ? (
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
      ) : null}
    </div>
  );
}
