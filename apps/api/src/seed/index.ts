// Barrel for the seeded example-project content (one module per concern: identity / website
// chrome + strings / datasets / entries / forms / pages per locale / translations).

/**
 * Content for the seeded demo project — "Northwind Web Studio", a complete, realistic corporate
 * site that exercises the whole platform: a themed Corporate Identity, the shared skeleton
 * (desktop + mobile navbar slots, rich footer with auto-menus + a Legal column, a cookie-consent
 * banner), first-party components (carousel, lightbox, tabs, modal, accordion, forms), data-aos
 * scroll reveals, eight CMS datasets covering every field type, client-editable `data-sw-*`
 * regions (→ page.data), real imagery, a working localized contact form, the MINI SHOP — and a
 * COMPLETE German translation built the way the platform intends: inherit-mode locale variants
 * (shared code, per-locale page.data + localized slugs/datasets/forms/chrome strings). It is
 * deliberately polished so an operator immediately sees what a finished Sitewright site looks
 * like — then deletes it.
 *
 * Constraints honored so it renders identically in the in-container `/sites/<slug>/` preview AND
 * on an exported static host:
 *   - No inline JS (the preview CSP blocks it): interactivity is first-party platform runtimes
 *     (PE-first — everything renders without JS) or native HTML (<details>, <dialog>); decorative
 *     motion is CSS-only.
 *   - Images are LOCAL media assets (generated + filed into folders by seed-assets.ts) referenced
 *     via `/media/...` URLs that publish rewrites to `_assets/...` — no remote image hosts.
 *   - Page bodies pass the no-JS template validator (values only in text / quoted attrs; the
 *     `{{sw-url …}}` helper for interpolated src/href).
 */

export { EXAMPLE_IDENTITY } from './identity.js';
export { EXAMPLE_WEBSITE } from './website.js';
export { EXAMPLE_DATASETS, EXAMPLE_CONTENT_LOCALES, EXAMPLE_EXTRA_LOCALES } from './datasets.js';
export { CHROME_STRINGS, CHROME_TRANSLATIONS } from './strings.js';
export { exampleEntries } from './entries/index.js';
export { EXAMPLE_FORMS } from './forms.js';
export { examplePages } from './pages/index.js';
export { pagesEn } from './pages/en/index.js';
export { translationsDe } from './translations/de.js';
export { translationsEs } from './translations/es.js';

/** The locale configuration the seed installs (used by seed.ts + mirrored in tests). */
export const EXAMPLE_SETTINGS = { defaultLocale: 'en', locales: ['en', 'de', 'es'] } as const;
