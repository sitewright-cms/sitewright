// Barrel for the seeded example-project content. The former apps/api/src/seed-data.ts was
// split VERBATIM into per-section modules (helpers / identity / website / datasets / entries /
// forms / pages-en / pages-de / pages); this barrel re-exports the same public names so
// consumers are unchanged.

/**
 * Content for the seeded demo project — "Northwind Web Studio", a complete, realistic corporate
 * site that exercises the whole platform: a themed Corporate Identity, the shared skeleton
 * (sticky navbar + rich footer with the auto-menu), CSS-driven motion, four CMS datasets
 * (services / work / team / testimonials) bound into code-first DaisyUI pages, client-editable
 * `data-sw-text` regions (→ page.data), real imagery, and a working contact form. It is deliberately polished so an
 * operator immediately sees what a finished Sitewright site looks like — then deletes it.
 *
 * Constraints honored so it renders identically in the in-container `/sites/<slug>/` preview AND
 * on an exported static host:
 *   - Motion is CSS-only (the preview CSP blocks inline JS); images are LOCAL media assets
 *     (generated + filed into folders by seed-assets.ts) referenced via `/media/...` URLs that
 *     publish rewrites to `_assets/...` — no remote image hosts.
 *   - Page bodies pass the no-JS template validator (values only in text / quoted attrs; the
 *     `{{sw-url …}}` helper for interpolated src/href).
 */

export { EXAMPLE_IDENTITY } from './identity.js';
export { EXAMPLE_WEBSITE } from './website.js';
export { EXAMPLE_DATASETS } from './datasets.js';
export { exampleEntries } from './entries.js';
export { EXAMPLE_FORMS } from './forms.js';
export { examplePages } from './pages.js';
