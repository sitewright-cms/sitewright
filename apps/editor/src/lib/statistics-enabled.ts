import { useEffect, useState } from 'react';
import type { ProjectRankings } from '@sitewright/schema';
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

/** Whether search rankings are live for the project ({@link rankingsLive}). Asked for today only, so the answer carries no history. A failed read is "no". */
export async function fetchRankingsTracked(projectId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  return Promise.resolve()
    .then(() => api.getRankings(projectId, { from: today, to: today }))
    .then(rankingsLive)
    .catch(() => false);
}

/**
 * Whether a search engine has numbers for the project's site: the platform has its account (System Settings), and it is
 * switched on and verified in the Search engines tile — the server answers only with those. A failed read is "no".
 */
export async function fetchSearchAvailable(projectId: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => api.getSearchPerformanceAvailability(projectId))
    .then((r) => r.services.length > 0)
    .catch(() => false);
}

/**
 * What the Statistics tab has for a CLIENT — each view only once its feature is set up and enabled: the visit counter
 * (the built-in statistics need no setup, so: switched on), the search rankings, the search performance. `loaded` is
 * false until the first answer for the project, so staff are not shown "switched off" while it is being asked.
 * `statistics` is null while it could not be read: a later failed re-check keeps the last answer instead.
 */
export interface StatisticsAccess {
  loaded: boolean;
  statistics: boolean | null;
  rankings: boolean;
  search: boolean;
}

const NOTHING: StatisticsAccess = { loaded: false, statistics: false, rankings: false, search: false };

/**
 * {@link fetchStatisticsEnabled}, {@link fetchRankingsTracked} and {@link fetchSearchAvailable}, kept current: re-checked when the project
 * changes, when a settings save announces it ({@link notifyStatisticsChanged}), and when the window regains
 * focus (an agent or another tab may have changed it). Decides what a CLIENT sees — agency staff see it all.
 */
export function useStatisticsAccess(projectId: string | null): StatisticsAccess {
  const [access, setAccess] = useState<StatisticsAccess>(NOTHING);
  useEffect(() => {
    // A different project starts from "nothing" — never show one project's tab on another.
    setAccess(NOTHING);
    if (!projectId) return;
    let live = true;
    const check = (): void => {
      void Promise.all([fetchStatisticsEnabled(projectId), fetchRankingsTracked(projectId), fetchSearchAvailable(projectId)]).then(([statistics, rankings, search]) => {
        // A re-check that could not read the setting keeps the last answer: a passing failure must not flip the view.
        if (live) setAccess((prev) => ({ loaded: true, statistics: statistics ?? (prev.loaded ? prev.statistics : null), rankings, search }));
      });
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
