import { useEffect, useState } from 'react';
import type { ProjectRankings, WebmasterService } from '@sitewright/schema';
import { api } from '../api';

/** Fired when something may have changed whether a project's built-in statistics are on. */
const STATISTICS_CHANGED = 'sw:statistics-changed';

/** Tell the project chrome to re-check a project's statistics (after a Website Settings save). */
export function notifyStatisticsChanged(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STATISTICS_CHANGED, { detail: { projectId } }));
}

/**
 * Whether a project's built-in statistics are switched on, as saved; null when it could not be read. ★ Not folded into
 * "off": a client is shown the visits only on a real `true`, but staff must not be told to switch on what is on.
 */
export async function fetchStatisticsEnabled(projectId: string): Promise<boolean | null> {
  return Promise.resolve()
    .then(() => api.getSettings(projectId))
    .then((r) => r.item.website?.statistics?.enabled === true)
    .catch(() => null);
}

/**
 * Search rankings are SET UP and ENABLED: a rank-tracking provider with credentials in System Settings (`configured`),
 * and tracking set up for this project with at least one keyword. What a client needs to be shown the view.
 */
export const rankingsLive = (r: Pick<ProjectRankings, 'configured' | 'tracking' | 'keywords'> | null | undefined): boolean =>
  Boolean(r && r.configured === true && r.tracking !== null && r.keywords.length > 0);

/** Whether search rankings are live for the project ({@link rankingsLive}); null when it could not be read. Asked for today only, so the answer carries no history. */
export async function fetchRankingsTracked(projectId: string): Promise<boolean | null> {
  const today = new Date().toISOString().slice(0, 10);
  return Promise.resolve()
    .then(() => api.getRankings(projectId, { from: today, to: today }))
    .then(rankingsLive)
    .catch(() => null);
}

/**
 * The search engines that have numbers for the project's site — the platform has its account (System Settings), and it
 * is switched on and verified in the Search engines tile; the server answers only with those. Null when it could not be
 * read.
 */
export async function fetchSearchAvailable(projectId: string): Promise<WebmasterService[] | null> {
  return Promise.resolve()
    .then(() => api.getSearchPerformanceAvailability(projectId))
    .then((r) => r.services)
    .catch(() => null);
}

/**
 * What the project's Statistics tab has: the ONE answer the tab strip (App) and the tab's views both go by.
 *
 * Each is undefined until its first answer, null when it could not be read (and never has been), else the last answer:
 * a re-check that cannot read keeps it, so a passing failure never flips a view or hides the tab. Each is asked on its
 * own — a slow read holds up only its own view.
 *   - `statistics`: the built-in statistics are switched on (they need no setup in System Settings);
 *   - `rankings`: search rankings are set up AND enabled ({@link rankingsLive});
 *   - `search`: the search engines with numbers for the site (set up, switched on and verified).
 * A client sees a view only on a positive answer; agency staff see every view, with a guide where one is not live.
 */
export interface StatisticsAccess {
  statistics: boolean | null | undefined;
  rankings: boolean | null | undefined;
  search: WebmasterService[] | null | undefined;
}

export const NO_STATISTICS_ACCESS: StatisticsAccess = { statistics: undefined, rankings: undefined, search: undefined };

/** A view a client is shown: only on a positive answer. */
export const clientSees = (access: StatisticsAccess): { visits: boolean; rankings: boolean; search: boolean } => ({
  visits: access.statistics === true,
  rankings: access.rankings === true,
  search: (access.search?.length ?? 0) > 0,
});

type Feature = keyof StatisticsAccess;

/**
 * {@link fetchStatisticsEnabled}, {@link fetchRankingsTracked} and {@link fetchSearchAvailable}, kept current: re-checked
 * when the project changes, when a settings save announces it ({@link notifyStatisticsChanged}), and when the window
 * regains focus (an agent or another tab may have changed it).
 */
export function useStatisticsAccess(projectId: string | null): StatisticsAccess {
  const [access, setAccess] = useState<StatisticsAccess>(NO_STATISTICS_ACCESS);
  useEffect(() => {
    // A different project starts from "nothing" — never show one project's tab on another.
    setAccess(NO_STATISTICS_ACCESS);
    if (!projectId) return;
    let live = true;
    // Newest read wins, per feature: an older answer that arrives late is dropped.
    const seq: Record<Feature, number> = { statistics: 0, rankings: 0, search: 0 };
    const ask = <K extends Feature>(feature: K, read: () => Promise<StatisticsAccess[K]>): void => {
      // eslint-disable-next-line security/detect-object-injection -- feature is a Feature literal
      const mine = ++seq[feature];
      void read().then((answer) => {
        // eslint-disable-next-line security/detect-object-injection -- feature is a Feature literal
        if (!live || mine !== seq[feature]) return;
        // ★ Unreadable keeps the last answer; only a first read that fails is "could not be read".
        // eslint-disable-next-line security/detect-object-injection -- feature is a Feature literal
        setAccess((prev) => ({ ...prev, [feature]: answer ?? (prev[feature] === undefined ? null : prev[feature]) }));
      });
    };
    const check = (): void => {
      ask('statistics', () => fetchStatisticsEnabled(projectId));
      ask('rankings', () => fetchRankingsTracked(projectId));
      ask('search', () => fetchSearchAvailable(projectId));
    };
    check();
    const onChanged = (e: Event): void => {
      const id = (e as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!id || id === projectId) check();
    };
    window.addEventListener(STATISTICS_CHANGED, onChanged);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener(STATISTICS_CHANGED, onChanged);
      window.removeEventListener('focus', check);
    };
  }, [projectId]);
  return access;
}
