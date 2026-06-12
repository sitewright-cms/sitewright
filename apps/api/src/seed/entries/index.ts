import type { Entry } from '@sitewright/schema';
import { entriesEn } from './en.js';
import { entriesDe } from './de.js';
import { entriesEs } from './es.js';

/**
 * Every seeded dataset entry across all content locales. Missing asset keys resolve to '' (e.g.
 * unit tests that seed without generating images) so no field ever becomes the literal
 * string "undefined".
 */
export function exampleEntries(assetMap: Record<string, string>): Entry[] {
  const assets = new Proxy(assetMap, {
    // Named string keys → the URL or ''; symbol keys (coercion/inspection) pass straight through.
    get: (t, k) => (typeof k === 'symbol' ? Reflect.get(t, k) : k in t ? Reflect.get(t, k) : ''),
  }) as Record<string, string>;
  return [...entriesEn(assets), ...entriesDe(assets), ...entriesEs(assets)];
}
