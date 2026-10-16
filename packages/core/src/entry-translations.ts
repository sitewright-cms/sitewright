import type { Entry } from '@sitewright/schema';
import { resolveLocaleDatasets } from './i18n.js';

/**
 * Per-entry translations (`entry.translations[locale]`): the fields whose value differs in that language.
 * Every other field FOLLOWS the main language — so a price or a photo changed in `values` changes on every
 * language page that did not deliberately give it another value. The render overlays the translation on
 * `values`; a `<slug>_<locale>` dataset, where one exists, still replaces the whole dataset instead.
 */

/** What the overlay needs of an entry — a stored Entry, or the lighter rows a data file is built from. */
export interface TranslatableEntry {
  values?: Record<string, unknown> | null;
  translations?: Record<string, Record<string, unknown>>;
}

/** Structural equality of two JSON values (what an entry field can hold). Key order does not matter. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bs = b as unknown[];
    return a.length === bs.length && a.every((v, i) => jsonEqual(v, bs[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => Object.hasOwn(bo, k) && jsonEqual(ao[k], bo[k]));
}

/** The fields an entry has in `locale`, or undefined when it has no version in that language. */
export function entryTranslation(entry: TranslatableEntry, locale: string | undefined): Record<string, unknown> | undefined {
  const all = entry.translations;
  return locale && all && Object.hasOwn(all, locale) ? all[locale] : undefined;
}

/** The entry as a reader in `locale` sees it: its main-language `values`, overlaid with that language's. */
export function localizeEntry<E extends TranslatableEntry>(entry: E, locale: string | undefined): E {
  const fields = entryTranslation(entry, locale);
  if (!fields || Object.keys(fields).length === 0) return entry;
  return { ...entry, values: { ...entry.values, ...fields } };
}

/**
 * Keep only the fields that DIFFER from the main language — the rest follow it. Applied to every write,
 * so a version copied whole ("Translate to …") stores just what was actually changed. A language left
 * with no differing fields stays, empty: it was reviewed and needs nothing changed.
 */
export function normalizeEntryTranslations<E extends Entry>(entry: E): E {
  if (!entry.translations) return entry;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [locale, fields] of Object.entries(entry.translations)) {
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(fields)) {
      if (!(Object.hasOwn(entry.values, name) && jsonEqual(value, entry.values[name]))) kept[name] = value;
    }
    out[locale] = kept;
  }
  return { ...entry, translations: out };
}

/** The entry without its version in `locale` (a language removed from the site). */
export function withoutEntryTranslation<E extends Entry>(entry: E, locale: string): E {
  if (!entry.translations || !Object.hasOwn(entry.translations, locale)) return entry;
  const rest = Object.fromEntries(Object.entries(entry.translations).filter(([l]) => l !== locale));
  if (Object.keys(rest).length > 0) return { ...entry, translations: rest };
  const without: E = { ...entry };
  delete without.translations;
  return without;
}

/** Each entry list, overlaid for one locale — computed once per list per locale (a build renders many pages). */
const overlaid = new WeakMap<readonly TranslatableEntry[], Map<string, readonly TranslatableEntry[]>>();

function localizeList<E extends TranslatableEntry>(list: readonly E[], locale: string): readonly E[] {
  let byLocale = overlaid.get(list);
  const hit = byLocale?.get(locale);
  if (hit) return hit as readonly E[];
  // Unchanged lists keep their identity, so nothing downstream copies a dataset no entry translates.
  const translates = (e: E) => Object.keys(entryTranslation(e, locale) ?? {}).length > 0;
  const mapped = list.some(translates) ? list.map((e) => localizeEntry(e, locale)) : list;
  if (!byLocale) overlaid.set(list, (byLocale = new Map()));
  byLocale.set(locale, mapped);
  return mapped;
}

/**
 * The dataset map a page in `locale` renders. A `<name>_<locale>` dataset replaces `<name>` (unchanged —
 * see {@link resolveLocaleDatasets}); every entry is then shown in that language where it has a version
 * in it. So `{{#each dataset.services}}`, `{{item.services.<key>}}` and `{{#sw-pick-entry dataset.team id}}`
 * — which is how a reference field is read — all give a German page the German entry.
 */
export function resolveLocaleEntries<E extends TranslatableEntry>(
  datasets: Record<string, readonly E[]>,
  locale: string | undefined,
): Record<string, readonly E[]> {
  const resolved = resolveLocaleDatasets(datasets, locale);
  if (!locale) return resolved;
  const out: Record<string, readonly E[]> = {};
  for (const [name, list] of Object.entries(resolved)) out[name] = localizeList(list, locale);
  return out;
}
