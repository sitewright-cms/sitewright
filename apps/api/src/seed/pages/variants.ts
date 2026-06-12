import type { JsonObject, Page } from '@sitewright/schema';
import { scaffoldLocale } from '@sitewright/core';

// ---------------------------------------------------------------- locale variants (inherit-mode)
// The seed builds its locale variants with the SAME `scaffoldLocale()` the editor's "Add
// language" uses — so the demo's variants are byte-compatible with real ones: id
// `<owner>-<locale>`, in-locale parent chain, the locale home's slug = the locale code, NO
// source/template (the code is INHERITED from the English owner). A per-page translation seed
// then overlays the localized slug, titles, and the variant's own `page.data` (every
// data-sw-text/html/href key the shared code binds).

export interface PageTranslationSeed {
  /** Localized own slug. Omit for the locale HOME (its slug is the locale code) and for
   * `kind:'link'` placeholders (no route). */
  path?: string;
  title: string;
  /** Menu label (`nav.title`); omit to fall back to the page title. */
  navTitle?: string;
  description?: string;
  /** The variant's complete `page.data` — replaces the scaffold's copy of the owner's data. */
  data?: JsonObject;
}

/**
 * Scaffold `locale` variants of the EN pages and overlay the translation seeds (keyed by OWNER
 * id). Returns the owners (with their scaffold-assigned `translationGroup`) plus the localized
 * variants. Throws when a seed references an unknown page or a page is left untranslated —
 * the seed must stay locale-complete (the seed-content tests enforce the same).
 */
export function localeVariants(
  enPages: Page[],
  locale: string,
  seeds: Record<string, PageTranslationSeed>,
): { owners: Page[]; variants: Page[] } {
  const { created, updated } = scaffoldLocale(enPages, locale, 'en');
  const updatedById = new Map(updated.map((p) => [p.id, p]));
  const owners = enPages.map((p) => updatedById.get(p.id) ?? p);

  const ownerIds = new Set(enPages.map((p) => p.id));
  const unknown = Object.keys(seeds).filter((id) => !ownerIds.has(id));
  if (unknown.length > 0) throw new Error(`localeVariants(${locale}): seeds for unknown pages: ${unknown.join(', ')}`);
  const missing = enPages.filter((p) => !(p.id in seeds)).map((p) => p.id);
  if (missing.length > 0) throw new Error(`localeVariants(${locale}): missing translations for: ${missing.join(', ')}`);

  const variants = created.map((v) => {
    // The scaffold links every variant to its owner's group; owners here never pre-declare one,
    // so the group IS the owner id.
    const seed = seeds[v.translationGroup ?? ''];
    if (!seed) throw new Error(`localeVariants(${locale}): no seed matched variant "${v.id}"`);
    const out: Page = { ...v, title: seed.title };
    // The locale home keeps its scaffolded slug (the locale code); link placeholders have none.
    if (seed.path !== undefined) out.path = seed.path;
    if (seed.description !== undefined) out.description = seed.description;
    if (seed.data !== undefined) out.data = seed.data;
    if (seed.navTitle !== undefined && out.nav) out.nav = { ...out.nav, title: seed.navTitle };
    return out;
  });

  return { owners, variants };
}
