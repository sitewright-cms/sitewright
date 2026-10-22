import {
  SEARCH_PERFORMANCE_TOP,
  type SearchPerformanceDay,
  type SearchPerformanceFigures,
  type SearchPerformancePeriod,
  type SearchPerformanceRow,
} from '@sitewright/schema';
import type { BingStat } from './bing.js';
import type { GoogleSearchQuery, GoogleSearchRow } from './google.js';

/**
 * SEARCH DATA, shaped: the period a view covers, and Google's and Bing's answers turned into the same numbers —
 * totals, the period before, a value per day, and the top queries and pages. Pure: no requests here.
 *
 * Days are Pacific (both search engines count them that way). A day neither search engine reported is a zero, but
 * only up to the newest day that has data: Google reports with a delay of a day or two, and an empty tail would read
 * as a drop.
 */

export interface SearchPeriod {
  days: SearchPerformancePeriod;
  start: string;
  end: string;
  previous: { start: string; end: string };
}

/** What one search engine says about one period, in the shape every view shows. */
export interface SearchPerformanceData {
  totals: SearchPerformanceFigures;
  previous: SearchPerformanceFigures | null;
  daily: SearchPerformanceDay[];
  queries: SearchPerformanceRow[];
  pages: SearchPerformanceRow[];
}

const DAY_MS = 86_400_000;
const PACIFIC = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The calendar day `at` falls on in Pacific time, YYYY-MM-DD. */
export const pacificDay = (at: Date): string => PACIFIC.format(at);

/** `day` moved by `n` days. */
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The last `days` days up to today (Pacific), and the as many days before them. */
export function searchPeriod(days: SearchPerformancePeriod, now: Date): SearchPeriod {
  const end = pacificDay(now);
  const start = addDays(end, -(days - 1));
  return { days, start, end, previous: { start: addDays(start, -days), end: addDays(start, -1) } };
}

/** Clicks, impressions and an impression-weighted position sum, as the figures shown. */
function figures(clicks: number, impressions: number, positionSum: number, positionWeight: number): SearchPerformanceFigures {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: positionWeight > 0 ? positionSum / positionWeight : null,
  };
}

const EMPTY: SearchPerformanceFigures = { clicks: 0, impressions: 0, ctr: null, position: null };

/** One value per day from the period's first day to the newest day that has data. */
function fillDays(byDay: ReadonlyMap<string, { clicks: number; impressions: number }>, p: SearchPeriod): SearchPerformanceDay[] {
  const last = [...byDay.keys()].filter((d) => d >= p.start && d <= p.end).sort().at(-1);
  if (!last) return [];
  const out: SearchPerformanceDay[] = [];
  for (let day = p.start; day <= last; day = addDays(day, 1)) {
    const v = byDay.get(day);
    out.push({ date: day, clicks: v?.clicks ?? 0, impressions: v?.impressions ?? 0 });
  }
  return out;
}

/** The busiest first: clicks, then impressions, then the key, so the order is stable. */
const byClicks = (a: SearchPerformanceRow, b: SearchPerformanceRow): number => b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key);

/** What Google is asked for one period, in this order: per day, top queries, top pages, and the period before. */
export function googleQueries(p: SearchPeriod): GoogleSearchQuery[] {
  return [
    { startDate: p.start, endDate: p.end, dimensions: ['date'], rowLimit: 500 },
    { startDate: p.start, endDate: p.end, dimensions: ['query'], rowLimit: SEARCH_PERFORMANCE_TOP },
    { startDate: p.start, endDate: p.end, dimensions: ['page'], rowLimit: SEARCH_PERFORMANCE_TOP },
    { startDate: p.previous.start, endDate: p.previous.end, rowLimit: 1 },
  ];
}

/** Google's answers to {@link googleQueries}, shaped. */
export function googleData([daily = [], queries = [], pages = [], previous = []]: readonly GoogleSearchRow[][], p: SearchPeriod): SearchPerformanceData {
  const byDay = new Map<string, { clicks: number; impressions: number }>();
  let clicks = 0;
  let impressions = 0;
  let positionSum = 0;
  for (const r of daily) {
    const day = r.keys[0];
    if (!day) continue;
    byDay.set(day, { clicks: r.clicks, impressions: r.impressions });
    clicks += r.clicks;
    impressions += r.impressions;
    positionSum += r.position * r.impressions;
  }
  const row = (r: GoogleSearchRow): SearchPerformanceRow => ({
    key: r.keys[0] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.impressions > 0 ? r.ctr : null,
    position: r.impressions > 0 ? r.position : null,
  });
  const before = previous[0];
  return {
    totals: figures(clicks, impressions, positionSum, impressions),
    previous: before ? figures(before.clicks, before.impressions, before.position * before.impressions, before.impressions) : EMPTY,
    daily: fillDays(byDay, p),
    queries: queries.map(row).filter((r) => r.key).sort(byClicks).slice(0, SEARCH_PERFORMANCE_TOP),
    pages: pages.map(row).filter((r) => r.key).sort(byClicks).slice(0, SEARCH_PERFORMANCE_TOP),
  };
}

/** Bing's per-query (or per-page) stats over a period, added up per key. */
function bingTop(stats: readonly BingStat[], from: string, to: string): SearchPerformanceRow[] {
  const keys = new Map<string, { clicks: number; impressions: number; positionSum: number; weight: number }>();
  for (const s of stats) {
    if (!s.key || s.date < from || s.date > to) continue;
    const k = keys.get(s.key) ?? { clicks: 0, impressions: 0, positionSum: 0, weight: 0 };
    k.clicks += s.clicks;
    k.impressions += s.impressions;
    if (s.position !== null && s.impressions > 0) {
      k.positionSum += s.position * s.impressions;
      k.weight += s.impressions;
    }
    keys.set(s.key, k);
  }
  return [...keys]
    .map(([key, k]) => ({ key, ...figures(k.clicks, k.impressions, k.positionSum, k.weight) }))
    .sort(byClicks)
    .slice(0, SEARCH_PERFORMANCE_TOP);
}

/**
 * Bing's history, shaped for one period. Bing's site traffic has no position, so the totals have none. The period
 * before is null when Bing keeps no traffic that old (a site added recently).
 */
export function bingData(stats: { daily: readonly BingStat[]; queries: readonly BingStat[]; pages: readonly BingStat[] }, p: SearchPeriod): SearchPerformanceData {
  const sum = (from: string, to: string) => {
    let clicks = 0;
    let impressions = 0;
    for (const s of stats.daily) {
      if (s.date < from || s.date > to) continue;
      clicks += s.clicks;
      impressions += s.impressions;
    }
    return figures(clicks, impressions, 0, 0);
  };
  const byDay = new Map<string, { clicks: number; impressions: number }>();
  for (const s of stats.daily) {
    const v = byDay.get(s.date) ?? { clicks: 0, impressions: 0 };
    byDay.set(s.date, { clicks: v.clicks + s.clicks, impressions: v.impressions + s.impressions });
  }
  const oldest = stats.daily.map((s) => s.date).sort()[0];
  return {
    totals: sum(p.start, p.end),
    previous: oldest !== undefined && oldest <= p.previous.start ? sum(p.previous.start, p.previous.end) : null,
    daily: fillDays(byDay, p),
    queries: bingTop(stats.queries, p.start, p.end),
    pages: bingTop(stats.pages, p.start, p.end),
  };
}
