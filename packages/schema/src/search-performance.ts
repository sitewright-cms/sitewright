import type { WebmasterService } from './webmaster.js';

/**
 * SEARCH PERFORMANCE — how a project's site does in Google and Bing search: clicks, impressions (how often it was
 * shown), click-through rate and average position, per day and for the top queries and pages. Read from the
 * platform's own Search Console and Bing Webmaster accounts once the site is verified there (the Search engines
 * tile), so the client needs no account of their own. Anyone who can read the project can see it.
 */

/** The periods offered, in days, ending today. */
export const SEARCH_PERFORMANCE_PERIODS = [7, 28, 90] as const;
export type SearchPerformancePeriod = (typeof SEARCH_PERFORMANCE_PERIODS)[number];

/** How many queries and pages are listed. */
export const SEARCH_PERFORMANCE_TOP = 25;

/** One set of numbers: a whole period, one day, or one query or page in it. */
export interface SearchPerformanceFigures {
  clicks: number;
  impressions: number;
  /** clicks / impressions, 0..1; null with no impressions. */
  ctr: number | null;
  /** Average position in the results (1 = first); null when the search engine gives none. */
  position: number | null;
}

export interface SearchPerformanceDay {
  /** YYYY-MM-DD. */
  date: string;
  clicks: number;
  impressions: number;
}

export interface SearchPerformanceRow extends SearchPerformanceFigures {
  /** The search query, or the page's URL. */
  key: string;
}

/** Which search engines a project's site has data at: switched on and verified for its current Production URL. */
export interface SearchPerformanceAvailability {
  services: WebmasterService[];
}

export interface SearchPerformanceView {
  service: WebmasterService;
  /** The registered address the numbers are for. */
  siteUrl: string;
  /** The period shown, inclusive; and the one before it, for the change. */
  period: { days: SearchPerformancePeriod; start: string; end: string };
  totals: SearchPerformanceFigures;
  /** The same numbers for the period before; null when the search engine keeps no data that old. */
  previous: SearchPerformanceFigures | null;
  daily: SearchPerformanceDay[];
  queries: SearchPerformanceRow[];
  pages: SearchPerformanceRow[];
  /** When the platform asked the search engine; answers are kept for a while. */
  fetchedAt: string;
}
