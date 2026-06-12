import type { Page } from '@sitewright/schema';
import { pagesEn } from './en/index.js';
import { localeVariants } from './variants.js';
import { translationsDe } from '../translations/de.js';
import { translationsEs } from '../translations/es.js';

/**
 * Every page of the Example Project, all locales: the English owners (carrying the
 * scaffold-assigned translation groups) followed by the inherit-mode locale variants
 * (shared code, fully translated `page.data` + localized slugs). Parents precede children.
 */
export function examplePages(assetMap: Record<string, string>): Page[] {
  // Missing keys → '' (e.g. unit tests that seed without generating images) so no field ever
  // becomes the literal string "undefined".
  const assets = new Proxy(assetMap, {
    // Named string keys → the URL or ''; symbol keys (coercion/inspection) pass straight through.
    get: (t, k) => (typeof k === 'symbol' ? Reflect.get(t, k) : k in t ? Reflect.get(t, k) : ''),
  }) as Record<string, string>;
  const en = pagesEn(assets);
  const de = localeVariants(en, 'de', translationsDe(assets));
  // Chain on the de-pass owners (they carry the translationGroups) so both locales link the same groups.
  const es = localeVariants(de.owners, 'es', translationsEs(assets));
  return [...es.owners, ...de.variants, ...es.variants];
}
