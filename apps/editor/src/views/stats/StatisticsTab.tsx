import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import type { ProjectRankings } from '@sitewright/schema';
import { api, type Project } from '../../api';
import { accentChip, glassCard } from '../../theme';
import { Tabs } from '../ui/Tabs';
import { RankingsView } from './RankingsView';
import { StatsView } from './StatsView';

type View = 'visits' | 'rankings';

/**
 * The project's STATISTICS tab: the visit counter, and — when the agency tracks keywords for the site, or the
 * viewer is agency staff who could — the search rankings beside it.
 */
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
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
    };
  }, [project.id]);

  const showRankings = Boolean(rankings && (rankings.canManage || rankings.tracking));
  // Without the visit counter there is nothing to switch between: the rankings are the whole tab.
  const visits = visitsAvailable && (!showRankings || view === 'visits');

  // ★ One stable shape: the tab strip APPEARS above an unmoved Visits view when the read answers, so the counter
  // (its range, its filters) is not torn down and fetched again because a second tab became available.
  return (
    <div className="flex flex-col gap-3">
      {showRankings && visitsAvailable && (
        <div className="flex justify-center">
          <Tabs<View>
            ariaLabel="Statistics"
            variant="prominent"
            active={view}
            onSelect={setView}
            tabs={[
              { id: 'visits', label: 'Visits', icon: <BarChart3 className="h-5 w-5" aria-hidden /> },
              { id: 'rankings', label: 'Search rankings', icon: <TrendingUp className="h-5 w-5" aria-hidden /> },
            ]}
          />
        </div>
      )}
      {visits ? (
        <StatsView project={project} onOpenSettings={onOpenSettings} />
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
