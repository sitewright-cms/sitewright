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
        syntax: '{{url value}}',
        name: 'url',
        keywords: 'link href src safe sanitize',
        description:
          'Scheme-sanitizes a URL for an href/src (blocks javascript:/data:/protocol-relative). Always use it for href/src. (Internal root-relative links are additionally rebased to a portable path by the publish pipeline.)',
        args: [{ name: 'value', desc: 'A URL or root-relative path.' }],
        example: '<a href="{{url \'/about\'}}">About</a>\n<img src="{{url values.image}}" alt="">',
      },
      {
        id: 'h-date',
        syntax: '{{date value [format]}}',
        name: 'date',
        keywords: 'time format iso',
        description: 'Formats a date as UTC YYYY-MM-DD, or the full ISO string with "iso". Empty for an unparseable value.',
        args: [
          { name: 'value', desc: 'A date string, number, or Date.' },
          { name: 'format', desc: 'Optional — "iso" for the full ISO timestamp.' },
        ],
        example: '{{date values.published}}\n{{date values.published "iso"}}',
      },
      {
        id: 'h-icon',
        syntax: '{{icon "name" ["classes"]}}',
        name: 'icon',
        keywords: 'svg lucide glyph',
        description: 'Inlines a built-in Lucide icon as an SVG. Browse names in the Library → Icons gallery.',
        args: [
          { name: 'name', desc: 'The icon name (e.g. "arrow-right").' },
          { name: 'classes', desc: 'Optional Tailwind classes (default "h-5 w-5").' },
        ],
        example: '{{icon "arrow-right" "h-4 w-4"}}',
      },
      {
        id: 'h-truncate',
        syntax: '{{truncate text N}}',
        name: 'truncate',
        keywords: 'clip ellipsis shorten',
        description: 'Clips text to at most N characters, adding an ellipsis when clipped.',
        args: [
          { name: 'text', desc: 'The string to clip.' },
          { name: 'N', desc: 'Maximum length (default 100).' },
        ],
        example: '<p>{{truncate values.summary 80}}</p>',
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
        id: 'h-edit',
        syntax: '{{edit "key" ["default"]}}',
        name: 'edit',
        keywords: 'editable content region client text',
        description:
          'A client-editable PLAIN-TEXT region: shows the default until a client overrides it; always HTML-escaped. Prefer the data-sw-text directive on a real element (same effect, click-to-edit in place).',
        args: [
          { name: 'key', desc: 'A unique region id (stored in page content).' },
          { name: 'default', desc: 'Optional fallback text shown until edited.' },
        ],
        example: '<h1>{{edit "headline" "Welcome"}}</h1>',
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
        syntax: '{{#each items}} … {{/each}}',
        name: 'each',
        keywords: 'loop iterate list array for',
        description: 'Loops a list (or object). Inside the block: this, @index, @key, @first, @last.',
        example: '<ul>{{#each nav.header}}<li><a href="{{url path}}">{{label}}</a></li>{{/each}}</ul>',
      },
      {
        id: 'b-eachentry',
        syntax: '{{#eachEntry data.set}} … {{else}} … {{/eachEntry}}',
        name: 'eachEntry',
        keywords: 'dataset loop entries rows click edit',
        description:
          'Loops a DATASET like {{#each}}, but in the editor each rendered row is click-to-edit — clicking it opens that entry’s editor. Use this (not {{#each}}) for dataset lists. {{else}} renders for an empty set.',
        args: [{ name: 'data.set', desc: 'A dataset binding (manage rows in the Data panel).' }],
        example: '{{#eachEntry data.services}}\n  <div class="card">\n    <h3>{{values.title}}</h3>\n    <p>{{values.summary}}</p>\n  </div>\n{{else}}\n  <p>No services yet.</p>\n{{/eachEntry}}',
      },
      {
        id: 'b-if',
        syntax: '{{#if cond}} … {{else}} … {{/if}}',
        name: 'if',
        keywords: 'conditional branch when',
        description: 'Renders the block when cond is truthy; the optional {{else}} renders otherwise.',
        example: '{{#if page.translations}}…language switcher…{{/if}}',
      },
      {
        id: 'b-unless',
        syntax: '{{#unless cond}} … {{/unless}}',
        name: 'unless',
        keywords: 'conditional inverse not',
        description: 'Renders the block when cond is FALSY (the inverse of {{#if}}).',
        example: '{{#unless values.soldOut}}<button class="btn">Buy</button>{{/unless}}',
      },
      {
        id: 'b-with',
        syntax: '{{#with obj}} … {{/with}}',
        name: 'with',
        keywords: 'scope context this',
        description: 'Scopes the block to obj, so its members can be read directly (as this).',
        example: '{{#with company}}<p>{{name}} — {{email}}</p>{{/with}}',
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
        description: 'Makes the element’s text editable in place (plain text, HTML-escaped).',
        example: '<h1 data-sw-text="headline">Welcome</h1>',
      },
      {
        id: 'd-html',
        syntax: 'data-sw-html="key"',
        name: 'data-sw-html',
        keywords: 'editable rich text wysiwyg html directive',
        description:
          'Makes the element a RICH-text region: a floating toolbar in the preview + a side WYSIWYG/HTML-source editor. The value is sanitized to a safe allowlist.',
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
          'Added AUTOMATICALLY by {{#eachEntry}} around each row — clicking a row in the preview opens that entry’s editor. You don’t write it by hand.',
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
          'Corporate identity (Settings → Corporate Identity): company.name, .legalName, .shortName, .slogan, .description, .email, .telephone; images .logo / .logoLight / .logoDark / .icon / .favicon / .image; .colors.<token>; address (.street, .locality, .region, .country, .postalCode). company.social is an ARRAY (loop it with {{#each}}).',
        example: '<a href="mailto:{{company.email}}">{{company.email}}</a>\n{{#each company.social}}<a href="{{url this}}">{{this}}</a>{{/each}}',
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
          '<p>{{website.data.hero.subline}}</p>\n\n' +
          '{{! Loop an array stored under website.data: }}\n' +
          '<ul>{{#each website.data.highlights}}<li>{{this}}</li>{{/each}}</ul>',
      },
      {
        id: 'n-page',
        syntax: 'page.*',
        name: 'page',
        keywords: 'title path locale translations route data',
        description:
          'The current page: page.title, page.path (the full computed route), page.locale, page.translations (locale alternates — each has .path, .locale), and page.data (this page’s custom object — see its own entry).',
        example: '<title>{{page.title}}</title>',
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
          '<img src="{{url page.data.article_image}}">\n' +
          '<div>{{page.data.article_body}}</div>',
      },
      {
        id: 'n-data',
        syntax: 'data.<dataset>',
        name: 'data',
        keywords: 'dataset entries collection rows loop',
        description:
          'A dataset’s entries as an ordered ARRAY (manage rows in the Data panel). Loop with {{#eachEntry}} and read fields via values.<field>. For a direct lookup by key, use item.<dataset> instead.',
        example: '{{#eachEntry data.team}}<li>{{values.name}}</li>{{/eachEntry}}',
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
          '{{#eachEntry data.services}}<li>{{values.title}}</li>{{/eachEntry}}',
      },
      {
        id: 'n-nav',
        syntax: 'nav.<slot>',
        name: 'nav',
        keywords: 'menu navigation header footer mobile',
        description:
          'Auto-built menus from the page tree: nav.header, nav.footer, nav.mobile. Each item has .label, .path, and .children (sub-pages, for dropdowns).',
        example: '{{#each nav.header}}<a href="{{url path}}">{{label}}</a>{{/each}}',
      },
    ],
  },
  {
    id: 'variables',
    title: 'System variables',
    blurb: 'Available inside specific blocks.',
    entries: [
      {
        id: 'v-this',
        syntax: 'this   ·   values.<field>',
        name: 'this / values',
        keywords: 'current item entry fields loop',
        description:
          'Inside {{#each}}/{{#eachEntry}}, this is the current item; an entry’s fields are read as values.<field> (e.g. {{values.title}}).',
        example: '{{#eachEntry data.posts}}<h3>{{values.title}}</h3>{{/eachEntry}}',
      },
      {
        id: 'v-index',
        syntax: '@index   @key',
        name: '@index / @key',
        keywords: 'position counter loop index',
        description: '@index is the zero-based position in a loop; @key is the current item’s key/index.',
        example: '{{#each nav.header}}<li data-i="{{@index}}">{{label}}</li>{{/each}}',
      },
      {
        id: 'v-firstlast',
        syntax: '@first   @last',
        name: '@first / @last',
        keywords: 'boundary loop edge boolean',
        description: 'Booleans — true on the first / last iteration of a loop.',
        example: '{{#eachEntry data.steps}}{{#unless @first}}<hr>{{/unless}}{{values.label}}{{/eachEntry}}',
      },
      {
        id: 'v-nav',
        syntax: 'label · path · children · locale',
        name: 'nav / translation item',
        keywords: 'menu item label path children locale',
        description:
          'Inside {{#each nav.x}}: label, path, children (sub-items). Inside {{#each page.translations}}: path, locale.',
        example: '{{#each nav.header}}{{#if children}}<details><summary>{{label}}</summary>…{{/if}}{{/each}}',
      },
    ],
  },
];
