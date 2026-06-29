// The TEMPLATE REFERENCE: a static, in-repo guide to everything the code-first authoring surface
// gives an author — the curated Handlebars helpers, the `data-sw-*` editable directives, the binding
// namespaces, and the loop/system variables. Surfaced read-only in the Library side-panel
// (ReferenceModal).
//
// The Directives / Bindings / Variables tabs are DERIVED from the canonical registries in
// @sitewright/schema (SW_DIRECTIVES / BINDING_NAMESPACES / LOOP_VARIABLES), which drift tests in
// @sitewright/blocks pin to the engine's real behavior (the resolveDirectives attr set, the render
// context's author-facing keys, a live {{#each}} render) — so these tabs can't drift from what ships.
// The Helpers tab stays authored but is coverage-guarded by reference-sync.test against
// `registeredSwHelpers()`. Expressions / Block helpers / Partials / Effects are language built-ins +
// CSS conventions with no runtime registry, so they remain authored here.
import {
  SW_DIRECTIVES,
  BINDING_NAMESPACES,
  LOOP_VARIABLES,
  type SwDirective,
  type BindingDoc,
  type LoopVariable,
} from '@sitewright/schema';

export interface ReferenceArg {
  name: string;
  desc: string;
}

export interface ReferenceEntry {
  /** Stable, group-scoped id. */
  id: string;
  /** The prominent monospace signature (also the copy target). */
  syntax: string;
  /** Short title / primary search term. */
  name: string;
  keywords?: string;
  description: string;
  /** Named arguments/parts, when the entry takes any. */
  args?: ReferenceArg[];
  /** A copyable example snippet. */
  example?: string;
  /** A caveat or cross-reference. */
  note?: string;
  /** Suppress the Copy button (for "don't do this" entries with nothing worth copying). */
  noCopy?: boolean;
}

export interface ReferenceGroup {
  id: string;
  title: string;
  blurb: string;
  entries: ReferenceEntry[];
}

// Registry → ReferenceEntry. The registry items carry exactly the displayable fields (id/syntax/name/
// keywords/description/example/note) plus a discriminator the docs don't render (attr · namespace ·
// source), so the rendered entry is the registry content verbatim — nothing to hand-maintain here.
// NOTE: this projects a fixed field set. If a registry type ever gains a NEW displayable field, add
// it to ReferenceEntry AND mirror it here, or it will be silently dropped from the rendered docs.
function toReferenceEntry(r: SwDirective | BindingDoc | LoopVariable): ReferenceEntry {
  return {
    id: r.id,
    syntax: r.syntax,
    name: r.name,
    keywords: r.keywords,
    description: r.description,
    example: r.example,
    note: r.note,
  };
}

export const REFERENCE_GROUPS: ReferenceGroup[] = [
  {
    id: 'expressions',
    title: 'Output & expressions',
    blurb: 'Print a bound value. Output is always HTML-escaped — raw output (triple-stache) is disabled.',
    entries: [
      {
        id: 'expr-output',
        syntax: '{{ value }}',
        name: 'Output a value',
        keywords: 'expression interpolate print escape',
        description: 'Prints a bound value, HTML-escaped so it can never inject markup. Read a nested value with a dotted path.',
        example: '<h1>{{ company.name }}</h1>\n<p>{{ page.title }}</p>',
      },
      {
        id: 'expr-raw',
        syntax: '{{{ raw }}}',
        name: 'Raw output — not allowed',
        keywords: 'triple stache raw html unescaped forbidden',
        description:
          'Triple-stache raw output is REJECTED by the template validator (it would be an XSS hole). To emit rich HTML, use the data-sw-html directive (sanitized) or an Html block.',
        noCopy: true,
      },
    ],
  },
  {
    id: 'helpers',
    title: 'Helpers',
    blurb: 'Curated inline helpers. (Tenants cannot register their own — these are the whole set.)',
    entries: [
      {
        id: 'h-url',
        syntax: '{{sw-url value}}',
        name: 'sw-url',
        keywords: 'link href src safe sanitize url',
        description:
          'Scheme-sanitizes a URL for an href/src (blocks javascript:/data:/protocol-relative). Always use it for href/src. (Internal root-relative links are additionally rebased to a portable path by the publish pipeline.) The sw- prefix keeps it clear of dataset fields named "url".',
        args: [{ name: 'value', desc: 'A URL or root-relative path.' }],
        example: '<a href="{{sw-url \'/about\'}}">About</a>\n<img src="{{sw-url image}}" alt="">',
      },
      {
        id: 'h-date',
        syntax: '{{sw-date value [format]}}',
        name: 'sw-date',
        keywords: 'time format iso date',
        description: 'Formats a date as UTC YYYY-MM-DD, or the full ISO string with "iso". Empty for an unparseable value.',
        args: [
          { name: 'value', desc: 'A date string, number, or Date.' },
          { name: 'format', desc: 'Optional — "iso" for the full ISO timestamp.' },
        ],
        example: '{{sw-date published}}\n{{sw-date published "iso"}}',
      },
      {
        id: 'h-icon',
        syntax: '{{sw-icon "name" ["classes"]}}',
        name: 'sw-icon',
        keywords: 'svg lucide glyph icon brand logo social whatsapp github',
        description:
          'Inlines a built-in icon as an SVG. A BARE name is a Lucide line glyph — browse names in the Library → Icons gallery (click one to copy its snippet). A "brand:slug" name is a filled brand/social logo (e.g. "brand:whatsapp", "brand:github", "brand:x") that themes to the current text color. The two are distinct: "whatsapp" alone is NOT the logo — you need the "brand:" prefix. Social profiles store the full name for you, so {{sw-icon icon}} over company.social just works. The sw- prefix keeps it out of the dataset FIELD namespace, so a field named "icon" is read plainly as {{icon}}.',
        args: [
          { name: 'name', desc: 'A Lucide name (e.g. "arrow-right"), or "brand:slug" for a brand logo (e.g. "brand:x").' },
          { name: 'classes', desc: 'Optional Tailwind classes (default "h-5 w-5").' },
        ],
        example:
          '{{sw-icon "arrow-right" "h-4 w-4"}}\n' +
          '{{sw-icon "brand:whatsapp"}}\n' +
          '\n' +
          '{{#each company.social}}\n' +
          '  {{sw-icon icon}}\n' +
          '{{/each}}',
      },
      {
        id: 'h-flag',
        syntax: '{{sw-flag "code" ["classes"]}}',
        name: 'sw-flag',
        keywords: 'flag country nation language locale region svg de us gb circle',
        description:
          'Inlines a FULL-COLOR country flag as an SVG (its own colors — unlike sw-icon it is NOT themeable, which is why it is a separate helper). The argument is an ISO 3166-1 alpha-2 country code: a bare code is the rectangular 4:3 flag; a "code-circle" suffix is the round variant (e.g. "de-circle"). Browse them in the Library → Country flags gallery. The country name becomes the accessible label. Tip: flags are a poor proxy for LANGUAGES (Spanish ≠ Spain) — prefer them for country/region selectors, and pass an explicit country code per locale in a language switcher.',
        args: [
          { name: 'code', desc: 'An ISO alpha-2 country code ("de", "us", "gb"), or "code-circle" for the round flag.' },
          { name: 'classes', desc: 'Optional Tailwind classes (default "h-4"; circular default "h-5 w-5").' },
        ],
        example:
          '{{sw-flag "de" "h-4 rounded-sm"}}\n' +
          '{{sw-flag "jp-circle"}}',
        note: 'Building a language switcher? See the “multilingual (i18n)” entry — map each locale to a COUNTRY code first ({{sw-flag}} wants a country, so en→gb, pt-BR→br, uk→ua), don’t pass the locale straight in.',
      },
      {
        id: 'h-truncate',
        syntax: '{{sw-truncate text N}}',
        name: 'sw-truncate',
        keywords: 'clip ellipsis shorten truncate',
        description: 'Clips text to at most N characters, adding an ellipsis when clipped.',
        args: [
          { name: 'text', desc: 'The string to clip.' },
          { name: 'N', desc: 'Maximum length (default 100).' },
        ],
        example: '<p>{{sw-truncate summary 80}}</p>',
      },
      {
        id: 'h-active',
        syntax: '{{#if (sw-active path)}}…{{/if}}',
        name: 'sw-active',
        keywords: 'nav navbar active current page highlight menu aria-current trail',
        description:
          'Highlights the current page in a menu — returns a BOOLEAN for use in #if, comparing a route to the page being rendered (no JS; resolved at build, works in the live preview too). By DEFAULT it matches the ACTIVE TRAIL: a parent/dropdown route stays active while you are on one of its children (so "/services" is active on "/services/web-design"). Pass exact=true to match the current page ONLY — use that for aria-current="page". Both routes are root-relative; a home route — the root "/" or a locale home like "/es" on a localized page — only matches itself. Pair it with the auto-nav: inside {{#each nav.header}} the item route is `path`.',
        args: [
          { name: 'path', desc: 'A root-relative route, e.g. "/about" or the nav item\'s `path`.' },
          { name: 'exact', desc: 'Optional hash — exact=true matches the current page only (no ancestor/trail).' },
        ],
        example:
          '{{#each nav.header}}\n' +
          '  <li><a href="{{sw-url path}}"\n' +
          '         class="{{#if (sw-active path)}}active{{/if}}"\n' +
          '         {{#if (sw-active path exact=true)}}aria-current="page"{{/if}}>{{sw-label}}</a></li>\n' +
          '{{/each}}',
        note: 'The route must be root-relative (start with "/"). The .active class is what a nav EFFECT (sw-nav-*) styles — see “Nav & button effects”. The trail default lights a dropdown parent while you are on a child; pass exact=true (unquoted, not "true") for a leaf-only highlight — and use it for aria-current="page", omitting the attribute on non-current items.',
      },
      {
        id: 'h-blank',
        syntax: '{{#unless (sw-blank value)}}…{{/unless}}',
        name: 'sw-blank',
        keywords: 'empty blank optional caption hide wrapper conditional richtext whitespace',
        description:
          'Returns a BOOLEAN: does `value` have NO visible content? True when it is missing, whitespace-only, or the empty richtext markup a cleared WYSIWYG editor leaves behind (<p></p>, <p><br></p>, &nbsp;) — which a plain {{#if}} would wrongly treat as truthy. Embedded media (img/svg/iframe/video/…) counts as content, so an image-only value is NOT blank. No JS — resolved at build (works in the live preview too). Use it with {{#unless}} to OMIT a wrapper/box around an empty optional field, so it never ships an empty panel.',
        args: [{ name: 'value', desc: 'A text or richtext value, e.g. an optional caption or dataset field.' }],
        example:
          '{{#each slides}}\n' +
          '  {{#unless (sw-blank caption)}}\n' +
          '    <div class="caption-pill">{{sw-html caption}}</div>\n' +
          '  {{/unless}}\n' +
          '{{/each}}',
        note: 'This is exactly how the Hero slider widget hides a slide’s caption pill when that slide has no caption. Reach for {{#if value}} only for plain text; for an optional richtext field use {{#unless (sw-blank value)}} so cleared-editor residue doesn’t render an empty box.',
      },
      {
        id: 'h-translate',
        syntax: '{{sw-translate "key" [default="…"]}}',
        name: 'sw-translate',
        keywords: 'translate i18n locale translation localize string label multilingual',
        description:
          'Outputs a translated string for the current page locale from the project translation catalog (website.translations), falling back to the default locale, then to default=, then to empty. No JS — resolved at build (works in the live preview too). The output is escaped, so it is safe in text OR an attribute (alt / aria-label / placeholder / title). The catalog is a dedicated per-locale table, separate from website.data.',
        args: [
          { name: 'key', desc: 'The translation key — an identifier like nav_cta or cart_title.' },
          { name: 'default', desc: 'Optional hash — text shown when the key has no value in any locale.' },
        ],
        example: '<a href="{{sw-url "/contact"}}">{{sw-translate "nav_contact" default="Contact"}}</a>',
        note: 'Translations live in the project translation catalog (website.translations), NOT in website.data. A missing/empty cell falls back to the default-locale string, so untranslated locales never render blank.',
      },
      {
        id: 'h-add-to-cart',
        syntax: '{{sw-add-to-cart sku= name= price= [image=] [label=] [class=]}}',
        name: 'sw-add-to-cart',
        keywords: 'shop cart ecommerce buy product add basket order',
        description:
          'MINI SHOP: an “add to cart” button for a product. The browser cart (see {{sw-cart}}) tracks it and hands the order to a channel configured in Settings → Website → Shop. Prices are non-authoritative — it sends an order inquiry. Use it inside a products loop, e.g. {{#each dataset.products}}.',
        args: [
          { name: 'sku', desc: 'Stable product key (falls back to name); dedupes in the cart.' },
          { name: 'name', desc: 'Product name shown in the cart + order.' },
          { name: 'price', desc: 'A number; the cart formats it with the configured currency.' },
          { name: 'image', desc: 'Optional product image URL.' },
          { name: 'label', desc: 'Optional per-button text. Falls back to the site-wide Shop settings label, then to “Add to cart”.' },
          { name: 'class', desc: 'Optional CSS classes for the button.' },
        ],
        example:
          '{{#each dataset.products}}\n' +
          '  <div class="card">{{name}}\n' +
          '    {{sw-add-to-cart sku=sku name=name price=price image=image class="btn btn-primary btn-sm"}}\n' +
          '  </div>\n' +
          '{{/each}}',
        note: 'Configure the currency + checkout channels (WhatsApp / email / payment link / order form) in Settings → Website → Shop, or use the global:shop page template.',
      },
      {
        id: 'h-cart',
        syntax: '{{sw-cart}}',
        name: 'sw-cart',
        keywords: 'shop cart drawer checkout basket ecommerce order',
        description:
          'MINI SHOP: the cart mount — a floating cart button + a drawer (line items, total, the checkout channel buttons). Drop it ONCE per site (e.g. in the footer slot) so it shows on every page; it reads the currency + channels from Settings → Website → Shop. A WhatsApp/email channel can ask for buyer details first (name, address…) — add them under that channel’s “Order fields” in Shop settings; they’re appended to the message as “Label: value” lines below the order, and an email order opens with “Hi <brand> — I’d like to order:”.',
        example: '{{sw-cart}}',
        note: 'The cart is FRONT-END only (localStorage) — it sends an order inquiry, not a charge. The runtime ships only on pages that use the shop.',
      },
      {
        id: 'h-consent',
        syntax: '{{sw-consent}}',
        name: 'sw-consent',
        keywords: 'cookie consent banner gdpr privacy preferences categories analytics marketing tracking',
        description:
          'CONSENT MANAGER: the cookie-consent banner — first layer (Accept all / Reject all / Customize) plus an expandable preferences panel with per-category toggles (Strictly necessary, Functional, Analytics, Marketing; necessary is always on). The choice is remembered in localStorage and re-prompts when you bump the version. Enable it under Settings → Website → Consent; with consent OFF it renders nothing, so it is safe to leave in. Drop it ONCE in the bottom slot. All copy localizes via the reserved consent_* translation keys.',
        example: '{{sw-consent}}',
        note: 'Front-end only. It broadcasts the decision (a `sw:consentchange` event + `window.swConsent`) so third-party scripts/embeds can gate on it; the actual gating arrives in a later update. The runtime ships only on sites that use it.',
      },
      {
        id: 'h-consent-settings',
        syntax: '{{sw-consent-settings [label="…"] [class="…"]}}',
        name: 'sw-consent-settings',
        keywords: 'cookie settings consent reopen preferences withdraw manage privacy',
        description:
          'A button that RE-OPENS the consent preferences (for a footer “Cookie settings” link so visitors can change or withdraw consent). Needs consent enabled; with it off it renders nothing. The label localizes via the reserved `consent_settings` key.',
        example: '{{sw-consent-settings class="link"}}',
        note: 'Pairs with {{sw-consent}}. Any element carrying data-sw-consent-open re-opens the banner too.',
      },
      {
        id: 'h-theme-toggle',
        syntax: '{{sw-theme-toggle [label="…"] [class="…"]}}',
        name: 'sw-theme-toggle',
        keywords: 'dark light mode theme toggle color scheme switch night sun moon',
        description:
          'A light/dark toggle button for the opt-in THEMES feature (turn it on in Settings → Website → “Themes (light / dark)”, where you also pick the default theme). It shows a sun/moon icon for the active theme, and on click flips the whole site between light and dark and remembers the visitor’s choice. With themes OFF it renders nothing, so it is safe to leave in the template. Drop it ONCE in the nav/header slot. The accessible label localizes via the reserved `theme_toggle` translation key.',
        example: '{{sw-theme-toggle class="btn btn-ghost btn-circle"}}',
        note: 'Dark mode works WITHOUT this button (the default theme — or each visitor’s OS preference on “auto” — already applies); the toggle just lets visitors override it. It only appears, and its tiny runtime only ships, when themes are enabled.',
      },
      {
        id: 'h-folder',
        syntax: '{{#sw-folder "path" [kind="image|file|all"] [recursive=false] [sort="name|name-desc"]}}…{{else}}…{{/sw-folder}}',
        name: 'sw-folder',
        keywords: 'gallery images media folder files iterate loop assets photos',
        description:
          'Loops the media files in a FOLDER (images by default) — for galleries and file lists. The "path" is a folder from the Files manager (a subfolder like "products/2024" works), or a variable (e.g. a value a client set in page data). Each iteration binds the asset as the context: {{url}}, {{alt}}, {{filename}}, {{kind}}, {{width}}, {{height}}, plus {{@index}}/{{@first}}/{{@last}}. An empty folder renders the {{else}} block.',
        args: [
          { name: 'path', desc: 'The media folder to iterate (e.g. "gallery" or "docs/2024"). May be a variable like page.data.gallery_folder.' },
          { name: 'kind', desc: 'Optional — "image" (default), "file" (non-image uploads), or "all".' },
          { name: 'recursive', desc: 'Optional — true to include subfolders (default false).' },
          { name: 'sort', desc: 'Optional — "name" (default, A→Z) or "name-desc".' },
        ],
        example:
          '<div class="grid grid-cols-3 gap-3">\n' +
          '  {{#sw-folder "gallery"}}\n' +
          '    <img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy">\n' +
          '  {{else}}\n' +
          '    <p>No images yet.</p>\n' +
          '  {{/sw-folder}}\n' +
          '</div>',
        note: 'Bind the image src with {{sw-url url}} (a raw {{url}} in src/href is rejected). Upload + organize files in the Files manager — the preview reflects the folder immediately, and publish bakes the images into the static output.',
      },
      {
        id: 'h-control',
        syntax: '{{sw-control target="page.title|page.image|page.description|<page.data key>" as="text|textarea|url|number|color|date|image|file|select|folder|dataset" [options="a,b,c"] label="…"}}',
        name: 'sw-control',
        keywords: 'control settings client editor title og image folder dataset select number color date content directive',
        description:
          'A CONTENT-EDITOR-ONLY control: drops a chip (shown ONLY in the Content Editor, never on the published site) that lets a client set a whitelisted PAGE value — the page title, the meta description, or the OG/share image — or a page.data value, from inside the live preview. Pair it with other helpers: set a FOLDER name (as="folder") an {{#sw-folder}} gallery reads, or a DATASET name (as="dataset") an {{#each}} loops.',
        args: [
          { name: 'target', desc: 'What to set: page.title, page.image, page.description; a page.data value (bare "gallery_folder" = top-level, or nested "page.data.article.title"); or a GLOBAL "website.data.<path>".' },
          { name: 'as', desc: 'The input: text (default), textarea, url, number, color, date, image (file picker, images), file (file picker, any uploaded file), select (a dropdown of your own options), folder (a dropdown of media folders), or dataset (a dropdown of datasets). An unknown value is an error — it will NOT silently fall back to a text box.' },
          { name: 'options', desc: 'For as="select" ONLY: a comma-separated list of choices, e.g. "Draft, Published, Archived". Required for select (a select with no options is rejected).' },
          { name: 'label', desc: 'Optional chip label (defaults to the target).' },
        ],
        example:
          '{{! a client picks the gallery folder; the gallery below reads it }}\n' +
          '{{sw-control target="gallery_folder" as="folder" label="Gallery folder"}}\n' +
          '{{#sw-folder page.data.gallery_folder}}<img src="{{sw-url url}}" alt="{{alt}}">{{/sw-folder}}\n' +
          '{{! a fixed choice list }}\n' +
          '{{sw-control target="page.data.status" as="select" options="Draft, Published, Archived" label="Status"}}',
        note: 'Renders nothing for a non-settable target. page/page.data targets write the page draft (saved with everything else); a website.data target writes the GLOBAL store (auto-saved). REMOVED entirely from the published HTML.',
      },
      {
        id: 'h-lookup',
        syntax: '{{lookup obj key}}',
        name: 'lookup',
        keywords: 'dynamic property index',
        description: 'Built-in: reads a property of an object by a (possibly dynamic) key.',
        example: '{{lookup company.colors "primary"}}',
      },
      {
        id: 'h-html',
        syntax: '{{sw-html value}}',
        name: 'sw-html',
        keywords: 'html richtext sanitize markup body content stored iframe embed',
        description:
          'Emits a stored HTML value (a dataset richtext field, nested page.data HTML) as SANITIZED HTML — broad safe HTML incl. https-sandboxed iframe embeds; <script>, on* handlers, and data-* attributes are always stripped. This is the ONE way a template renders stored markup — raw {{{…}}} is banned. Non-strings render nothing. Use in element context. (Formerly the sw-rich helper.)',
        args: [{ name: 'value', desc: 'An HTML string (e.g. an entry’s body field).' }],
        example: '{{#each dataset.posts}}\n  <article class="prose">{{sw-html body}}</article>\n{{/each}}',
      },
      {
        id: 'h-form',
        syntax: '{{sw-form "id" [class=…]}}',
        name: 'sw-form',
        keywords: 'form contact embed submit fields newsletter',
        description:
          'Embeds a configured Form by its id — the form markup is generated for you (no fields to author). Locale-aware: on a translated page it resolves the localized variant. Errors at render if the id is unknown.',
        args: [
          { name: '"id"', desc: 'The Form id (from the Forms tab).' },
          { name: 'class=', desc: 'Optional CSS classes for the <form> wrapper.' },
        ],
        example: '{{sw-form "contact"}}\n{{sw-form "newsletter" class="mx-auto max-w-md"}}',
        note: 'You can also embed by attribute: <div data-sw-form="contact"></div>.',
      },
      {
        id: 'h-label',
        syntax: '{{sw-label}}',
        name: 'sw-label',
        keywords: 'nav menu item label title link icon',
        description:
          'Inside a nav / menu item loop, renders the current item’s label — its labelHtml (e.g. icon + text, already safe) when present, else the plain label (escaped). Put it in the item’s text position.',
        example: '{{#each nav.header}}\n  <a href="{{sw-url path}}">{{sw-label}}</a>\n{{/each}}',
      },
      {
        id: 'h-pick-entry',
        syntax: '{{#with (sw-pick-entry dataset.<slug> <id>)}}…{{/with}}',
        name: 'sw-pick-entry',
        keywords: 'dataset entry pick choose widget config selection with',
        description:
          'Picks ONE dataset entry’s values by id (defaulting to the FIRST entry when the id is unset/unknown), so a #with body binds that entry’s fields. Used to render a chosen config out of several (e.g. a widget picking its settings). An empty dataset → #with renders nothing.',
        args: [
          { name: 'dataset.<slug>', desc: 'The dataset to pick from.' },
          { name: '<id>', desc: 'The chosen entry id (e.g. a key set by a {{sw-control as="dataset-item"}} picker).' },
        ],
        example: '{{#with (sw-pick-entry dataset.hero @root.page.data.hero_config)}}\n  <h1>{{headline}}</h1>\n{{/with}}',
      },
    ],
  },
  {
    id: 'blocks',
    title: 'Block helpers',
    blurb: 'Loops and conditionals. Close each with its matching {{/…}}.',
    entries: [
      {
        id: 'b-each',
        syntax: '{{#each items}} … {{else}} … {{/each}}',
        name: 'each',
        keywords: 'loop iterate list array for dataset entries rows click edit',
        description:
          'The one loop helper. Over a plain list or object, the item is this and you get @index, @key, @first, @last; {{else}} renders for an empty list. Over a DATASET (dataset.<set>) it is dataset-aware: each iteration’s context is the entry’s FIELDS — read {{title}} directly (no values. prefix) — the entry envelope is on @entry (@entry.id, @entry.dataset), and in the editor each rendered row is click-to-edit (clicking opens that entry’s editor). No separate helper — just loop the dataset.',
        args: [{ name: 'items', desc: 'A list/object, a dataset (dataset.<set>), nav.<slot>, page.children, or a website.data/page.data array.' }],
        example:
          '{{! A dataset — fields are read directly, rows are click-to-edit: }}\n' +
          '{{#each dataset.services}}\n' +
          '  <div class="card">\n' +
          '    <h3>{{title}}</h3>\n' +
          '    <p>{{summary}}</p>\n' +
          '  </div>\n' +
          '{{else}}\n' +
          '  <p>No services yet.</p>\n' +
          '{{/each}}\n' +
          '\n' +
          '{{! A plain list — the item is this: }}\n' +
          '<ul>\n' +
          '  {{#each nav.header}}\n' +
          '    <li><a href="{{sw-url path}}">{{sw-label}}</a></li>\n' +
          '  {{/each}}\n' +
          '</ul>',
        note: 'All content helpers are prefixed (sw-url, sw-date, sw-icon, sw-flag, sw-truncate), so entry fields never collide with them — read them plainly. ({{this.field}} forces a data lookup if you ever need it.)',
      },
      {
        id: 'b-if',
        syntax: '{{#if cond}} … {{else}} … {{/if}}',
        name: 'if',
        keywords: 'conditional branch when',
        description: 'Renders the block when cond is truthy; the optional {{else}} renders otherwise.',
        example:
          '{{#if page.translations}}\n' +
          '  <nav aria-label="Language">…</nav>\n' +
          '{{/if}}',
      },
      {
        id: 'b-unless',
        syntax: '{{#unless cond}} … {{/unless}}',
        name: 'unless',
        keywords: 'conditional inverse not',
        description: 'Renders the block when cond is FALSY (the inverse of {{#if}}).',
        example:
          '{{#unless soldOut}}\n' +
          '  <button class="btn">Buy</button>\n' +
          '{{/unless}}',
      },
      {
        id: 'b-with',
        syntax: '{{#with obj}} … {{/with}}',
        name: 'with',
        keywords: 'scope context this',
        description: 'Scopes the block to obj, so its members can be read directly (as this).',
        example:
          '{{#with company}}\n' +
          '  <p>{{name}} — {{email}}</p>\n' +
          '{{/with}}',
      },
      {
        id: 'b-eq',
        syntax: '{{#if (eq a b)}} … {{/if}}',
        name: 'eq / ne',
        keywords: 'equal equals compare comparison conditional if active match ne not-equal',
        description:
          'Strict (===) equality / inequality SUBEXPRESSION helpers — Handlebars has no built-in comparison, and a template that calls a helper that does not exist HARD-FAILS the render. Use {{#if (eq a b)}} / {{#if (ne a b)}} (or inline in an attribute) to render conditionally on a value, e.g. highlight one item in a loop. Compares by value, so compare like-with-like (string↔string, number↔number). For "is this the current page?" prefer {{#if (sw-active path)}} (route-aware trail matching) over eq.',
        example:
          '{{#each dataset.plans}}\n' +
          '  <div class="card {{#if (eq this.tier \'pro\')}}ring-2 ring-primary{{/if}}">{{title}}</div>\n' +
          '{{/each}}',
        note: 'For nav active-state use sw-active (it matches the active trail + handles locale homes); eq/ne are for general value comparisons.',
      },
    ],
  },
  {
    id: 'partials',
    title: 'Partials & comments',
    blurb: 'Compose reusable snippets and annotate the source.',
    entries: [
      {
        id: 'p-partial',
        syntax: '{{> snippet-name}}',
        name: 'Partial / snippet',
        keywords: 'include reuse component snippet partial',
        description: 'Includes a reusable snippet by name. Create and manage snippets in the Snippets panel.',
        example: '{{> site-cta}}',
      },
      {
        id: 'p-comment',
        syntax: '{{! comment }}   {{!-- comment --}}',
        name: 'Comment',
        keywords: 'note remark hide',
        description: 'A template comment — never rendered. The {{!-- --}} form may contain mustaches.',
        example: '{{!-- TODO: wire the pricing dataset --}}',
      },
    ],
  },
  {
    id: 'directives',
    title: 'Editable directives (data-sw-*)',
    blurb:
      'Put these on REAL elements to make them click-to-edit in the live preview (data-sw-entry is the one exception — it is added automatically). They are stripped from the published HTML; an empty value reverts to the element’s authored default.',
    entries: SW_DIRECTIVES.map(toReferenceEntry),
  },
  {
    id: 'bindings',
    title: 'Binding namespaces',
    blurb: 'The data you can read with {{ … }}. Edit the sources in Settings and the Data panel.',
    entries: BINDING_NAMESPACES.map(toReferenceEntry),
  },
  {
    id: 'variables',
    title: 'System variables',
    blurb: 'Loop counters + context navigation — mostly inside {{#each}} / {{#with}} (and @root from anywhere).',
    entries: LOOP_VARIABLES.map(toReferenceEntry),
  },
  {
    id: 'effects',
    title: 'Nav & button effects',
    blurb:
      'CI-themed, contrast-safe hover/active schemes. Pick them in Website settings (no code, site-wide) or add a sw-nav-* / sw-btn-* class per element. The CSS tree-shakes per scheme.',
    entries: [
      {
        id: 'fx-nav',
        syntax:
          'sw-nav-box-solid | -box-fill-left | -box-fill-up | -box-draw | -box-shadow | -line-bottom | -line-sliding-bottom | -line-top-down | -line-squiggle | -sliding-pill | -glass-pill | -dot-to-pill | -highlighter | -brackets | -brackets-curly | -blob | -chevron | -corner-ticks | -spotlight-sliding',
        name: 'Nav effects (sw-nav-*)',
        keywords:
          'nav navbar menu active current effect scheme hover underline line bottom pill box fill draw shadow brackets chevron blob highlighter spotlight squiggle dot appearance',
        description:
          'Active + hover styling for the nav links INSIDE A .menu (a brand mark, CTA or language flags sitting outside a .menu are left alone). Mark the current item with the .active class — e.g. {{#if (sw-active path)}}active{{/if}} — and/or aria-current="page". Colors come from the brand and stay legible in the built-in dark theme (they read the --sw-color-* tokens). The fill schemes (box-solid / box-fill-* / dot-to-pill) invert the label to the WCAG-derived brand foreground; the line / bracket / outline schemes keep the readable nav text and add a brand accent. Three schemes — line-sliding-bottom, sliding-pill and spotlight-sliding — load a tiny runtime automatically (a shared indicator that slides between items, or a glow that follows the cursor). Set the scheme in Website settings (applies everywhere), or add the class to a single <ul> for a one-off.',
        example:
          '{{! Website settings → Nav effect, OR per-nav: }}\n' +
          '<ul class="menu menu-horizontal sw-nav-box-solid">{{#each nav.header}}\n' +
          '  <li><a href="{{sw-url path}}"\n' +
          '         class="{{#if (sw-active path)}}active{{/if}}"\n' +
          '         {{#if (sw-active path exact=true)}}aria-current="page"{{/if}}>{{label}}</a></li>\n' +
          '{{/each}}</ul>',
        note: 'Every scheme keeps WCAG contrast for ANY brand color and flips correctly in dark mode. Want your own scheme? Leave Nav effect "None" in Website settings and write it in Custom CSS (target .active / the nav links).',
      },
      {
        id: 'fx-btn',
        syntax: 'sw-btn-fx-<effect> · sw-btn-accent-<role> · sw-btn-shape-<shape>',
        name: 'Button effects (sw-btn-*)',
        keywords:
          'button btn effect hover ripple fill lift glow shape accent pill sharp cut skewed pulse ring motion animation appearance state',
        description:
          'Every .btn has a baseline: a ripple on click, a hover lift + shadow, and a background fill to the hover ACCENT (default secondary). Layer three independent axes — EFFECT sw-btn-fx-<name> (lift, glow, fill-slide, two-tone, …28), ACCENT sw-btn-accent-<primary|secondary|accent|neutral>, SHAPE sw-btn-shape-<rounded|soft|sharp|pill|cut|skewed|square|circle>. The FACE is the daisyUI variant (btn-primary / btn-ghost / btn-outline / btn-soft). Set site-wide defaults in Website settings, or add a class to a single button to override that axis. Motion respects prefers-reduced-motion.',
        example:
          '<button class="btn btn-primary sw-btn-fx-fill-slide sw-btn-shape-pill">Get started</button>\n' +
          '<a class="btn btn-ghost sw-btn-fx-outline-fill sw-btn-accent-primary" href="/contact">Contact</a>',
        note: 'Pick ONE sw-btn-fx-* per button (each manages its own transition). A per-button class overrides the site default for that axis only. The ripple + magnetic/spotlight load a tiny runtime automatically.',
      },
    ],
  },
];
