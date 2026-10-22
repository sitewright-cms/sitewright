import type { SearchPerformanceAvailability, SearchPerformancePeriod, SearchPerformanceView, WebmasterService } from '@sitewright/schema';
import { addDays, daysBefore, searchPeriod, type SearchPerformanceData, type SearchPeriod } from './search-data.js';

/**
 * SEARCH PERFORMANCE — a project's search numbers from the platform's Google and Bing accounts, for the Statistics
 * tab. The search engines are asked on demand, and an answer is kept for an hour: their data moves once a day at
 * most, and every viewer of a project would otherwise ask again. Two requests for the same answer while it is being
 * fetched share one round of requests. A refusal is remembered for a couple of minutes too: a search engine that is
 * down or limiting requests is not asked again by every viewer and every period switch meanwhile.
 */

/** One search engine a project's site has data at (switched on and verified there), and what reads it. */
export interface SearchDataSource {
  service: WebmasterService;
  siteUrl: string;
  /** The account that verified it: an answer is never reused for another account. */
  accountId: string;
  /** `expectedEnd`: the day the period most likely ends on (Google asks in one round when it does). */
  read: (period: SearchPeriod, expectedEnd?: string) => Promise<SearchPerformanceData>;
}

export interface SearchPerformanceDeps {
  sources: (projectId: string, rawSiteUrl: string | null | undefined) => Promise<SearchDataSource[]>;
  now?: () => Date;
  ttlMs?: number;
  maxEntries?: number;
}

const TTL_MS = 60 * 60_000;
const FAILURE_TTL_MS = 2 * 60_000;
/** About 10 KB each: a bounded few MB however many projects are looked at. */
const MAX_ENTRIES = 300;

export class SearchPerformance {
  private readonly answers = new Map<string, { at: number; view: SearchPerformanceView }>();
  private readonly running = new Map<string, Promise<SearchPerformanceView>>();
  private readonly failures = new Map<string, { at: number; error: unknown }>();
  /** How many days each site's search engine reports late, as its last answer showed: where the next period ends. */
  private readonly lags = new Map<string, number>();

  constructor(private readonly deps: SearchPerformanceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Which search engines have data for the site. Asks no search engine. */
  async available(projectId: string, rawSiteUrl: string | null | undefined): Promise<SearchPerformanceAvailability> {
    return { services: (await this.deps.sources(projectId, rawSiteUrl)).map((s) => s.service) };
  }

  /** The numbers for the last `days` days; null when the site has no data at `service`. Throws what the search engine refused with. */
  async view(projectId: string, rawSiteUrl: string | null | undefined, service: WebmasterService, days: SearchPerformancePeriod): Promise<SearchPerformanceView | null> {
    const source = (await this.deps.sources(projectId, rawSiteUrl)).find((s) => s.service === service);
    if (!source) return null;
    const now = this.now();
    const period = searchPeriod(days, now);
    const key = [projectId, service, days, source.siteUrl, source.accountId, period.end].join('\n');
    const site = [projectId, service, source.siteUrl, source.accountId].join('\n');
    const lag = this.lags.get(site);
    const kept = this.answers.get(key);
    if (kept && now.getTime() - kept.at < (this.deps.ttlMs ?? TTL_MS)) return kept.view;
    const failed = this.failures.get(key);
    if (failed && now.getTime() - failed.at < FAILURE_TTL_MS) throw failed.error;
    const inFlight = this.running.get(key);
    if (inFlight) return inFlight;
    const work = (async () => {
      let data: SearchPerformanceData;
      try {
        data = await source.read(period, lag === undefined ? undefined : addDays(period.end, -lag));
      } catch (err) {
        this.failures.delete(key);
        this.failures.set(key, { at: now.getTime(), error: err });
        for (const old of this.failures.keys()) {
          if (this.failures.size <= (this.deps.maxEntries ?? MAX_ENTRIES)) break;
          this.failures.delete(old);
        }
        throw err;
      }
      this.failures.delete(key);
      const { period: shown, ...figures } = data;
      this.lags.delete(site);
      this.lags.set(site, daysBefore(period.end, shown.end));
      for (const old of this.lags.keys()) {
        if (this.lags.size <= (this.deps.maxEntries ?? MAX_ENTRIES)) break;
        this.lags.delete(old);
      }
      const view: SearchPerformanceView = {
        service,
        siteUrl: source.siteUrl,
        period: { days, start: shown.start, end: shown.end },
        ...figures,
        fetchedAt: now.toISOString(),
      };
      this.answers.delete(key);
      this.answers.set(key, { at: now.getTime(), view });
      // The oldest answers go first (a Map keeps insertion order).
      for (const old of this.answers.keys()) {
        if (this.answers.size <= (this.deps.maxEntries ?? MAX_ENTRIES)) break;
        this.answers.delete(old);
      }
      return view;
    })().finally(() => this.running.delete(key));
    this.running.set(key, work);
    return work;
  }
}
