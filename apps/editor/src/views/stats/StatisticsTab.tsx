import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Search, TrendingUp } from 'lucide-react';
import type { ProjectRankings, WebmasterService } from '@sitewright/schema';
import { api, type Project } from '../../api';
import { accentChip, glassCard } from '../../theme';
import { Tabs } from '../ui/Tabs';
import { RankingsView } from './RankingsView';
import { SEARCH_PERFORMANCE_DEFAULT_DAYS, SearchPerformanceView } from './SearchPerformanceView';
import { StatsView } from './StatsView';

type View = 'visits' | 'rankings' | 'search';

/**
 * The project's STATISTICS tab: the visit counter; the search rankings when the agency tracks keywords for the site
 * (or the viewer is agency staff who could); and the search performance once a search engine verified the site.
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
}: {
  project: Project;
  onOpenSettings?: () => void;
  /** Whether the visit counter is shown. False for a client while the built-in statistics are off. */
  visitsAvailable?: boolean;
}) {
  const [view, setView] = useState<View>(visitsAvailable ? 'visits' : 'rankings');
  // Which search engines have numbers for the site: their own view when there are any.
  const [search, setSearch] = useState<WebmasterService[]>([]);
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
    // A failed read means no search numbers: the view is only ever an addition.
    void Promise.resolve()
      .then(() => api.getSearchPerformanceAvailability(project.id))
      .then((r) => {
        if (!live) return;
        setSearch(r.services);
        // Ask for the numbers Search performance opens on now, while the visits show: the search engines take a second
        // or two, and the server keeps the answer (and joins a read already under way), so the view finds it ready.
        const first = r.services[0];
        if (first) void api.getSearchPerformance(project.id, first, SEARCH_PERFORMANCE_DEFAULT_DAYS).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
    };
  }, [project.id]);

  // Without the visit counter, the rankings keep their place while they are read (as before there was a third view),
  // so a quicker search answer does not flick the tab to it and back.
  const showRankings = rankings === undefined ? !visitsAvailable : Boolean(rankings && (rankings.canManage || rankings.tracking));
  const views: View[] = [...(visitsAvailable ? (['visits'] as const) : []), ...(showRankings ? (['rankings'] as const) : []), ...(search.length ? (['search'] as const) : [])];
  // The chosen view while it is there; else the first one that is (visits, then rankings, then search).
  const shown: View = views.includes(view) ? view : (views[0] ?? 'rankings');

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
        <StatsView project={project} onOpenSettings={onOpenSettings} />
      ) : shown === 'search' ? (
        <SearchPerformanceView projectId={project.id} services={search} />
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
          <div className="p-5">
            <RankingsView project={project} initial={rankings} onLoaded={setRankings} />
          </div>
        </section>
      )}
    </div>
  );
}
