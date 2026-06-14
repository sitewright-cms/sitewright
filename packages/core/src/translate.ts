import type { Translations } from '@sitewright/schema';

/** Catalog/locale keys that must never index a cell map (prototype-pollution guard). */
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolve a single translation `key` from the KEY-FIRST catalog (`key → { locale → string }`) for
 * `locale`, falling back to the project `defaultLocale`, then to `fallback` (else `''`). An EMPTY
 * cell counts as "not translated" → it falls through (so a newly-added, untranslated locale shows the
 * default-language string, not a blank). Pure + prototype-safe (own-property reads only).
 */
export function translate(
  translations: Translations | undefined,
  key: string,
  locale: string | undefined,
  defaultLocale?: string,
  fallback?: string,
): string {
  if (translations && Object.prototype.hasOwnProperty.call(translations, key)) {
    const cells = translations[key];
    if (cells && typeof cells === 'object') {
      const pick = (loc: string | undefined): string | undefined => {
        if (!loc || !Object.prototype.hasOwnProperty.call(cells, loc)) return undefined;
        const v = cells[loc];
        return typeof v === 'string' && v !== '' ? v : undefined;
      };
      const hit = pick(locale) ?? (defaultLocale !== locale ? pick(defaultLocale) : undefined);
      if (hit !== undefined) return hit;
    }
  }
  return fallback ?? '';
}

/**
 * Pre-resolve the whole catalog to a FLAT `{ key: string }` map for one `locale` (defaultLocale
 * fallback baked in) — the slim, page-specific projection the renderer ships into the template/render
 * context (so `{{sw-translate}}` and the `data-sw-translate` directive are trivial map reads and the
 * full multi-locale catalog never crosses the render IPC). Keys that resolve to an empty string
 * are OMITTED (so the helper/directive can apply its own `default=`/inner-text fallback). Pure.
 */
export function resolveTranslations(
  translations: Translations | undefined,
  locale: string | undefined,
  defaultLocale?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!translations) return out;
  for (const key of Object.keys(translations)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = translate(translations, key, locale, defaultLocale, undefined);
    if (v !== '') out[key] = v;
  }
  return out;
}

/**
 * Immutably set one catalog cell — `translations[key][locale] = value` — returning a NEW catalog (the
 * input is never mutated). An EMPTY `value` DELETES the cell instead (empty = "not translated"; see
 * {@link translate}), and a key left with no cells is dropped — so an inline "clear to revert" never
 * accumulates blank entries. Prototype-pollution keys/locales (or an empty key/locale) are a no-op
 * (returns a shallow copy unchanged). The single write path for the inline `data-sw-translate` editor.
 */
export function setTranslationCell(
  translations: Translations | undefined,
  key: string,
  locale: string,
  value: string,
): Translations {
  const next: Translations = { ...(translations ?? {}) };
  if (key === '' || locale === '' || PROTO_KEYS.has(key) || PROTO_KEYS.has(locale)) return next;
  // key/locale guarded by PROTO_KEYS + non-empty above; writes target fresh local objects only.
  const cells: Record<string, string> = {
    ...(Object.prototype.hasOwnProperty.call(next, key) ? next[key] : {}),
  };
  if (value === '') delete cells[locale];
  else cells[locale] = value;
  if (Object.keys(cells).length === 0) delete next[key];
  else next[key] = cells;
  return next;
}

/**
 * Immutably remove `locale` from EVERY key's cell map (dropping any key left with no cells), returning
 * a NEW catalog. Called when a locale is removed from the project so the catalog never keeps cells for
 * a language that no longer exists (locale-sync). Prototype keys are skipped. Pure.
 */
export function pruneTranslationsLocale(
  translations: Translations | undefined,
  locale: string,
): Translations {
  const next: Translations = {};
  if (!translations) return next;
  // All reads/writes below use own enumerable keys, proto-guarded by PROTO_KEYS, into fresh local objects.
  for (const key of Object.keys(translations)) {
    if (PROTO_KEYS.has(key)) continue;
    const cells = translations[key];
    if (!cells || typeof cells !== 'object') continue;
    const kept: Record<string, string> = {};
    for (const loc of Object.keys(cells)) {
      if (loc === locale || PROTO_KEYS.has(loc)) continue;
      const v = cells[loc];
      if (typeof v === 'string') kept[loc] = v;
    }
    if (Object.keys(kept).length) next[key] = kept;
  }
  return next;
}
