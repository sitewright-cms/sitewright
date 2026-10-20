import { normalizeRankDomain } from '@sitewright/schema';
import type { SerpEntry } from './providers/types.js';

/** The site a results page is read for. `domain` is already normalized (no `www.`). */
export interface RankTarget {
  domain: string;
  includeSubdomains: boolean;
}

export interface RankHit {
  /** The organic position (1 = the first ordinary result). */
  position: number;
  absolutePosition: number;
  url: string;
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
 * Where the site first appears among the ORGANIC results, or null when it is not on the page.
 *
 * ★ The same for every provider: this, not the provider, decides what a position is. A featured snippet is not
 * counted as a position of its own — Google shows the snippet's page among the organic results too, and that is
 * the position tracked.
 */
export function findRank(entries: readonly SerpEntry[], target: RankTarget): RankHit | null {
  let best: RankHit | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'organic') continue;
    const host = hostOf(entry);
    if (!host || !isOwnHost(host, target)) continue;
    if (!best || entry.position < best.position) {
      best = { position: entry.position, absolutePosition: entry.absolutePosition, url: entry.url };
    }
  }
  return best;
}
