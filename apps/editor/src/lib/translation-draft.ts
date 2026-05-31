import type { Page, PageNode, PageTranslation } from '@sitewright/schema';
import { reIdTree } from '@sitewright/core';

/** The content the editor edits for a given locale. */
export interface LocaleDraft {
  title: string;
  root: PageNode;
  /** True when the locale has no saved translation yet (seeded from the default). */
  isNew: boolean;
}

/** Storage key for a page's per-locale translation: `${pageId}__${locale}`. */
export function translationId(pageId: string, locale: string): string {
  return `${pageId}__${locale}`;
}

/**
 * Resolves the editing draft for a locale:
 * - the **default** locale edits the page's own content (same `root` reference);
 * - a **non-default** locale with an existing translation edits that translation;
 * - a **non-default** locale with none is seeded from a fresh-id copy of the
 *   default page (the "copy from default" starting point) so the author
 *   translates in place. The original page tree is never mutated.
 */
export function localeDraft(
  page: Page,
  defaultLocale: string,
  locale: string,
  translations: readonly PageTranslation[],
  idGen: () => string,
): LocaleDraft {
  if (locale === defaultLocale) {
    return { title: page.title, root: page.root, isNew: false };
  }
  const existing = translations.find((t) => t.id === translationId(page.id, locale));
  if (existing) {
    return { title: existing.title ?? page.title, root: existing.root, isNew: false };
  }
  return { title: page.title, root: reIdTree(page.root, idGen), isNew: true };
}

/**
 * Builds the `PageTranslation` to persist for a non-default locale. The title is
 * omitted when blank or identical to the default page title, so publish falls
 * back to the page title rather than storing a redundant override.
 */
export function toTranslation(
  page: Page,
  locale: string,
  title: string,
  root: PageNode,
): PageTranslation {
  const trimmed = title.trim();
  const hasOverride = trimmed.length > 0 && trimmed !== page.title.trim();
  return {
    id: translationId(page.id, locale),
    pageId: page.id,
    locale,
    root,
    ...(hasOverride ? { title: trimmed } : {}),
  };
}
