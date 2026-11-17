import type { RankLocationOption } from '@sitewright/schema';
import { RankProviderError } from './types.js';

/**
 * The location picker of a provider with no list of places (Apify, Bright Data): the country itself, by its English
 * name — matched by `query`, or offered when the query is empty. Keywords tracked for a city keep it: they are sent
 * as Google's place code for the stored name.
 */
export function countryOnlyLocations(countryCode: string, query: string): RankLocationOption[] {
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new RankProviderError('a country is an ISO code such as NA', 'invalid');
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
  } catch {
    name = undefined;
  }
  if (!name || name === countryCode) return [];
  const q = query.trim().toLowerCase();
  const country: RankLocationOption = { name, type: 'Country', countryCode };
  return !q || name.toLowerCase().includes(q) ? [country] : [];
}
