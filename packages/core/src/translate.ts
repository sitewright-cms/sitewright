import type { Translations } from '@sitewright/schema';

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
 * context (so `{{sw-translate}}` and the `data-sw-text="t:<key>"` directive are trivial map reads and
 * the full multi-locale catalog never crosses the render IPC). Keys that resolve to an empty string
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
