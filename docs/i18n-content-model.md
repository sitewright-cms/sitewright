# Multilingual content model (ADR + implementation plan)

**Status:** Implemented — the **code-inheritance** model (below) shipped. The original draft chose
template-reuse; the shipped model makes a translated variant *inherit* the main language's code by
default instead (no per-page template needed), with fork/template available per variant.
**Supersedes:** the tree-based `PageTranslation` + per-locale publish loop in `apps/api/src/publish/build.ts` (functionally dead for code-first pages — it overrides a page's block-tree `root`, but pages render from `source`).

## Shipped model — code inheritance (supersedes the template-reuse design below)

A locale variant of a page is its own `Page`, linked to its siblings by `translationGroup`, and gets
its **code** in one of three modes:

- **inherit (default):** the variant carries **no `source` and no `template`** → at render it resolves
  the code of its translation group's DEFAULT-LOCALE page (the "code owner") via `resolveCodeRef`
  (`packages/core/src/i18n.ts`). Editing the main page's layout updates every inheriting language with
  zero sync. Only `page.data` (+ `title`/`seo`/`path`/`nav`) differs per locale.
- **fork:** the variant carries its own `source` (per-locale layout, edited freely).
- **template:** the variant references a project/global `template`.

Operations are atomic + server-side (`apps/api/src/http/locales.ts`, `ContentRepository.applyLocaleChange`):
- `POST /projects/:id/locales {locale}` — add a translation target + scaffold an inherit variant of every
  default-language page (`scaffoldLocale`), mirroring the tree under `/<locale>/…`.
- `DELETE /projects/:id/locales/:locale` — remove a target + cascade-delete its pages (never the default).
- `POST /projects/:id/pages/:id/translate` — make a default-language page available in all languages
  (`propagatePageToLocales`).
- `POST /projects/:id/pages/:id/delete-group` — delete a page across the languages that INHERIT its code;
  forked/template variants are kept (detached).

Editor: the pages list is locale-first (a language switcher filters to one language; "Add translation"
adds a target via a searchable locale picker). Page settings expose the inherit/fork/template choice for a
translated page; the code editor shows the inherited layout (read-only) with a "fork for this language"
action. An instance-admin setting (`InstanceSettings.defaultLocale`) seeds the default locale of new
projects.

The template-reuse design below is kept for historical context; "share via the same template" is now just
one of the three modes, not the default.

### Shared strings — the translation catalog (`website.translations`)

Per-page locale content (above) localizes `page.data` — text that belongs to ONE page. **Site-wide
phrases** that repeat across pages (nav/footer CTAs, cart labels, common buttons) live instead in a
dedicated, **key-first** message catalog `website.translations` (`{ key: { locale: string } }`), a
sibling of `website.data` — NOT inside it (`website.data` is the author's free-form JSON). One edit
updates every page and locale.

- **Read it** with the `{{sw-translate "key" default="…"}}` helper — a plain (HTML-escaped) string, so
  it works in text, attributes (`alt`/`placeholder`/`aria-label`), and as a sub-expression
  (`{{sw-url (sw-translate "href_home")}}`). Used in the skeleton slots.
- **Edit it in place** with the `data-sw-translate="key"` directive on a real element: it renders the
  catalog value for the page's locale and is click-to-edit in the live preview, writing back to
  `website.translations[key][locale]` (the page's locale; a default-language page writes the default
  locale). The element's authored text is the fallback until the key is translated. This is the i18n twin
  of `data-sw-text` (which is per-page) — same plaintext editing surface, a different (shared) store.
- **Resolution:** `translate()` / `resolveTranslations()` (`packages/core/src/translate.ts`) pre-resolve
  the catalog to a flat `key→string` map for the page locale (defaultLocale fallback baked in, empties
  omitted) — shipped into the render context as `website.t`, read by both the helper and the directive.
- **Edit in bulk** in Settings → Website → **Translations** (a key × locale grid). Columns track the
  configured locales; adding/removing a language in Localization adds/removes the column. Removing a
  locale **prunes** its cells from the catalog server-side (`pruneTranslationsLocale` in
  `apps/api/src/http/locales.ts`); a settings save self-heals cells for any unconfigured locale.
- **Write API:** `PUT /projects/:id/translations {key, locale, value}` sets one cell (empty value clears
  it); the inline editor uses it directly. Bounded + prototype-safe via `safeRecord` / `KeyNameSchema`.

---

## Context

Locales/`defaultLocale` live in project settings and publish already does locale routing,
default-locale fallback, locale-prefixed nav, `<html lang>`, and `hreflang`/`x-default`.
But the only thing it can localize is a page's **block-tree `root`** — the retired model.
For today's **code-first `source`** pages it localizes nothing but the chrome, and it covers
neither **datasets/lists** nor **per-locale page settings** (title / meta description / path).

Three requirements drove the decision:

1. Don't force *all* page content to be editable to translate it.
2. Localize **datasets/lists**, not just static page text.
3. Localize **page settings** — title, meta description, and the URL/path.

## Decision

Adopt a **document-level, template-reuse** model (the "contentBase way"):

- **A locale variant of a page is itself a Page.** It has its own path, title, SEO, and
  `data-sw-text` content (stored in its own `page.data`). Variants of the same primary page are tied together by a
  **translation group**. This makes requirement #3 fall out for free (each locale is a real
  Page, so it already carries its own settings) and lets publish treat every page uniformly.
- **Structure is shared via project templates (template-reuse).** The primary page is saved
  as a **project template**; each locale variant *references* that template and supplies only
  its translated `page.data` content + settings. Change the layout once → every locale follows.
  This answers requirement #1: you translate the marked strings, not the structure.
- **Per-locale layout variation when needed.** A variant that needs a different layout is
  **forked** off the template — it gets its own `source` and is edited independently (the
  existing template→page fork, applied per-locale).
- **A "copy as translation" quick-start** clones a page's `source` into a new locale variant
  (own source from the start) and can later be **promoted to a template** so its siblings
  share it.
- **Datasets are duplicated per locale** (`services` → `services-de`) and resolved by
  **auto locale-suffix** at render: on a `de` page, `dataset.services` resolves to `services-de`
  when it exists, else falls back to `services`. A **manual escape hatch** stays available
  (`{{#each dataset.services-de}}`, or `{{ page.locale }}` + `lookup`).

The legacy `PageTranslation` content kind and the per-locale publish loop are **retired**; each
locale variant publishes once, as an ordinary page at its own path.

## Why not field-level localization

Field-level (one entry, `localized` fields hold per-locale maps; one page, locale-scoped
`content`) avoids object proliferation and keeps shared facts from drifting. We rejected it as
the *primary* model because the document-level model:

- reuses primitives that already exist (templates, fork, `data-sw-text`/`page.data` content, the page-settings
  template selector, the publish pipeline) — fast to ship;
- is far more intuitive for authors **and** AI agents ("the German page is a page");
- supports **per-locale layout variation** natively (a forked variant), which field-level can't.

The accepted cost: more page + dataset objects, and a dataset's *field schema* is duplicated
across `services`/`services-de` (adding a field means adding it to each). Mitigated by a
"duplicate dataset for locale" action that clones the schema at creation. For an agency tool
with a handful of locales per client, this trade is right.

---

## Data model

### Page (additions to `packages/schema/src/page.ts`)

```
locale?:           LocaleSchema          // the page's language; default = project defaultLocale
translationGroup?: IdSchema              // shared id linking all locale variants of one page
                                         // (defaults to the primary page's id)
```

- `template` (exists) → set on every variant for the shared-structure case; unset (and
  `source` set) for a forked layout-variation variant.
- `path`, `title`, `description`, `image` (all exist, per-page) → the per-locale
  page settings, no new fields needed (requirement #3).

### Dataset (no schema change)

Localization is by **convention**, not by the `localized` field flag (which we leave as a
no-op/forward-compat hint or remove): a locale's dataset is `"<slug>-<locale>"`. The
`localized` flag may later drive the "duplicate for locale" UI default.

---

## Render / publish changes (`apps/api/src/publish/build.ts`, `packages/core`)

1. **Retire the locale loop.** Remove the `for (const locale of locales)` pass, the
   `PageTranslation` lookup/override, and `localeSlug`/`localePrefix` derivation. Every page
   (including each locale variant) renders **once** at its own `path`.
2. **Locale-aware dataset resolution.** Build the per-page `dataset` namespace so `dataset.<name>`
   prefers `<name>-<page.locale>` when that dataset exists, else `<name>`. Implement in the
   render-context assembly (a small locale-aware view over `datasetEntries(bundle)`), keeping
   explicit `dataset.<name>-<locale>` working as the manual override.
3. **Collection pages** honor the same suffix: a collection variant whose `page.locale` is `de`
   expands over `<dataset>-de` when present.
4. **`<html lang>`** = `page.locale ?? defaultLocale`.
5. **hreflang / x-default** comes from the **translation group**: for each page, emit one
   `<link rel="alternate" hreflang="<member.locale>" href="<member.path>">` per group member
   plus `x-default` = the default-locale member. (Replaces the current "same pageId across
   locales" assumption.)
6. **Language-switcher context.** Expose `{{ page.locale }}` and `{{ page.translations }}`
   (the group's members as `{ locale, path, title }`) so a skeleton slot / template can render
   a language menu with `{{#each page.translations}}`.
7. **Sitemap** includes every locale variant (each is a real, published page).

---

## Editor changes (`apps/editor`)

- **Page settings modal:** a **Locale** selector (drives lang + hreflang) and a read-only
  **Translation group** display (links to the primary + sibling locales). Localized `path`,
  title, and meta description are the existing fields.
- **Pages list:** group locale variants under their primary (or a language badge + a
  "translations" affordance). New row/page actions:
  - **Save as template** — promote the page's `source` to a project template and convert the
    page to reference it (the reverse of the existing fork).
  - **Add translation** — create a sibling Page: same `template` ref, chosen `locale`, shared
    `translationGroup`, auto path `/<locale>/<slug>` (editable), empty `content` (falls back).
  - **Copy as translation** — clone the `source` into a new locale variant (own source);
    later **Promote to template** to share it.
  - **Fork for this locale** — a template-referencing variant that needs a different layout
    forks to its own `source` (existing "fork template into page").
- The page editor's content mode already edits `data-sw-text` regions in-preview — for a locale variant it
  edits that variant's per-locale strings (its own page.data), unchanged.

## MCP / seed

- Teach the model in `packages/mcp/src/server.ts` INSTRUCTIONS: locale variants are pages
  linked by a translation group and (usually) sharing a template; datasets are duplicated as
  `<slug>-<locale>` and addressed via auto-suffix (or explicitly); `{{ page.translations }}`
  for a language switcher.
- Seed: extend the Example Project with a second locale (e.g. `de`) — a template-shared home
  + a `services-de` dataset — to demonstrate and to give E2E something real.

---

## Phased implementation

1. **Schema + core.** Add `Page.locale` + `Page.translationGroup`; retire the
   `PageTranslation` override path; implement locale-suffix dataset resolution + `page.locale`
   / `page.translations` context in core. Unit tests.
2. **Publish.** hreflang-by-group, `<html lang>`, collection-page suffix, language-switcher
   context; remove the locale loop. Integration tests (multi-locale publish, fallback,
   hreflang, dataset suffix).
3. **Editor.** Settings (locale + group + localized path); pages-list grouping + the four
   actions (Save as template / Add translation / Copy as translation / Promote). Unit + e2e.
4. **MCP + seed + e2e + reviews + DinD deploy.**

## Consequences

- **+** Per-locale settings & layout variation are free; publish gets simpler; intuitive for
  humans and agents; reuses templates/fork/`data-sw-text`/bindings.
- **−** More page + dataset objects; a dataset's field schema is duplicated per locale
  (mitigated by "duplicate for locale"); the old `PageTranslation` kind is removed (it has no
  UI today, so no user-facing migration — drop it, leave a no-op reader for old rows).
