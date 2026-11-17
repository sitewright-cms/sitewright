import { normalizeRankDomain, rankNextStage } from '@sitewright/schema';
import type { SerpEntry, SerpPage } from './providers/types.js';

/** The site a results page is read for. `domain` is already normalized (no `www.`). */
export interface RankTarget {
  domain: string;
  includeSubdomains: boolean;
}

export interface RankHit {
  /** The position among the results Google numbers (1 = the first; a featured snippet counts as one). */
  position: number;
  absolutePosition: number;
  url: string;
  /** The hit is the site's featured snippet. */
  featured: boolean;
}

/** What one results page says about one site. */
export interface PageReading {
  hit: RankHit | null;
  /** Results on the page that carry a position (organic and featured snippets). */
  resultsRead: number;
  /** Results pages the provider fetched, when it says. */
  pagesRead: number | null;
}

/** The host a result belongs to: its URL's, else the provider's `domain`, normalized like the target. */
function hostOf(entry: SerpEntry): string | undefined {
  try {
    const host = normalizeRankDomain(new URL(entry.url).hostname);
    if (host) return host;
  } catch {
    // fall back to the provider's domain
  }
  return entry.domain ? normalizeRankDomain(entry.domain) : undefined;
}

export function isOwnHost(host: string, target: RankTarget): boolean {
  return host === target.domain || (target.includeSubdomains && host.endsWith(`.${target.domain}`));
}

/**
 * An entry's position the way Google counts it: its place among results of its own kind, plus every result of the
 * other kind above it on the page.
 *
 * ★ A featured snippet is the first result, and since 2020 Google does not repeat its page among the ordinary results
 * below it. Providers list the snippet as its own kind and number the ordinary results without it (DataForSEO's
 * `rank_group`) — so a site holding the snippet used to read as "not in the results", and every result after
 * someone else's snippet one place too high. Search Console counts the snippet as position 1; so does this.
 */
function googlePosition(entry: SerpEntry, entries: readonly SerpEntry[]): number {
  const othersAbove = entries.filter((e) => e.kind !== entry.kind && e.absolutePosition < entry.absolutePosition).length;
  return entry.position + othersAbove;
}

/** Where the site first appears among the results Google numbers, or null when it is not on the page. */
export function findRank(entries: readonly SerpEntry[], target: RankTarget): RankHit | null {
  let best: RankHit | null = null;
  for (const entry of entries) {
    const host = hostOf(entry);
    if (!host || !isOwnHost(host, target)) continue;
    const position = googlePosition(entry, entries);
    if (!best || position < best.position) {
      best = { position, absolutePosition: entry.absolutePosition, url: entry.url, featured: entry.kind === 'featured_snippet' };
    }
  }
  return best;
}

/** Everything a check keeps from a results page: where the site is, and how much of the results the page held. */
export function readPage(page: SerpPage, target: RankTarget): PageReading {
  return { hit: findRank(page.entries, target), resultsRead: page.entries.length, pagesRead: page.pagesRead ?? null };
}

/** What the stages before this one read: their results number this stage's. Zero for a check's first stage. */
export interface StagePrior {
  resultsRead: number;
  pagesRead: number;
}

/**
 * One stage of a check (`rankStages`) read on from the stages before it: the site's position counts every result those
 * read, and `final` says whether the check is finished — the site turned up, Google had nothing more (it said so, served
 * fewer pages than asked or an empty one), or the depth is read. Otherwise the check goes on to the next stage.
 *
 * `absolutePosition` is offset by the results before it only: the stages before kept no count of ads and the like.
 */
export function readStage(page: SerpPage, target: RankTarget, prior: StagePrior, depth: number): { reading: PageReading; final: boolean } {
  const own = readPage(page, target);
  // The stage this page answers: what follows the pages already read.
  const asked = rankNextStage(depth, prior.pagesRead);
  const pages = own.pagesRead ?? asked?.pages ?? 0;
  const pagesRead = prior.pagesRead + pages;
  const hit = own.hit
    ? { ...own.hit, position: own.hit.position + prior.resultsRead, absolutePosition: own.hit.absolutePosition + prior.resultsRead }
    : null;
  const reading: PageReading = { hit, resultsRead: prior.resultsRead + own.resultsRead, pagesRead };
  // Fewer pages than asked mean Google stopped — unless the provider says it cut the stage short itself.
  const googleStopped = page.end === true || own.resultsRead === 0 || (page.cut !== true && asked !== null && pages < asked.pages);
  return { reading, final: hit !== null || googleStopped || rankNextStage(depth, pagesRead) === null };
}
