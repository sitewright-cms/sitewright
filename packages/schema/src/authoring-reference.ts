// MACHINE-READABLE authoring-reference registries — the single source of truth for the parts of the
// code-first authoring surface that the engine ENUMERATES (not the curated helpers, which the engine
// registers and `registeredSwHelpers()` already pins): the `data-sw-*` editable directives, the
// binding namespaces, and the loop/system variables. Pure data (JSON-safe), no behavior.
//
// The editor's Template reference (apps/editor/src/views/library/reference.ts) DERIVES its
// Directives / Bindings / Variables tabs from these, so the docs can never drift from the registry.
// And drift tests in @sitewright/blocks pin each registry to the engine's actual behavior:
//   • SW_DIRECTIVES (non-automatic) ↔ the `DIRECTIVE_ATTRS` the resolveDirectives pass processes;
//     the `automatic` data-sw-entry is asserted to be emitted by a real dataset-loop render.
//   • BINDING_NAMESPACE_NAMES ↔ the author-facing keys of `TemplateContext` (a type-level
//     exhaustiveness check — adding a namespace to the render context forces it to be documented).
//   • LOOP_VARIABLES (engine/context entries) ↔ a real `{{#each}}` render resolving them.

/** A `data-sw-*` editable-leaf directive an author puts on a real element to make it click-to-edit. */
export interface SwDirective {
  /** The attribute name, e.g. `data-sw-text`. */
  attr: string;
  /**
   * `data-sw-entry` is added AUTOMATICALLY by the dataset `{{#each}}` (and `{{#sw-pick-entry}}`) —
   * it is NOT one of the attributes the resolveDirectives pass scans for, so the drift test excludes
   * the automatic entries when comparing the registry to the engine's `DIRECTIVE_ATTRS`.
   */
  automatic?: boolean;
  /** Stable, group-scoped id (matches the editor reference entry id). */
  id: string;
  syntax: string;
  name: string;
  keywords?: string;
  description: string;
  example?: string;
  note?: string;
}

/**
 * The author-facing binding namespaces — the top-level keys a template reads with `{{ … }}`. This
 * tuple is the canonical SET; a type-level test in @sitewright/blocks asserts it equals the
 * author-facing keys of the render context (`Exclude<keyof TemplateContext, infra keys>`), so a new
 * namespace on the context can't be added without documenting it here.
 */
export const BINDING_NAMESPACE_NAMES = [
  'company',
  'website',
  'page',
  'pages',
  'dataset',
  'item',
  'nav',
] as const;

export type BindingNamespaceName = (typeof BINDING_NAMESPACE_NAMES)[number];

/** One documented binding (a namespace or one of its sub-paths), tagged with its top-level namespace. */
export interface BindingDoc {
  /** The top-level namespace this entry documents (one of {@link BINDING_NAMESPACE_NAMES}). */
  namespace: BindingNamespaceName;
  /** Stable, group-scoped id (matches the editor reference entry id). */
  id: string;
  syntax: string;
  name: string;
  keywords?: string;
  description: string;
  example?: string;
  note?: string;
}

/** Where a loop/system variable comes from — drives how the drift test verifies it. */
export type LoopVariableSource =
  /**
   * Behavior UNIQUE to our engine: the dataset `{{#each}}` flattening (`this` = the entry's fields)
   * and the `@entry` envelope frame our helpers add. NOTE the plain loop counters (`@index`/`@key`/
   * `@first`/`@last`) are Handlebars built-ins on any array → they are `builtin`, not `engine`.
   */
  | 'engine'
  /** A Handlebars built-in — the loop counters (`@index`/`@key`/`@first`/`@last`), `@root`, and `../`. */
  | 'builtin'
  /** Not a frame variable — the fields of the current loop ITEM (e.g. a nav item's `path`). */
  | 'context';

/** One loop/system variable available inside `{{#each}}` / `{{#with}}` (and `@root` from anywhere). */
export interface LoopVariable {
  source: LoopVariableSource;
  /** Stable, group-scoped id (matches the editor reference entry id). */
  id: string;
  syntax: string;
  name: string;
  keywords?: string;
  description: string;
  example?: string;
  note?: string;
}

// ───────────────────────────────────────────────────────────────────────── directives
export const SW_DIRECTIVES: readonly SwDirective[] = [
  {
    attr: 'data-sw-text',
    id: 'd-text',
    syntax: 'data-sw-text="key"',
    name: 'data-sw-text',
    keywords: 'editable plain text inline directive',
    description:
      'Makes the element’s text editable in place (plain text, HTML-escaped). The override is stored in page.data — a bare key is a top-level property; a `page.data.<path>` key targets a nested page.data path.',
    example: '<h1 data-sw-text="headline">Welcome</h1>',
  },
  {
    attr: 'data-sw-html',
    id: 'd-html',
    syntax: 'data-sw-html="key"',
    name: 'data-sw-html',
    keywords: 'editable rich text wysiwyg html directive',
    description:
      'Makes the element a RICH-text region: a floating toolbar in the preview + a side WYSIWYG/HTML-source editor. The override is stored in page.data (bare key = top-level; `page.data.<path>` = nested) and sanitized to a safe allowlist at render.',
    example: '<div data-sw-html="intro"><p>Default intro…</p></div>',
  },
  {
    attr: 'data-sw-href',
    id: 'd-href',
    syntax: 'data-sw-href="key"',
    name: 'data-sw-href',
    keywords: 'editable link url anchor directive',
    description:
      'Makes a link’s URL editable (a popover). Pair with data-sw-text on the same anchor to edit its label too.',
    example: '<a data-sw-href="cta_url" data-sw-text="cta_label" href="/start">Get started</a>',
  },
  {
    attr: 'data-sw-src',
    id: 'd-src',
    syntax: 'data-sw-src="key"',
    name: 'data-sw-src',
    keywords: 'editable image src picture directive',
    description: 'Makes an <img> replaceable — clicking it in the preview opens the file picker.',
    example: '<img data-sw-src="hero" src="/hero.jpg" alt="Hero">',
  },
  {
    attr: 'data-sw-bg',
    id: 'd-bg',
    syntax: 'data-sw-bg="key"',
    name: 'data-sw-bg',
    keywords: 'editable background image cover directive',
    description:
      'Makes an element’s background image replaceable via the file picker (set as an inline background-image).',
    example: '<section data-sw-bg="band" class="min-h-64 bg-cover bg-center">…</section>',
  },
  {
    attr: 'data-sw-translate',
    id: 'd-translate',
    syntax: 'data-sw-translate="key"',
    name: 'data-sw-translate',
    keywords: 'editable translation i18n locale message catalog shared string directive',
    description:
      'Makes the element’s text a PROJECT TRANSLATION (plain text, HTML-escaped) — it renders the website.translations value for the current page locale and is click-to-edit in the preview, writing back to website.translations[key][locale]. Unlike data-sw-text (per-page), the same key is SHARED across every page and locale. The element’s authored text is the fallback when the key isn’t translated yet. The read-only twin for attributes/logic is the {{sw-translate "key"}} helper.',
    example: '<span data-sw-translate="nav_cta">Start a project</span>',
  },
  {
    attr: 'data-sw-entry',
    automatic: true,
    id: 'd-entry',
    syntax: 'data-sw-entry  (automatic)',
    name: 'data-sw-entry',
    keywords: 'dataset row click open entry automatic',
    description:
      'Added AUTOMATICALLY by the dataset {{#each}} around each row — clicking a row in the preview opens that entry’s editor. You don’t write it by hand.',
  },
];

// ───────────────────────────────────────────────────────────────────────── bindings
export const BINDING_NAMESPACES: readonly BindingDoc[] = [
  {
    namespace: 'company',
    id: 'n-company',
    syntax: 'company.*',
    name: 'company',
    keywords: 'identity brand organization',
    description:
      'Corporate identity (Settings → Corporate Identity): company.name, .legalName, .shortName, .slogan, .description, .email, .telephone, .mapUrl (Google Maps embed → iframe src), .bookingUrl (external booking/reservation/appointment link); images .logo / .logoLight / .logoDark / .icon (the single favicon/apple-touch/PWA-icon source) / .image; .colors.<token>; address (.street, .locality, .region, .country, .postalCode). company.social is an ARRAY of { link, name, icon } — loop it with {{#each}}.',
    example:
      '<a href="mailto:{{company.email}}">{{company.email}}</a>\n' +
      '\n' +
      '{{#each company.social}}\n' +
      '  <a href="{{sw-url link}}" aria-label="{{name}}">{{sw-icon icon "h-5 w-5"}}</a>\n' +
      '{{/each}}',
  },
  {
    namespace: 'website',
    id: 'n-website',
    syntax: 'website.*',
    name: 'website',
    keywords: 'site url json data',
    description:
      'Site-level settings (Settings → Website): website.siteUrl (the public site URL), website.json_data (a JSON file fetched from a URL at publish), and website.data (an object you edit right here — see its own entry below).',
    example: '{{website.siteUrl}}',
  },
  {
    namespace: 'website',
    id: 'n-website-data',
    syntax: 'website.data.<key>',
    name: 'website.data',
    keywords: 'site data json object store once-off global settings cascaded tree',
    description:
      'A free-form JSON object you build in Settings → Website → “Edit data” (a graphical tree, with a raw-JSON source toggle). Use it for once-off, page-independent content — hero copy, feature flags, lists — addressable by key with no dataset or loop. Nest objects freely; arrays loop with {{#each}}. Lives in both the preview and the published site.',
    example:
      '{{! Read a nested value by its key path: }}\n' +
      '<h1>{{website.data.hero.headline}}</h1>\n' +
      '<p>{{website.data.hero.subline}}</p>\n' +
      '\n' +
      '{{! Loop an array stored under website.data: }}\n' +
      '<ul>\n' +
      '  {{#each website.data.highlights}}\n' +
      '    <li>{{this}}</li>\n' +
      '  {{/each}}\n' +
      '</ul>',
  },
  {
    namespace: 'page',
    id: 'n-page',
    syntax: 'page.*',
    name: 'page',
    keywords: 'title path slug locale translations route data children template code source html',
    description:
      'The current page: page.title, page.path (the FULL computed route, e.g. /de/services), page.slug (the page’s OWN segment, e.g. services), page.description (its meta description), page.image (its OG/share image — wrap in {{sw-url page.image}}), page.locale, page.defaultLocale (the site’s default language — equals page.locale on an unprefixed default-locale page), page.translations (locale alternates — each has .path, .locale), page.data (this page’s custom object), page.children (its child pages), page.template (the id of the template this page renders from, or "" when it has its own code), and page.code (the EFFECTIVE source HTML rendering this page, template-resolved — for a “view source”/docs block; pretty-print with {{json}} or wrap in <pre>) — see their own entries.',
    example: '<title>{{page.title}}</title>\n<body id="{{page.slug}}">',
  },
  {
    namespace: 'page',
    id: 'n-page-data',
    syntax: 'page.data.<key>',
    name: 'page.data',
    keywords: 'page custom data per-page object json article fields blog',
    description:
      'A free-form JSON object stored ON this page (Page editor → “Edit page data”, a tree + JSON editor) and exposed as {{page.data.<key>}} / {{#each page.data.<array>}} — the per-page counterpart of website.data (e.g. a blog article page holds { article_title, article_image, … } here). In preview + publish.',
    example:
      '<h1>{{page.data.article_title}}</h1>\n' +
      '<img src="{{sw-url page.data.article_image}}">\n' +
      '<div>{{page.data.article_body}}</div>',
  },
  {
    namespace: 'page',
    id: 'n-page-children',
    syntax: 'page.children',
    name: 'page.children',
    keywords: 'child pages subpages blog overview index grid list parent tree',
    description:
      'This page’s direct CHILD pages (those nested under it in the pages tree), as an ARRAY — for a blog overview that lists its article pages. Each child is flattened: .title, .path (its full route — use {{sw-url path}}), .slug, .description (its meta description), .image (its OG/share image), .noindex, .navTitle, .status, .locale, .order, and .data (the child’s own page.data object). Same-locale children only, ordered like the pages list, capped at 500. Children are real sub-pages (set a page’s Parent in its settings) — distinct from dataset collection pages.',
    example:
      '{{#each page.children}}\n' +
      '  <a class="card" href="{{sw-url path}}">\n' +
      '    <img src="{{sw-url image}}" alt="{{title}}">\n' +
      '    <h3>{{title}}</h3>\n' +
      '    <p>{{description}}</p>\n' +
      '    <small>{{data.article_date}}</small>\n' +
      '  </a>\n' +
      '{{/each}}',
  },
  {
    namespace: 'page',
    id: 'n-translations',
    syntax: 'page.locale · page.translations',
    name: 'multilingual (i18n)',
    keywords: 'language switcher locale translation multilingual flag hreflang i18n alternates',
    description:
      'page.locale is the current page’s language; page.translations is its locale ALTERNATES (the translation group) as an ARRAY — each with .locale, .path (full route) and .title — for a LANGUAGE SWITCHER and hreflang links. Country flags are a poor proxy for languages ({{sw-flag}} takes a COUNTRY code, not a language code), so map locale→country in website.data and look it up — INSIDE {{#each page.translations}} reach the root with @root: website.data.locale_flags = { en: "gb", de: "de" } then {{sw-flag (lookup @root.website.data.locale_flags locale)}}. DATASETS localize by a "<slug>_<locale>" UNDERSCORE suffix that auto-resolves on a page in that locale ({{#each dataset.services}} on a "de" page reads "services_de" when it exists, else "services") — see the {{#each}} helper.',
    example:
      '<html lang="{{page.locale}}">\n' +
      '\n' +
      '{{#if page.translations}}\n' +
      '  <nav aria-label="Language">\n' +
      '    {{#each page.translations}}\n' +
      '      <a href="{{sw-url path}}" hreflang="{{locale}}">\n' +
      '        {{sw-flag (lookup @root.website.data.locale_flags locale) "h-4 rounded-sm"}} {{locale}}\n' +
      '      </a>\n' +
      '    {{/each}}\n' +
      '  </nav>\n' +
      '{{/if}}',
  },
  {
    namespace: 'page',
    id: 'n-page-parent',
    syntax: 'page.parent.*',
    name: 'page.parent',
    keywords: 'parent page up breadcrumb ancestor inherit section data path slug parentPage',
    description:
      'The current page’s direct PARENT (the page above it in the pages tree), as a lean read-only view nested under page: page.parent.title, page.parent.slug, page.parent.path (its full route — use {{sw-url page.parent.path}}), page.parent.locale, and page.parent.data (the parent’s own page.data — e.g. read a section’s shared settings). Absent at the tree root / home, so {{page.parent.*}} renders empty there. One level only — there is no page.parent.parent. (Formerly the top-level parentPage namespace.)',
    example:
      '{{! "up" link + inherit a value from the parent’s page.data }}\n' +
      '<a href="{{sw-url page.parent.path}}">↑ {{page.parent.title}}</a>\n' +
      '<span class="accent" style="color:{{page.parent.data.section_color}}">{{page.title}}</span>',
  },
  {
    namespace: 'pages',
    id: 'n-pages',
    syntax: 'pages.<slug>…._attributes.<field>',
    name: 'pages',
    keywords: 'pages cross-page other page data shared global slug tree navigate sibling children subtree overview index attributes code template',
    description:
      'DIRECT access to ANOTHER page by slug PATH. Descend the tree with BARE slugs from the home: pages.services is the top-level page slugged “services”, pages.services.seo its child slugged “seo” (a hyphenated slug needs brackets, pages.[web-design]). A node’s OWN fields all live under ._attributes — never bare — so a child slug can NEVER collide with a field and ANY slug is allowed: ._attributes.title, .slug, .path (its full route — {{sw-url pages.x._attributes.path}}), .locale, .description, .image, .template (its template id), and the gated heavy ones ._attributes.data (that page’s page.data), ._attributes.children (its child pages — the SAME array shape as page.children, for an overview ON ANOTHER page), ._attributes.code (its rendered source HTML). pages on its own is the HOME node (pages._attributes.title, pages._attributes.children). Because fields and slugs never share a key, a page slugged exactly “data” is fine — pages.data._attributes.title (that page) vs pages._attributes.data (home’s data) are unambiguous. Same-locale: on a German page the slugs are the GERMAN ones (pages.leistungen.seo). An unknown path renders empty.',
    example:
      '{{! reuse another page’s data, link to it, and list its children }}\n' +
      '<h2>{{pages.services.seo._attributes.data.header_title}}</h2>\n' +
      '<a href="{{sw-url pages.services._attributes.path}}">{{pages.services._attributes.title}}</a>\n' +
      '{{#each pages.services._attributes.children}}<a href="{{sw-url path}}">{{title}}</a>{{/each}}',
  },
  {
    namespace: 'dataset',
    id: 'n-dataset',
    syntax: 'dataset.<dataset>',
    name: 'dataset',
    keywords: 'dataset entries collection rows loop data',
    description:
      'A dataset’s entries as an ordered ARRAY (manage rows in the Data panel). Loop with {{#each}} — each row’s fields are read directly ({{name}}), and rows are click-to-edit in the editor. For a direct lookup by key, use item.<dataset> instead.',
    example: '{{#each dataset.team}}\n  <li>{{name}}</li>\n{{/each}}',
  },
  {
    namespace: 'item',
    id: 'n-item',
    syntax: 'item.<dataset>.<key>.<field>',
    name: 'item',
    keywords: 'dataset entry key lookup direct addressable map by id',
    description:
      'Direct keyed access to a single entry’s fields — no loop, no filter. The <key> is the entry’s id (set it to a clean key like web_development when you create the entry; the Data panel shows each entry’s key). Built only for the datasets a page actually addresses this way.',
    example:
      '{{! Pick ONE entry directly — no loop: }}\n' +
      '<h2>{{item.services.web_development.title}}</h2>\n' +
      '<p class="price">{{item.services.web_development.price}}</p>\n\n' +
      '{{! …vs. looping the whole dataset: }}\n' +
      '{{#each dataset.services}}\n' +
      '  <li>{{title}}</li>\n' +
      '{{/each}}',
  },
  {
    namespace: 'nav',
    id: 'n-nav',
    syntax: 'nav.<slot>',
    name: 'nav',
    keywords: 'menu navigation header footer mobile custom',
    description:
      'Auto-built menus from the page tree, one per nav slot: nav.header, nav.footer, nav.mobile, and nav.custom — an AUTHOR-ONLY slot the default chrome never renders (put a page in the “Custom” nav slot in its settings, then loop {{#each nav.custom}} yourself for a bespoke menu/list anywhere). Each item has .path, .children (sub-pages, for dropdowns), .newTab (open in a new tab), .external (an off-site/mailto/tel link), and the render-ready label — output it with {{sw-label}} (a placeholder’s name can include {{sw-icon}}/HTML; a page title is escaped). Items also include "nav placeholders" (pages-list entries with no page of their own) that link out or group children.',
    example:
      '{{#each nav.custom}}\n' +
      '  <a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a>\n' +
      '{{/each}}',
  },
];

// ───────────────────────────────────────────────────────────────── loop / system variables
export const LOOP_VARIABLES: readonly LoopVariable[] = [
  {
    source: 'engine',
    id: 'v-this',
    syntax: 'this   ·   @entry.id   ·   @entry.dataset',
    name: 'this / @entry',
    keywords: 'current item entry fields loop dataset envelope',
    description:
      'Inside {{#each}}, this is the current item. Over a DATASET the context IS the entry’s fields, so read them directly ({{title}}, not {{values.title}}); the entry’s envelope is on @entry (@entry.id, @entry.dataset, @entry.status).',
    example:
      '{{#each dataset.posts}}\n' +
      '  <h3>{{title}}</h3>\n' +
      '  <small>{{@entry.id}}</small>\n' +
      '{{/each}}',
  },
  {
    source: 'builtin',
    id: 'v-index',
    syntax: '@index   @key',
    name: '@index / @key',
    keywords: 'position counter loop index',
    description: '@index is the zero-based position in a loop; @key is the current item’s key/index.',
    example:
      '{{#each nav.header}}\n' +
      '  <li data-i="{{@index}}">{{sw-label}}</li>\n' +
      '{{/each}}',
  },
  {
    source: 'builtin',
    id: 'v-firstlast',
    syntax: '@first   @last',
    name: '@first / @last',
    keywords: 'boundary loop edge boolean',
    description: 'Booleans — true on the first / last iteration of a loop.',
    example:
      '{{#each dataset.steps}}\n' +
      '  {{#unless @first}}<hr>{{/unless}}\n' +
      '  {{sw-label}}\n' +
      '{{/each}}',
  },
  {
    source: 'context',
    id: 'v-nav',
    syntax: 'label · path · children · locale',
    name: 'nav / translation item',
    keywords: 'menu item label path children locale',
    description:
      'Inside {{#each nav.x}}: label, path, children (sub-items). Inside {{#each page.translations}}: path, locale.',
    example:
      '{{#each nav.header}}\n' +
      '  {{#if children}}\n' +
      '    <details><summary>{{sw-label}}</summary>…</details>\n' +
      '  {{/if}}\n' +
      '{{/each}}',
  },
  {
    source: 'builtin',
    id: 'v-root',
    syntax: '@root.<path>',
    name: '@root',
    keywords: 'root context outer global each with scope website page company reach top',
    description:
      'The OUTERMOST render context (company, website, page, dataset, nav, …), reachable from ANYWHERE — including deep inside a {{#each}}/{{#with}} where the current context is a loop item, not the page. Use it to read a global while iterating: inside {{#each page.translations}} a bare website.* would resolve against the translation item, so reach it with @root (e.g. a per-locale flag map in a language switcher).',
    example:
      '{{#each page.translations}}\n' +
      '  {{! `locale` is the loop item; @root reaches website.data: }}\n' +
      '  {{sw-flag (lookup @root.website.data.locale_flags locale)}}\n' +
      '{{/each}}',
  },
  {
    source: 'builtin',
    id: 'v-parent-ctx',
    syntax: '../value   (../../ …)',
    name: '../ (parent context)',
    keywords: 'parent context outer scope each with up one level nested loop dotdot',
    description:
      'Steps OUT one context level: inside {{#each}}/{{#with}}, ../x reads x from the ENCLOSING scope (stack ../../ to go up two). Use it to reach an outer-loop value from a nested loop. For the very top, @root is usually clearer than counting ../ levels.',
    example:
      '{{#each dataset.categories}}\n' +
      '  <h2>{{name}}</h2>\n' +
      '  {{#each products}}\n' +
      '    {{! ../name = the category from the OUTER loop: }}\n' +
      '    <li>{{name}} — in {{../name}}</li>\n' +
      '  {{/each}}\n' +
      '{{/each}}',
  },
];

/** One curated `{{sw-*}}` template helper — the platform-provided authoring vocabulary (tenants
 *  cannot register their own). The SET is drift-pinned to the engine's `registeredSwHelpers()` by a
 *  test in @sitewright/blocks, so this list can never silently fall out of sync with what ships. */
export interface SwHelper {
  /** The helper name as written in a template (e.g. `sw-icon`). */
  name: string;
  /** A compact usage signature. */
  syntax: string;
  /** One-line summary of what it does. */
  summary: string;
}

/** The complete set of registered `{{sw-*}}` helpers (alphabetical). Concise by design — the deep
 *  how-to for the richer ones lives in the agent guides (icons / components / shop / i18n / nav). */
export const SW_HELPERS: readonly SwHelper[] = [
  { name: 'sw-active', syntax: '{{#if (sw-active path [exact=true])}}…{{/if}}', summary: 'Boolean: is `path` the active page? Matches the active TRAIL by default (a parent stays active on its children); exact=true matches the leaf only (use for aria-current).' },
  { name: 'sw-add-to-cart', syntax: '{{sw-add-to-cart sku= name= price= [image=] [label=] [class=]}}', summary: 'MINI SHOP: an add-to-cart button; the browser cart hands the order to a channel configured in website.shop. Prices are non-authoritative.' },
  { name: 'sw-blank', syntax: '{{#unless (sw-blank value)}}…{{/unless}}', summary: 'Boolean: does `value` have NO visible content? True for missing/whitespace text and for the empty richtext markup (<p></p>, <p><br></p>, &nbsp;) a cleared editor leaves behind; embedded media (img/svg/iframe/…) counts as content. Use to omit a wrapper around an empty optional field.' },
  { name: 'sw-cart', syntax: '{{sw-cart [class=]}}', summary: 'MINI SHOP: the cart button/widget (item count + collapsible order form); labels come from the reserved cart_* translation keys.' },
  { name: 'sw-consent-settings', syntax: '{{sw-consent-settings [label=] [class=]}}', summary: 'A button that RE-OPENS the consent preferences (e.g. a footer “Cookie settings” link; a plain <a href="#sw-consent"> works too). The banner itself auto-appears when website.consent.enabled — no placeholder needed. Label localizes via the reserved consent_settings key.' },
  { name: 'sw-control', syntax: '{{sw-control "path" as="type" [options/min/max/…]}}', summary: 'Content-editor-only inline CONTROL chip (text/number/color/date/select/…) bound to page.data.* or website.data.*. Renders the plain value on the published site.' },
  { name: 'sw-date', syntax: '{{sw-date value [format]}}', summary: 'Formats a date as UTC YYYY-MM-DD, or the full ISO string with "iso". Empty for an unparseable value.' },
  { name: 'sw-flag', syntax: '{{sw-flag "code" ["classes"]}}', summary: 'Inlines a FULL-COLOR country-flag SVG by ISO 3166-1 alpha-2 code; "code-circle" for the round variant. Flags are a poor proxy for languages — map locale→country first.' },
  { name: 'sw-folder', syntax: '{{#sw-folder "name"}}…{{/sw-folder}}', summary: 'Block helper that loops the images of a media FOLDER (galleries); the block context is each image (url/alt/width/height).' },
  { name: 'sw-form', syntax: '{{sw-form "id"}}', summary: 'Embeds a configured web FORM by id (locale-suffix aware). Never hand-wire the endpoint; submissions land in the inbox.' },
  { name: 'sw-html', syntax: '{{sw-html value}}', summary: 'Outputs SANITIZED rich HTML from a value (safe-HTML allowlist incl. https-sandboxed iframes; script/on*/form stripped). For trusted rich-text fields.' },
  { name: 'sw-icon', syntax: '{{sw-icon "name" ["classes"]}}', summary: 'Inlines an SVG icon — a BARE name is a Lucide line glyph; "brand:slug" is a themed brand/social logo (e.g. "brand:whatsapp"). "x" ≠ "brand:x".' },
  { name: 'sw-label', syntax: '{{sw-label}}', summary: 'Renders the current nav item\'s (possibly rich, {{sw-icon}}-bearing) label inside {{#each nav.*}}.' },
  { name: 'sw-pick-entry', syntax: '{{#sw-pick-entry "dataset" id}}…{{/sw-pick-entry}}  ·  (sw-pick-entry "dataset" id)', summary: 'Selects ONE dataset entry by id as the block context (or as a subexpression) — for referencing a specific entry outside a loop.' },
  { name: 'sw-theme-toggle', syntax: '{{sw-theme-toggle [class=]}}', summary: 'A light/dark THEME toggle button (no-flash, View-Transitions). Needs website.enableThemes.' },
  { name: 'sw-translate', syntax: '{{sw-translate "key" [default="…"]}}', summary: 'Outputs a translated string for the page locale from the website.translations CATALOG (read-only twin of the data-sw-translate directive); falls back default-locale → default= → empty. Escaped, so safe in text or an attribute.' },
  { name: 'sw-truncate', syntax: '{{sw-truncate text [N]}}', summary: 'Clips text to at most N characters (default 100), adding an ellipsis when clipped.' },
  { name: 'sw-url', syntax: '{{sw-url value}}', summary: 'Scheme-sanitizes a URL for an href/src (blocks javascript:/data:/protocol-relative) and rebases internal links at publish. ALWAYS use it for href/src.' },
];
