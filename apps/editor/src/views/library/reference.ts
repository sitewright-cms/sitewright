// The TEMPLATE REFERENCE: a static, in-repo guide to everything the code-first authoring surface
// gives an author — the curated Handlebars helpers, the `data-sw-*` editable directives, the binding
// namespaces, and the loop/system variables. Surfaced read-only in the Library side-panel
// (ReferenceModal). Keep this in sync with packages/blocks/src/template.ts (helpers), directives.ts
// (directives), and the preview render context in apps/api/src/http/app.ts (bindings).

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
        id: 'h-add-to-cart',
        syntax: '{{sw-add-to-cart sku= name= price= [image=] [label=] [class=]}}',
        name: 'sw-add-to-cart',
        keywords: 'shop cart ecommerce buy product add basket order',
        description:
          'MINI SHOP: an “add to cart” button for a product. The browser cart (see {{sw-cart}}) tracks it and hands the order to a channel configured in Settings → Website → Shop. Prices are non-authoritative — it sends an order inquiry. Use it inside a products loop, e.g. {{#each data.products}}.',
        args: [
          { name: 'sku', desc: 'Stable product key (falls back to name); dedupes in the cart.' },
          { name: 'name', desc: 'Product name shown in the cart + order.' },
          { name: 'price', desc: 'A number; the cart formats it with the configured currency.' },
          { name: 'image', desc: 'Optional product image URL.' },
          { name: 'label', desc: 'Optional per-button text. Falls back to the site-wide Shop settings label, then to “Add to cart”.' },
          { name: 'class', desc: 'Optional CSS classes for the button.' },
        ],
        example:
          '{{#each data.products}}\n' +
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
          'MINI SHOP: the cart mount — a floating cart button + a drawer (line items, subtotal, the checkout channel buttons). Drop it ONCE per site (e.g. in the footer slot) so it shows on every page; it reads the currency + channels from Settings → Website → Shop.',
        example: '{{sw-cart}}',
        note: 'The cart is FRONT-END only (localStorage) — it sends an order inquiry, not a charge. The runtime ships only on pages that use the shop.',
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
        syntax: '{{sw-control target="page.title|page.image|page.description|<page.data key>" as="text|textarea|url|image|file|folder|dataset" label="…"}}',
        name: 'sw-control',
        keywords: 'control settings client editor title og image folder dataset content directive',
        description:
          'A CONTENT-EDITOR-ONLY control: drops a chip (shown ONLY in the Content Editor, never on the published site) that lets a client set a whitelisted PAGE value — the page title, the meta description, or the OG/share image — or a page.data value, from inside the live preview. Pair it with other helpers: set a FOLDER name (as="folder") an {{#sw-folder}} gallery reads, or a DATASET name (as="dataset") an {{#each}} loops.',
        args: [
          { name: 'target', desc: 'What to set: page.title, page.image, page.description, or a page.data key/path (e.g. "gallery_folder" or "data.article.title").' },
          { name: 'as', desc: 'The input: text (default), textarea, url, image (file picker, images), file (file picker, any uploaded file), folder (a dropdown of media folders), or dataset (a dropdown of datasets).' },
          { name: 'label', desc: 'Optional chip label (defaults to the target).' },
        ],
        example:
          '{{! a client picks the gallery folder; the gallery below reads it }}\n' +
          '{{sw-control target="gallery_folder" as="folder" label="Gallery folder"}}\n' +
          '{{#sw-folder page.data.gallery_folder}}<img src="{{sw-url url}}" alt="{{alt}}">{{/sw-folder}}',
        note: 'Renders nothing for a non-settable target. It writes into the page draft (saved with everything else) and is REMOVED entirely from the published HTML.',
      },
      {
        id: 'h-lookup',
        syntax: '{{lookup obj key}}',
        name: 'lookup',
        keywords: 'dynamic property index',
        description: 'Built-in: reads a property of an object by a (possibly dynamic) key.',
        example: '{{lookup company.colors "primary"}}',
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
          'The one loop helper. Over a plain list or object, the item is this and you get @index, @key, @first, @last; {{else}} renders for an empty list. Over a DATASET (data.<set>) it is dataset-aware: each iteration’s context is the entry’s FIELDS — read {{title}} directly (no values. prefix) — the entry envelope is on @entry (@entry.id, @entry.dataset), and in the editor each rendered row is click-to-edit (clicking opens that entry’s editor). No separate helper — just loop the dataset.',
        args: [{ name: 'items', desc: 'A list/object, a dataset (data.<set>), nav.<slot>, page.children, or a website.data/page.data array.' }],
        example:
          '{{! A dataset — fields are read directly, rows are click-to-edit: }}\n' +
          '{{#each data.services}}\n' +
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
    entries: [
      {
        id: 'd-text',
        syntax: 'data-sw-text="key"',
        name: 'data-sw-text',
        keywords: 'editable plain text inline directive',
        description: 'Makes the element’s text editable in place (plain text, HTML-escaped). The override is stored as page.data.<key> (a `data.<path>` key targets a nested page.data path).',
        example: '<h1 data-sw-text="headline">Welcome</h1>',
      },
      {
        id: 'd-html',
        syntax: 'data-sw-html="key"',
        name: 'data-sw-html',
        keywords: 'editable rich text wysiwyg html directive',
        description:
          'Makes the element a RICH-text region: a floating toolbar in the preview + a side WYSIWYG/HTML-source editor. The override is stored as page.data.<key> (a `data.<path>` key targets a nested path) and sanitized to a safe allowlist at render.',
        example: '<div data-sw-html="intro"><p>Default intro…</p></div>',
      },
      {
        id: 'd-href',
        syntax: 'data-sw-href="key"',
        name: 'data-sw-href',
        keywords: 'editable link url anchor directive',
        description: 'Makes a link’s URL editable (a popover). Pair with data-sw-text on the same anchor to edit its label too.',
        example: '<a data-sw-href="cta_url" data-sw-text="cta_label" href="/start">Get started</a>',
      },
      {
        id: 'd-src',
        syntax: 'data-sw-src="key"',
        name: 'data-sw-src',
        keywords: 'editable image src picture directive',
        description: 'Makes an <img> replaceable — clicking it in the preview opens the file picker.',
        example: '<img data-sw-src="hero" src="/hero.jpg" alt="Hero">',
      },
      {
        id: 'd-bg',
        syntax: 'data-sw-bg="key"',
        name: 'data-sw-bg',
        keywords: 'editable background image cover directive',
        description: 'Makes an element’s background image replaceable via the file picker (set as an inline background-image).',
        example: '<section data-sw-bg="band" class="min-h-64 bg-cover bg-center">…</section>',
      },
      {
        id: 'd-entry',
        syntax: 'data-sw-entry  (automatic)',
        name: 'data-sw-entry',
        keywords: 'dataset row click open entry automatic',
        description:
          'Added AUTOMATICALLY by the dataset {{#each}} around each row — clicking a row in the preview opens that entry’s editor. You don’t write it by hand.',
      },
    ],
  },
  {
    id: 'bindings',
    title: 'Binding namespaces',
    blurb: 'The data you can read with {{ … }}. Edit the sources in Settings and the Data panel.',
    entries: [
      {
        id: 'n-company',
        syntax: 'company.*',
        name: 'company',
        keywords: 'identity brand organization',
        description:
          'Corporate identity (Settings → Corporate Identity): company.name, .legalName, .shortName, .slogan, .description, .email, .telephone, .mapUrl (Google Maps embed → iframe src), .bookingUrl (external booking/reservation/appointment link); images .logo / .logoLight / .logoDark / .icon / .favicon / .image; .colors.<token>; address (.street, .locality, .region, .country, .postalCode). company.social is an ARRAY of { link, name, icon } — loop it with {{#each}}.',
        example:
          '<a href="mailto:{{company.email}}">{{company.email}}</a>\n' +
          '\n' +
          '{{#each company.social}}\n' +
          '  <a href="{{sw-url link}}" aria-label="{{name}}">{{sw-icon icon "h-5 w-5"}}</a>\n' +
          '{{/each}}',
      },
      {
        id: 'n-website',
        syntax: 'website.*',
        name: 'website',
        keywords: 'site url json data',
        description:
          'Site-level settings (Settings → Website): website.siteUrl (the public site URL), website.json_data (a JSON file fetched from a URL at publish), and website.data (an object you edit right here — see its own entry below).',
        example: '{{website.siteUrl}}',
      },
      {
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
        id: 'n-page',
        syntax: 'page.*',
        name: 'page',
        keywords: 'title path slug locale translations route data children',
        description:
          'The current page: page.title, page.path (the FULL computed route, e.g. /de/services), page.slug (the page’s OWN segment, e.g. services), page.locale, page.translations (locale alternates — each has .path, .locale), page.data (this page’s custom object), and page.children (its child pages) — see their own entries.',
        example: '<title>{{page.title}}</title>\n<body id="{{page.slug}}">',
      },
      {
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
        id: 'n-translations',
        syntax: 'page.locale · page.translations',
        name: 'multilingual (i18n)',
        keywords: 'language switcher locale translation multilingual flag hreflang i18n alternates',
        description:
          'page.locale is the current page’s language; page.translations is its locale ALTERNATES (the translation group) as an ARRAY — each with .locale, .path (full route) and .title — for a LANGUAGE SWITCHER and hreflang links. Country flags are a poor proxy for languages ({{sw-flag}} takes a COUNTRY code, not a language code), so map locale→country in website.data and look it up — INSIDE {{#each page.translations}} reach the root with @root: website.data.locale_flags = { en: "gb", de: "de" } then {{sw-flag (lookup @root.website.data.locale_flags locale)}}. DATASETS localize by a "<slug>-<locale>" suffix that auto-resolves on a page in that locale ({{#each data.services}} on a "de" page reads "services-de" when it exists, else "services") — see the {{#each}} helper.',
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
        id: 'n-parent-page',
        syntax: 'parentPage.*',
        name: 'parentPage',
        keywords: 'parent page up breadcrumb ancestor inherit section data path slug',
        description:
          'The current page’s direct PARENT (the page above it in the pages tree), as a lean read-only view: parentPage.title, parentPage.slug, parentPage.path (its full route — use {{sw-url parentPage.path}}), parentPage.locale, and parentPage.data (the parent’s own page.data — e.g. read a section’s shared settings). Absent at the tree root / home, so {{parentPage.*}} renders empty there. One level only — there is no parentPage.parentPage.',
        example:
          '{{! "up" link + inherit a value from the parent’s page.data }}\n' +
          '<a href="{{sw-url parentPage.path}}">↑ {{parentPage.title}}</a>\n' +
          '<span class="accent" style="color:{{parentPage.data.section_color}}">{{page.title}}</span>',
      },
      {
        id: 'n-data',
        syntax: 'data.<dataset>',
        name: 'data',
        keywords: 'dataset entries collection rows loop',
        description:
          'A dataset’s entries as an ordered ARRAY (manage rows in the Data panel). Loop with {{#each}} — each row’s fields are read directly ({{name}}), and rows are click-to-edit in the editor. For a direct lookup by key, use item.<dataset> instead.',
        example:
          '{{#each data.team}}\n' +
          '  <li>{{name}}</li>\n' +
          '{{/each}}',
      },
      {
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
          '{{#each data.services}}\n' +
          '  <li>{{title}}</li>\n' +
          '{{/each}}',
      },
      {
        id: 'n-nav',
        syntax: 'nav.<slot>',
        name: 'nav',
        keywords: 'menu navigation header footer mobile',
        description:
          'Auto-built menus from the page tree: nav.header, nav.footer, nav.mobile. Each item has .path, .children (sub-pages, for dropdowns), .newTab (open in a new tab), .external (an off-site/mailto/tel link), and the render-ready label — output it with {{sw-label}} (a placeholder’s name can include {{sw-icon}}/HTML; a page title is escaped). Items also include "nav placeholders" (pages-list entries with no page of their own) that link out or group children.',
        example:
          '{{#each nav.header}}\n' +
          '  <a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a>\n' +
          '{{/each}}',
      },
    ],
  },
  {
    id: 'variables',
    title: 'System variables',
    blurb: 'Loop counters + context navigation — mostly inside {{#each}} / {{#with}} (and @root from anywhere).',
    entries: [
      {
        id: 'v-this',
        syntax: 'this   ·   @entry.id   ·   @entry.dataset',
        name: 'this / @entry',
        keywords: 'current item entry fields loop dataset envelope',
        description:
          'Inside {{#each}}, this is the current item. Over a DATASET the context IS the entry’s fields, so read them directly ({{title}}, not {{values.title}}); the entry’s envelope is on @entry (@entry.id, @entry.dataset, @entry.status).',
        example:
          '{{#each data.posts}}\n' +
          '  <h3>{{title}}</h3>\n' +
          '  <small>{{@entry.id}}</small>\n' +
          '{{/each}}',
      },
      {
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
        id: 'v-firstlast',
        syntax: '@first   @last',
        name: '@first / @last',
        keywords: 'boundary loop edge boolean',
        description: 'Booleans — true on the first / last iteration of a loop.',
        example:
          '{{#each data.steps}}\n' +
          '  {{#unless @first}}<hr>{{/unless}}\n' +
          '  {{sw-label}}\n' +
          '{{/each}}',
      },
      {
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
        id: 'v-root',
        syntax: '@root.<path>',
        name: '@root',
        keywords: 'root context outer global each with scope website page company reach top',
        description:
          'The OUTERMOST render context (company, website, page, data, nav, …), reachable from ANYWHERE — including deep inside a {{#each}}/{{#with}} where the current context is a loop item, not the page. Use it to read a global while iterating: inside {{#each page.translations}} a bare website.* would resolve against the translation item, so reach it with @root (e.g. a per-locale flag map in a language switcher).',
        example:
          '{{#each page.translations}}\n' +
          '  {{! `locale` is the loop item; @root reaches website.data: }}\n' +
          '  {{sw-flag (lookup @root.website.data.locale_flags locale)}}\n' +
          '{{/each}}',
      },
      {
        id: 'v-parent-ctx',
        syntax: '../value   (../../ …)',
        name: '../ (parent context)',
        keywords: 'parent context outer scope each with up one level nested loop dotdot',
        description:
          'Steps OUT one context level: inside {{#each}}/{{#with}}, ../x reads x from the ENCLOSING scope (stack ../../ to go up two). Use it to reach an outer-loop value from a nested loop. For the very top, @root is usually clearer than counting ../ levels.',
        example:
          '{{#each data.categories}}\n' +
          '  <h2>{{name}}</h2>\n' +
          '  {{#each products}}\n' +
          '    {{! ../name = the category from the OUTER loop: }}\n' +
          '    <li>{{name}} — in {{../name}}</li>\n' +
          '  {{/each}}\n' +
          '{{/each}}',
      },
    ],
  },
  {
    id: 'effects',
    title: 'Nav & button effects',
    blurb:
      'CI-themed, contrast-safe hover/active schemes. Pick them in Website settings (no code, site-wide) or add a sw-nav-* / sw-btn-* class per element. The CSS tree-shakes per scheme.',
    entries: [
      {
        id: 'fx-nav',
        syntax: 'sw-nav-pill | -underline | -soft | -bar | -ghost',
        name: 'Nav effects (sw-nav-*)',
        keywords: 'nav navbar menu active current effect scheme hover underline pill bar ghost highlight appearance',
        description:
          'Active + hover styling for the MAIN nav links (the #top-nav / #mobile-nav landmarks). Mark the current item with the .active class — e.g. {{#if (sw-active path)}}active{{/if}} — and/or aria-current="page". Colors come from the brand: only `pill` fills a surface (with the WCAG-derived primary foreground); underline/soft/bar keep the readable nav text and add a brand accent; ghost colors the active text in the brand primary. Set the scheme in Website settings (applies everywhere), or add the class to a single <ul> for a one-off.',
        example:
          '{{! Website settings → Nav effect, OR per-nav: }}\n' +
          '<ul class="menu menu-horizontal sw-nav-pill">{{#each nav.header}}\n' +
          '  <li><a href="{{sw-url path}}"\n' +
          '         class="{{#if (sw-active path)}}active{{/if}}"\n' +
          '         {{#if (sw-active path exact=true)}}aria-current="page"{{/if}}>{{label}}</a></li>\n' +
          '{{/each}}</ul>',
        note: 'pill / soft / underline / bar keep WCAG contrast for ANY brand color (the text stays the derived/base foreground). Want your own scheme? Pick "Custom" in Website settings and write it in Custom CSS.',
      },
      {
        id: 'fx-btn',
        syntax: 'sw-btn-lift | -glow | -sheen | -press | -pulse | -ring',
        name: 'Button effects (sw-btn-*)',
        keywords: 'button btn effect hover press lift glow sheen pulse ring motion animation appearance state',
        description:
          'Hover/press motion + glow layered on any daisyUI .btn — the button keeps its own colors, so contrast is never affected. Brand-aware glows read the button variant color (--btn-color). All motion respects prefers-reduced-motion. Set one site-wide in Website settings, or add a class to a single button.',
        example:
          '<button class="btn btn-primary sw-btn-lift">Get started</button>\n' +
          '<a class="btn btn-outline sw-btn-glow" href="/contact">Contact</a>',
        note: 'Pick ONE motion effect per button (each manages its own transition, so stacking two can cancel a transition). The click ripple is separate and composes on top — add waves-effect (plus waves-light on dark/colored buttons).',
      },
    ],
  },
];
