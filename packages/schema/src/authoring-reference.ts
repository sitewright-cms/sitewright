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
      'Makes the element’s text editable in place (plain text, HTML-escaped). The override is stored in page.data — a bare key is a top-level property; a `page.data.<path>` key targets a nested page.data path. A `website.data.<path>` key reads the SITE-WIDE store instead: one value shared by every page, and the only store a chrome slot (mainNav/footer/bottom) can reach, since a slot is not a page.',
    example: '<h1 data-sw-text="headline">Welcome</h1>',
  },
  {
    attr: 'data-sw-html',
    id: 'd-html',
    syntax: 'data-sw-html="key"',
    name: 'data-sw-html',
    keywords: 'editable rich text wysiwyg html directive',
    description:
      'Makes the element a RICH-text region: a floating toolbar in the preview + a side WYSIWYG/HTML-source editor. The override is stored in page.data (bare key = top-level; `page.data.<path>` = nested) and sanitized to a safe allowlist at render. Use a `website.data.<path>` key for ONE site-wide rich block — the way to put an editable HTML region in a chrome slot, which otherwise has only the plain-text data-sw-translate.',
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
      'Added AUTOMATICALLY by the dataset {{#each}} onto each row’s own element — clicking a row in the preview opens that entry’s editor. You don’t write it by hand, and it adds no element of its own, so your layout renders exactly as it will when published.',
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
      'The current page: page.title, page.path (the FULL computed route, e.g. /de/services), page.slug (the page’s OWN segment, e.g. services), page.description (its meta description), page.image (its OG/share image — wrap in {{sw-url page.image}}), page.locale, page.defaultLocale (the site’s default language — equals page.locale on an unprefixed default-locale page), page.translations (locale alternates — each has .path, .locale), page.data (this page’s custom object), page.children (its child pages), page.template (the id of the template this page renders from, or "" when it has its own code), and page.code (the EFFECTIVE source HTML rendering this page, template-resolved — for a “view source”/docs block; pretty-print with {{sw-json}} or wrap in <pre>) — see their own entries.',
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
      'DIRECT access to ANOTHER page by slug PATH. Descend the tree with BARE slugs from the home: pages.services is the top-level page slugged “services”, pages.services.seo its child slugged “seo” (a hyphenated slug needs brackets, pages.[web-design]). A node’s OWN fields all live under ._attributes — never bare — so a child slug can NEVER collide with a field and ANY slug is allowed: ._attributes.title, .slug, .path (its full route — {{sw-url pages.x._attributes.path}}), .locale, .description, .image, .template (its template id), and the gated heavy ones ._attributes.data (that page’s page.data), ._attributes.children (its child pages — the SAME array shape as page.children, for an overview ON ANOTHER page), ._attributes.code (its OWN authored source — empty when the page renders from a template; cf. page.code, which is template-resolved). pages on its own is the HOME node (pages._attributes.title, pages._attributes.children). Because fields and slugs never share a key, a page slugged exactly “data” is fine — pages.data._attributes.title (that page) vs pages._attributes.data (home’s data) are unambiguous. Same-locale: on a German page the slugs are the GERMAN ones (pages.leistungen.seo). An unknown path renders empty.',
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
  { name: 'sw-add', syntax: '{{sw-add a b}}', summary: 'ARITHMETIC: a + b. Numeric strings count (a page.data value is often text); anything else counts as 0. The result is always a finite number — never NaN or Infinity, which would be invisible garbage inside an attribute. See also sw-sub/sw-mul/sw-div/sw-mod, and sw-ceil/sw-floor/sw-round/sw-min/sw-max.' },
  { name: 'sw-add-to-cart', syntax: '{{sw-add-to-cart sku= name= price= [image=] [label=] [class=]}}', summary: 'MINI SHOP: an add-to-cart button; the browser cart hands the order to a channel configured in website.shop. Prices are non-authoritative.' },
  { name: 'sw-blank', syntax: '{{#unless (sw-blank value)}}…{{/unless}}', summary: 'Boolean: does `value` have NO visible content? True for missing/whitespace text and for the empty richtext markup (<p></p>, <p><br></p>, &nbsp;) a cleared editor leaves behind; embedded media (img/svg/iframe/…) counts as content. Use to omit a wrapper around an empty optional field.' },
  { name: 'sw-cart', syntax: '{{sw-cart [class=]}}', summary: 'MINI SHOP: the cart button/widget (item count + collapsible order form); labels come from the reserved cart_* translation keys.' },
  { name: 'sw-ceil', syntax: '{{sw-ceil value}}', summary: 'ARITHMETIC: rounds UP to a whole number. The page COUNT of an archive is {{sw-ceil (sw-div total per_page)}}.' },
  { name: 'sw-concat', syntax: '{{sw-concat a b …}}', summary: 'STRING BUILD: the arguments joined into one string — Handlebars has no "+", and without this an author hard-codes the value instead. This is how you build a dynamic href, id or class: {{sw-url (sw-concat "/news-" (sw-add page.data.page_no 1))}}. null/undefined contribute nothing (never the text "undefined"); the result is HTML-escaped, so it is safe in text and in an attribute.' },
  { name: 'sw-consent-settings', syntax: '{{sw-consent-settings [label=] [class=]}}', summary: 'A button that RE-OPENS the consent preferences (e.g. a footer “Cookie settings” link; a plain <a href="#sw-consent"> works too). The banner itself auto-appears when website.consent.enabled — no placeholder needed. Label localizes via the reserved consent_settings key.' },
  { name: 'sw-default', syntax: '{{sw-default a b … fallback}}', summary: 'The FIRST argument that is actually present. Absence is null/undefined/"" ONLY — 0 and false are kept, because they are values a template means to print (the bug the JS || idiom causes). Use for a chain like {{sw-default page.data.subtitle website.data.tagline "Untitled"}}.' },
  { name: 'sw-control', syntax: '{{sw-control "path" as="type" [options/min/max/…]}}', summary: 'Content-editor-only inline CONTROL chip (text/number/color/date/select/…) bound to page.data.* or website.data.*. Renders the plain value on the published site.' },
  { name: 'sw-date', syntax: '{{sw-date value [format] [locale=]}}', summary: 'Formats a date. Default is UTC YYYY-MM-DD; "iso" (full ISO) / "YYYY" (year only); and the LOCALE formats "short" (21.08.2026), "medium" (21. Aug. 2026) and "long" (21. August 2026), rendered for the PAGE locale — use these for anything a reader sees, or a translated page prints ISO dates at them. locale= overrides; a bare "en" means en-GB (day-first) so a bilingual site does not mix 21 Aug with Aug 21 — ask for "en-US" explicitly. A value of "now" (or a bare {{sw-date}}) uses the current date — {{sw-date "now" "YYYY"}} renders the current year. Empty for an unparseable value.' },
  { name: 'sw-div', syntax: '{{sw-div a b}}', summary: 'ARITHMETIC: a ÷ b. Division by zero is 0, not Infinity. Wrap in {{sw-ceil}} for a page count.' },
  { name: 'sw-flag', syntax: '{{sw-flag "code" ["classes"]}}', summary: 'Inlines a FULL-COLOR country-flag SVG by ISO 3166-1 alpha-2 code (plus "eu"); "code-circle" for the round variant. The country name is its accessible label. For a DYNAMIC flag prefer a locale→country map: {{sw-flag (lookup @root.website.data.locale_flags locale)}} over a { en: "gb" } map — the map is the thing you want to edit, not a built-up string. ({{sw-icon (sw-concat "flag:" code)}} also works now that sw-concat exists.) Flags are a poor proxy for languages — map locale→country first. ({{sw-icon "flag:de"}} renders the same artwork; that spelling is what an icon NAME takes, e.g. a dataset `icon` field.)' },
  { name: 'sw-floor', syntax: '{{sw-floor value}}', summary: 'ARITHMETIC: rounds DOWN to a whole number.' },
  { name: 'sw-folder', syntax: '{{#sw-folder "name"}}…{{/sw-folder}}', summary: 'Block helper that loops the images of a media FOLDER (galleries); the block context is each image (url/alt/width/height).' },
  { name: 'sw-form', syntax: '{{sw-form "id"}}', summary: 'Embeds a configured web FORM by id (locale-suffix aware). Never hand-wire the endpoint; submissions land in the inbox.' },
  { name: 'sw-gt', syntax: '{{#if (sw-gt a b)}}…{{/if}}', summary: 'Boolean: is a > b, NUMERICALLY? A non-numeric operand is false rather than falling back to string order (where "10" < "9"). With sw-lt/sw-lte/sw-gte this is what makes a prev/next link conditional; eq/ne remain the strict equality pair.' },
  { name: 'sw-gte', syntax: '{{#if (sw-gte a b)}}…{{/if}}', summary: 'Boolean: is a ≥ b, numerically? See sw-gt.' },
  { name: 'sw-html', syntax: '{{sw-html value}}', summary: 'Outputs SANITIZED rich HTML from a value (safe-HTML allowlist incl. https-sandboxed iframes; script/on*/form stripped). For trusted rich-text fields.' },
  // NOTE: this used to say a bare name was a "Lucide line glyph" — it is not, and the icons guide,
  // search_icons and the import guide all said Phosphor. An agent following the contradiction picked the
  // wrong WEIGHT every time (the default is FILL, not a line glyph).
  { name: 'sw-group', syntax: '{{#each (sw-group list "field")}}{{key}} / {{#each items}}…{{/each}}{{/each}}', summary: 'LIST SHAPE: groups rows by a FIELD into {key, items} pairs, in first-seen order — sort the list first if you want a particular order (a calendar grouped by month is (sw-group (sw-sort dataset.events "starts") "month")). Rows with no value for the field are dropped rather than collected under an empty key. Reads dataset entries and plain objects alike.' },
  { name: 'sw-icon', syntax: '{{sw-icon "name[:weight]" ["classes"]}}', summary: 'Inlines an SVG icon — ONE helper for every built-in set. A BARE name is a PHOSPHOR glyph, FILLED by default; ":weight" picks thin|light|regular|bold|fill|duotone (e.g. "check:thin"). A Lucide name still works (it maps to its Phosphor twin, else renders as a Lucide outline). "brand:slug" is a themed brand/social logo (e.g. "brand:whatsapp"). "x" ≠ "brand:x". "flag:cc" / "flag:cc-circle" is a country flag (plus "flag:eu") — the spelling a flag takes as an icon NAME, which is what a picker stores (a dataset `icon` field, an image-map hotspot); to write one by hand in a template use {{sw-flag "de"}}, same artwork. Find names with search_icons (it matches country NAMES too — "germany" → flag:de).' },
  { name: 'sw-includes', syntax: '{{#if (sw-includes haystack needle)}}…{{/if}}', summary: 'Boolean: is `needle` in the list, or a substring of the string? Anything else is false. Use for a tag test — {{#if (sw-includes page.data.tags "sport")}}.' },
  { name: 'sw-image', syntax: '{{sw-image url [alt=] [sizes=] [class=] [loading=eager] [format=avif] [lightbox=true] [caption=]}}', summary: 'Responsive image for a PROJECT image (a delivery /media url, or a {{#sw-folder}}/dataset item url): emits an <img> with a WebP srcset, intrinsic width/height (no CLS), a blur-up LQIP, and loading=lazy. format=avif emits a <picture> with an AVIF tier. The server serves each size on demand; publish materializes only the referenced files. lightbox=true wraps the result in the <a href><img> pair a Lightbox gallery item needs — the anchor on the largest variant, the img keeping its own srcset; pair it with sizes= describing the tile width, or every thumbnail fetches the largest rung.' },
  { name: 'sw-imagemap', syntax: '{{sw-imagemap "id" [class=]}}', summary: 'Embeds a stored INTERACTIVE IMAGE MAP by id: an image or SVG with clickable/hoverable hotspots, rich tooltips, multiple artboards (floors/layers), zoom and a searchable object list. Renders the component wrapper, a no-JS fallback <img>, and the map config as a JSON data block. Drive it from elsewhere on the page with the data-sw-imap-* attributes.' },
  { name: 'sw-join', syntax: '{{sw-join list [separator] [field="name"]}}', summary: 'LIST → TEXT: joins a list with `separator` (default ", "). Read a FIELD off each row with the NAMED argument: {{sw-join dataset.staff ", " field="name"}} — named, not positional, because every other list helper puts the field SECOND and writing {{sw-join staff "name" ", "}} would otherwise join by the literal "name". Empty entries are dropped so a separator never dangles.' },
  { name: 'sw-json', syntax: '{{sw-json value}}', summary: 'Pretty-prints any value as indented JSON — for INSPECTING/DEBUGGING data (e.g. <pre>{{sw-json page.data}}</pre>). HTML-escaped like every binding, so NOT valid inside a <script type="application/ld+json"> block; use it to read, not to emit machine-parsed JSON. Empty for a missing/non-serializable value; length-capped.' },
  { name: 'sw-json-data', syntax: '{{sw-json-data value id="products" [fields="title,path,data.date"] [size="sm"] [type="application/ld+json"]}}', summary: 'HANDS DATA TO A SCRIPT: emits the value as an inert island — <script type="application/json" id="…">…</script> — read with JSON.parse(document.getElementById("…").textContent). The ONLY way to do this: a template may not interpolate inside a <script> body at all (a value there could close the tag), so the helper emits the whole element and escapes the payload. Use for a list the page filters/sorts/paginates client-side, a widget config, or your own ld+json. REFUSES with a visible HTML comment rather than emitting something wrong: a whole ambient namespace (pass a projection like dataset.products), a credential-shaped key, an unserializable value, or anything over 256 KB — for a list that big declare a website.dataFiles entry and fetch it instead. NARROW each row with fields= (comma-separated; DOTTED paths allowed and shape-preserving — "data.date" lands at {data:{date}}; a trailing ":N" caps a string field, so "description:130" carries exactly what a 130-character card shows) — a page-tree listing carries each child\'s whole data object and blows the cap without it. SIZE THE IMAGES with size="sm" (xs|sm|md|lg|xl): fields= can only PICK a field, never transform it, so an island carries an image URL with no size and the build publishes it at the DEFAULT variant — a script painting cards from the island then downloads the largest one. size= stamps the variant onto every media URL in the payload, which is also what makes the export MATERIALIZE it.' },
  { name: 'sw-label', syntax: '{{sw-label}}', summary: 'Renders the current nav item\'s (possibly rich, {{sw-icon}}-bearing) label inside {{#each nav.*}}.' },
  { name: 'sw-split', syntax: "{{#each (sw-split product.sizes ',')}}…{{/each}}", summary: 'A DELIMITED FIELD AS A LIST — a dataset holds a size run / tag list / option set as one text cell, because that is what an author can type, and without this a template can print the whole string or nothing. Separator defaults to a comma; pieces are trimmed and empties dropped, so "a, b,, c" and a trailing comma both behave. An array passes through; anything else yields an empty list.' },
  { name: 'sw-length', syntax: '{{sw-length list}}', summary: 'How many: an array\'s/string\'s length, an object\'s own-key count, else 0 (never NaN). For a listing that was capped, {{page.childrenTotal}} still reports the TRUE child count.' },
  { name: 'sw-limit', syntax: '{{#each (sw-limit list N)}}…{{/each}}', summary: 'LIST WINDOW: the first N items. Compose with sw-offset for an arbitrary window, or use sw-paginate. ★ A MISSING N leaves the list intact instead of emptying it — an over-long list is visibly wrong, an empty one reads as "nothing here". An explicit 0 is still 0.' },
  { name: 'sw-lt', syntax: '{{#if (sw-lt a b)}}…{{/if}}', summary: 'Boolean: is a < b, numerically? See sw-gt.' },
  { name: 'sw-lte', syntax: '{{#if (sw-lte a b)}}…{{/if}}', summary: 'Boolean: is a ≤ b, numerically? See sw-gt.' },
  { name: 'sw-max', syntax: '{{sw-max a b …}}', summary: 'ARITHMETIC: the largest of any number of arguments (non-numeric ones ignored; none at all → 0).' },
  { name: 'sw-min', syntax: '{{sw-min a b …}}', summary: 'ARITHMETIC: the smallest of any number of arguments (non-numeric ones ignored; none at all → 0).' },
  { name: 'sw-mod', syntax: '{{sw-mod a b}}', summary: 'ARITHMETIC: the remainder of a ÷ b (0 when b is 0). {{#if (eq (sw-mod @index 3) 0)}} starts a new row every third item.' },
  { name: 'sw-mul', syntax: '{{sw-mul a b}}', summary: 'ARITHMETIC: a × b. A product that overflows the float range is 0, never the literal text "Infinity".' },
  { name: 'sw-offset', syntax: '{{#each (sw-offset list N)}}…{{/each}}', summary: 'LIST WINDOW: everything AFTER the first N items. A missing N leaves the list intact (see sw-limit). N is a COUNT, not a position — a negative N is 0 (the whole list), so "all but the last three" is (sw-slice list 0 -3), not (sw-offset list -3).' },
  { name: 'sw-paginate', syntax: '{{#each (sw-paginate list pageNo perPage)}}…{{/each}}', summary: 'LIST WINDOW: page N of `perPage`-sized pages, 1-BASED. The pagination primitive — page 0/negative/missing is page 1, a page past the end is empty, so ONE template serves every page of an archive (give each page a `page.data.page_no`). Pair with pages.<slug>._attributes.children to paginate another page\'s child pages, or with dataset.<slug> for entries.' },
  { name: 'sw-pick-entry', syntax: '{{#sw-pick-entry dataset.<slug> "entry_id"}}…{{/sw-pick-entry}}  ·  (sw-pick-entry dataset.<slug> "entry_id")', summary: 'Selects ONE dataset entry by id as the block context (or as a subexpression) — for referencing a specific entry outside a loop. First argument is the ENTRIES themselves, dataset.<slug> (a bare "<slug>" string also works); second is the entry id, or a page.data key holding one. Unknown/missing id → the FIRST entry; empty dataset → the {{else}} branch. Fields read directly by name inside the block ({{photo}}, not {{values.photo}}).' },
  { name: 'sw-round', syntax: '{{sw-round value [decimals]}}', summary: 'ARITHMETIC: rounds to the nearest whole number, or to N decimals (max 10).' },
  { name: 'sw-search', syntax: '{{sw-search [placeholder=] [label=] [empty=] [class=] [limit=]}}', summary: 'Drops a full-text SITE SEARCH box: an input, a results list and an empty state. The publish build indexes every page body and emits a static index; the box fetches it on first use and renders a ranked list of PAGES — title, description and a snippet with the match highlighted. Quoted "exact phrases" are supported. Shared chrome (nav/footer) is never indexed, noindex pages never appear, and each locale gets its own index. Hand-write the data-sw-part markers instead when you need to own the layout — see the Search component in get_components.' },
  { name: 'sw-sort', syntax: '{{#each (sw-sort list "field" ["desc"])}}…{{/each}}', summary: 'LIST ORDER: a NEW list ordered by FIELD (the input is never mutated — the same list is often rendered elsewhere on the page). Numeric fields compare numerically, everything else as text, which is exactly right for the ISO dates the platform stores. Rows MISSING the field stay last in both directions — missing means absent, null OR empty string, so a blank dataset field is not treated as the smallest value.' },
  { name: 'sw-slice', syntax: '{{#each (sw-slice list start [end])}}…{{/each}}', summary: 'LIST WINDOW: the [start, end) slice, exactly like Array.prototype.slice — a NEGATIVE index counts from the end, so "the latest 3" is (sw-slice posts -3). Omit `end` to run to the end. A non-array yields nothing. For paging use sw-paginate; for a plain head/tail use sw-limit/sw-offset.' },
  { name: 'sw-where', syntax: '{{#each (sw-where list "field" ["op"] value)}}…{{/each}}', summary: 'LIST FILTER by a field — the predicate counterpart to sw-limit/sw-slice, which window by POSITION only. Ops: eq ne lt gt lte gte has (substring or list membership); the op may be omitted for eq. Numeric fields compare numerically, everything else as text, so ISO dates order correctly — and the literal value "now" resolves to today, which is how you ask for what is still ahead: (sw-limit (sw-where dataset.events "starts" "gte" "now") 4). Two ISO values compare at the COARSER granularity, so a date-only bound means the WHOLE day (an event at 09:00 today is still "ahead" until midnight) and two timestamps compare exactly. An UNKNOWN op matches NOTHING, never the unfiltered list.' },
  { name: 'sw-stagger', syntax: '{{sw-stagger @index [step] [max]}}', summary: 'The reveal DELAY in ms for item @index of a loop: index × step (default 100), capped at max (default 600) so a long list does not end up seconds behind. Use it inside {{#each}} to stagger a grid: data-sw-delay="{{sw-stagger @index 90}}". (General arithmetic now exists too — sw-mul/sw-min — but this one already applies the cap a long list needs.)' },
  { name: 'sw-sub', syntax: '{{sw-sub a b}}', summary: 'ARITHMETIC: a − b. See sw-add for the coercion and finite-result rules.' },
  { name: 'sw-theme-toggle', syntax: '{{sw-theme-toggle [class=]}}', summary: 'A light/dark THEME toggle button (no-flash, View-Transitions). Needs website.enableThemes.' },
  { name: 'sw-translate', syntax: '{{sw-translate "key" [default="…"]}}', summary: 'Outputs a translated string for the page locale from the website.translations CATALOG (read-only twin of the data-sw-translate directive); falls back default-locale → default= → empty. Escaped, so safe in text or an attribute.' },
  { name: 'sw-truncate', syntax: '{{sw-truncate text [N]}}', summary: 'Clips text to at most N characters (default 100), adding an ellipsis when clipped.' },
  { name: 'sw-url', syntax: '{{sw-url value}}', summary: 'Scheme-sanitizes a URL for an href/src (blocks javascript:/data:/protocol-relative) and rebases internal links at publish. ALWAYS use it for href/src.' },
];
