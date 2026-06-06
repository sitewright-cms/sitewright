// Multilingual content model (document-level, template-reuse) — see
// docs/i18n-content-model.md. A locale variant of a page is itself a Page (own
// path/title/seo/content), usually sharing structure via the same `template`;
// variants of one page are linked by `translationGroup`. Datasets are duplicated
// per locale (`<slug>-<locale>`) and resolved here by an auto locale-suffix
// convention, with explicit `<slug>-<locale>` addressing still available.
import type { Page } from '@sitewright/schema';
import { pagePath, pagesById } from './routes.js';

/**
 * The dataset slug a base name resolves to in `locale` — a slug-valid hyphen suffix
 * with the locale lowercased (`services` + `de` → `services-de`; `pt-BR` → `services-pt-br`),
 * so it satisfies `SlugSchema` for every locale tag.
 */
export function localizedDatasetName(name: string, locale: string): string {
  return `${name}-${locale.toLowerCase()}`;
}

/**
 * Returns a view of the dataset map for the active `locale`: a base name `<s>`
 * resolves to `<s>-<locale>` when that dataset exists (auto-suffix), otherwise
 * stays itself (fallback to the default-locale dataset). The original suffixed
 * keys remain addressable, so `{{#each data.services-de}}` still works as a
 * manual escape hatch. The default locale (no `-<locale>` variants) is unchanged.
 */
export function resolveLocaleDatasets<T>(
  datasets: Record<string, readonly T[]>,
  locale: string | undefined,
): Record<string, readonly T[]> {
  if (!locale) return datasets;
  const suffix = `-${locale.toLowerCase()}`;
  const out: Record<string, readonly T[]> = { ...datasets };
  for (const name of Object.keys(datasets)) {
    // Don't re-suffix a name that is already a variant for THIS locale.
    if (name.endsWith(suffix)) continue;
    const localized = localizedDatasetName(name, locale);
    if (Object.prototype.hasOwnProperty.call(datasets, localized)) {
      out[name] = datasets[localized]!;
    }
  }
  return out;
}

/** A page's effective locale: its own `locale`, or the project default when unset. */
export function localeOf(page: Pick<Page, 'locale'>, defaultLocale: string): string {
  return page.locale ?? defaultLocale;
}

/**
 * The subset of `pages` belonging to `locale` — used to build a per-locale nav so a
 * menu lists only the pages that exist in that language. Default-locale pages carry
 * no explicit `locale`, so they match when `locale === defaultLocale`.
 */
export function pagesInLocale<T extends Pick<Page, 'locale'>>(
  pages: readonly T[],
  locale: string,
  defaultLocale: string,
): T[] {
  return pages.filter((p) => localeOf(p, defaultLocale) === locale);
}

/** One member of a translation group, for a language switcher. */
export interface TranslationLink {
  locale: string;
  path: string;
  title: string;
}

/**
 * The locale variants of `page` (its translation group, including the page
 * itself), as `{ locale, path, title }`, sorted by locale. `defaultLocale`
 * fills in a member whose `locale` is unset. Empty when the page has no
 * `translationGroup` (it stands alone → no alternates / switcher).
 */
export function translationsOf(
  pages: readonly Page[],
  page: Page,
  defaultLocale: string,
): TranslationLink[] {
  if (!page.translationGroup) return [];
  const byId = pagesById(pages);
  return pages
    .filter((p) => p.translationGroup === page.translationGroup && !p.collection)
    .map((p) => ({ locale: p.locale ?? defaultLocale, path: pagePath(p, byId), title: p.title }))
    .sort((a, b) => a.locale.localeCompare(b.locale, 'en'));
}
