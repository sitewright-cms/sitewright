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
export function StatisticsTab({ project, onOpenSettings }: { project: Project; onOpenSettings?: () => void }) {
  const [view, setView] = useState<View>('visits');
  // One read decides whether the rankings are worth a tab; the view reuses it as its first answer.
  const [rankings, setRankings] = useState<ProjectRankings | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void api
      .getRankings(project.id)
      .then((r) => {
        if (live) setRankings(r);
      })
      .catch(() => {
        if (live) setRankings(null);
      });
    return () => {
      live = false;
    };
  }, [project.id]);

  const showRankings = Boolean(rankings && (rankings.canManage || rankings.tracking));
  if (!showRankings) return <StatsView project={project} onOpenSettings={onOpenSettings} />;

  return (
    <div className="flex flex-col gap-3">
      <Tabs<View>
        ariaLabel="Statistics"
        active={view}
        onSelect={setView}
        tabs={[
          { id: 'visits', label: 'Visits', icon: <BarChart3 className="h-4 w-4" aria-hidden /> },
          { id: 'rankings', label: 'Search rankings', icon: <TrendingUp className="h-4 w-4" aria-hidden /> },
        ]}
      />
      {view === 'visits' ? (
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
            <RankingsView project={project} initial={rankings} />
          </div>
        </section>
      )}
    </div>
  );
}
