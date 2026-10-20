import { useEffect, useState } from 'react';
import { api } from '../api';

/** Fired when something may have changed whether a project's built-in statistics are on. */
const STATISTICS_CHANGED = 'sw:statistics-changed';

/** Tell the project chrome to re-check a project's statistics (after a Website Settings save). */
export function notifyStatisticsChanged(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STATISTICS_CHANGED, { detail: { projectId } }));
}

/** Whether a project's built-in statistics are switched on, as saved. A failed read is "off". */
export async function fetchStatisticsEnabled(projectId: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => api.getSettings(projectId))
    .then((r) => r.item.website?.statistics?.enabled === true)
    .catch(() => false);
}

/**
 * Whether the agency tracks search rankings for the project (a setup and at least one keyword). Asked for
 * today only, so the answer carries no history. A failed read is "no".
 */
export async function fetchRankingsTracked(projectId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  return Promise.resolve()
    .then(() => api.getRankings(projectId, { from: today, to: today }))
    .then((r) => r.tracking !== null && r.keywords.length > 0)
    .catch(() => false);
}

/** What the Statistics tab has for a CLIENT: the visit counter (statistics on), and/or the search rankings. */
export interface StatisticsAccess {
  statistics: boolean;
  rankings: boolean;
}

/**
 * {@link fetchStatisticsEnabled} and {@link fetchRankingsTracked}, kept current: re-checked when the project
 * changes, when a settings save announces it ({@link notifyStatisticsChanged}), and when the window regains
 * focus (an agent or another tab may have changed it). Decides what a CLIENT sees — agency staff see it all.
 */
export function useStatisticsAccess(projectId: string | null): StatisticsAccess {
  const [access, setAccess] = useState<StatisticsAccess>({ statistics: false, rankings: false });
  useEffect(() => {
    // A different project starts from "nothing" — never show one project's tab on another.
    setAccess({ statistics: false, rankings: false });
    if (!projectId) return;
    let live = true;
    const check = (): void => {
      void Promise.all([fetchStatisticsEnabled(projectId), fetchRankingsTracked(projectId)]).then(([statistics, rankings]) => {
        if (live) setAccess({ statistics, rankings });
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
