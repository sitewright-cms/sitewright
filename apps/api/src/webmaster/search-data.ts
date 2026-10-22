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
 * Days are Pacific (both search engines count them that way).
 *
 * ★ Both search engines report a day or two late. A period that ended "today" would add up fewer reported days than
 * the full period before it, and read as a drop that is not there. So a period ENDS on the newest day the search
 * engine has reported (looking back at most {@link MAX_LAG_DAYS}), and the period before is exactly as long and added
 * up the same way.
 */

export interface SearchPeriod {
  days: SearchPerformancePeriod;
  start: string;
  end: string;
  previous: { start: string; end: string };
}

/** What one search engine says about one period, in the shape every view shows. */
export interface SearchPerformanceData {
  /** The days actually shown: the period moved back to the newest reported day. */
  period: { start: string; end: string };
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

/** The last `days` days up to `end`, and as many days before them. */
function periodEnding(days: SearchPerformancePeriod, end: string): SearchPeriod {
  const start = addDays(end, -(days - 1));
  return { days, start, end, previous: { start: addDays(start, -days), end: addDays(start, -1) } };
}

/** The last `days` days up to today (Pacific), and as many days before them. */
export function searchPeriod(days: SearchPerformancePeriod, now: Date): SearchPeriod {
  return periodEnding(days, pacificDay(now));
}

/** How far back a period's end moves to the newest reported day: a quiet site's empty days stay empty days. */
export const MAX_LAG_DAYS = 3;

/** Where a period is expected to end before anything is known about the site: Google's newest day is most often yesterday. */
export const DEFAULT_LAG_DAYS = 1;

/** How many days `end` lies before `day` (both YYYY-MM-DD). */
export const daysBefore = (day: string, end: string): number => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / DAY_MS);

/** `p` moved back to end on the newest day in `reported` (at most {@link MAX_LAG_DAYS} back). */
export function reportedPeriod(p: SearchPeriod, reported: Iterable<string>): SearchPeriod {
  const floor = addDays(p.end, -MAX_LAG_DAYS);
  let newest = floor;
  for (const d of reported) if (d <= p.end && d > newest) newest = d;
  return newest === p.end ? p : periodEnding(p.days, newest);
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

/** One day's numbers, with the impression-weighted position sum where the search engine gives a position. */
interface DayFigures {
  clicks: number;
  impressions: number;
  positionSum: number;
  positionWeight: number;
}

/** One value per day of the period (a day the search engine did not report is a zero); none when it reported none. */
function fillDays(byDay: ReadonlyMap<string, DayFigures>, p: SearchPeriod): SearchPerformanceDay[] {
  if (![...byDay.keys()].some((d) => d >= p.start && d <= p.end)) return [];
  const out: SearchPerformanceDay[] = [];
  for (let day = p.start; day <= p.end; day = addDays(day, 1)) {
    const v = byDay.get(day);
    out.push({ date: day, clicks: v?.clicks ?? 0, impressions: v?.impressions ?? 0 });
  }
  return out;
}

/** The days from `from` to `to`, added up. */
function sumDays(byDay: ReadonlyMap<string, DayFigures>, from: string, to: string): SearchPerformanceFigures {
  let clicks = 0;
  let impressions = 0;
  let positionSum = 0;
  let positionWeight = 0;
  for (const [day, v] of byDay) {
    if (day < from || day > to) continue;
    clicks += v.clicks;
    impressions += v.impressions;
    positionSum += v.positionSum;
    positionWeight += v.positionWeight;
  }
  return figures(clicks, impressions, positionSum, positionWeight);
}

/** The busiest first: clicks, then impressions, then the key, so the order is stable. */
const byClicks = (a: SearchPerformanceRow, b: SearchPerformanceRow): number => b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key);

/** The rows Google answers one Search Analytics query with, per query asked (see `googleSearchAnalytics`). */
export type GoogleAsk = (queries: readonly GoogleSearchQuery[]) => Promise<GoogleSearchRow[][]>;

/**
 * Google's numbers for one period. The days — this period's and the one before, with room for Google's delay — say
 * the newest reported day, and the top searches and pages are for the period ending on it. Each round to Google is
 * about a second (measured), so the top searches and pages are asked WITH the days, for the period ending on
 * `expectedEnd` (where this site's last answer ended); only when the days say otherwise is there a second round.
 */
export async function googleReport(ask: GoogleAsk, p: SearchPeriod, expectedEnd: string = addDays(p.end, -DEFAULT_LAG_DAYS)): Promise<SearchPerformanceData> {
  const top = (w: { start: string; end: string }): GoogleSearchQuery[] => [
    { startDate: w.start, endDate: w.end, dimensions: ['query'], rowLimit: SEARCH_PERFORMANCE_TOP },
    { startDate: w.start, endDate: w.end, dimensions: ['page'], rowLimit: SEARCH_PERFORMANCE_TOP },
  ];
  // ONE round when the period ends where it is expected to: the days, and the top searches and pages over the period
  // ending on the expected day, asked together. The searches and pages wait for the days only when the guess was off.
  const floor = addDays(p.end, -MAX_LAG_DAYS);
  const guess = periodEnding(p.days, expectedEnd < floor ? floor : expectedEnd > p.end ? p.end : expectedEnd);
  const [daily = [], guessedQueries = [], guessedPages = []] = await ask([
    { startDate: addDays(p.previous.start, -MAX_LAG_DAYS), endDate: p.end, dimensions: ['date'], rowLimit: 500 },
    ...top(guess),
  ]);
  const byDay = new Map<string, DayFigures>();
  for (const r of daily) {
    const day = r.keys[0];
    if (day) byDay.set(day, { clicks: r.clicks, impressions: r.impressions, positionSum: r.position * r.impressions, positionWeight: r.impressions });
  }
  const shown = reportedPeriod(p, byDay.keys());
  const [queries = [], pages = []] = shown.end === guess.end ? [guessedQueries, guessedPages] : await ask(top(shown));
  const row = (r: GoogleSearchRow): SearchPerformanceRow => ({
    key: r.keys[0] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.impressions > 0 ? r.ctr : null,
    position: r.impressions > 0 ? r.position : null,
  });
  return {
    period: { start: shown.start, end: shown.end },
    totals: sumDays(byDay, shown.start, shown.end),
    previous: sumDays(byDay, shown.previous.start, shown.previous.end),
    daily: fillDays(byDay, shown),
    queries: queries.map(row).filter((r) => r.key).sort(byClicks).slice(0, SEARCH_PERFORMANCE_TOP),
    pages: pages.map(row).filter((r) => r.key).sort(byClicks).slice(0, SEARCH_PERFORMANCE_TOP),
  };
}

/**
 * Bing's per-query (or per-page) stats over a period, added up per key. Bing reports these per WEEK, dated by one day
 * of it: a week dated up to six days before the period still overlaps it, and counts.
 */
function bingTop(stats: readonly BingStat[], from: string, to: string): SearchPerformanceRow[] {
  const keys = new Map<string, { clicks: number; impressions: number; positionSum: number; weight: number }>();
  const earliest = addDays(from, -6);
  for (const s of stats) {
    if (!s.key || s.date < earliest || s.date > to) continue;
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
 * Bing's history, shaped for one period (ending on Bing's newest reported day, as Google's). Bing's site traffic has
 * no position, so the totals have none. The period before is null when Bing keeps no traffic that old (a site added
 * recently).
 */
export function bingData(stats: { daily: readonly BingStat[]; queries: readonly BingStat[]; pages: readonly BingStat[] }, p: SearchPeriod): SearchPerformanceData {
  const byDay = new Map<string, DayFigures>();
  for (const s of stats.daily) {
    const v = byDay.get(s.date) ?? { clicks: 0, impressions: 0, positionSum: 0, positionWeight: 0 };
    byDay.set(s.date, { ...v, clicks: v.clicks + s.clicks, impressions: v.impressions + s.impressions });
  }
  const shown = reportedPeriod(p, byDay.keys());
  const oldest = [...byDay.keys()].sort()[0];
  return {
    period: { start: shown.start, end: shown.end },
    totals: sumDays(byDay, shown.start, shown.end),
    previous: oldest !== undefined && oldest <= shown.previous.start ? sumDays(byDay, shown.previous.start, shown.previous.end) : null,
    daily: fillDays(byDay, shown),
    queries: bingTop(stats.queries, shown.start, shown.end),
    pages: bingTop(stats.pages, shown.start, shown.end),
  };
}
