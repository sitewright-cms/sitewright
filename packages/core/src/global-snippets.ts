/**
 * Built-in GLOBAL snippets — the platform's REFERENCE COOKBOOK. Each entry is a worked, validator-safe
 * recipe that shows HOW to compose a `data-sw-component` runtime (slider, …) or the authoring
 * vocabulary (dataset loops, folder reads, translation, page variables) from bare principles — a
 * "show me how" starting point for developers AND MCP agents. They are ALSO ordinary `{{> name}}`
 * partials (a project can include one directly and restyle it), and surface read-only + copyable in
 * the editor's Snippets rail (grouped by {@link SnippetCategory}, above the project's own editable
 * snippets). A project snippet of the same `name` overrides the global.
 *
 * This is deliberately NOT a library of trivial marketing sections (a hero / CTA / pricing band is a
 * minute of DaisyUI anyone can write) — those were retired. A recipe earns its place by demonstrating
 * a real platform primitive or a non-obvious composition.
 *
 * Snippets are CONTRACT-FREE: inert/lightly-bound markup, freely editable and deletable. The
 * data-driven, managed, interactive blocks (carrying a config dataset + `data-sw-component` runtime)
 * are WIDGETS — a hard-separated registry in `./widgets.ts`, never seeded here, never in the snippet
 * editor. See docs/authoring-model.md.
 *
 * Every source is CSP/validator-safe by construction (no `<script>`, `on*` handlers, `{{{raw}}}`,
 * only literal/`{{sw-url}}` URLs — never an interpolated inline `style` URL) and uses platform
 * conventions: DaisyUI/Tailwind classes brand-themed via the CI tokens (`primary`/`secondary`/…),
 * `data-sw-*` editable regions, and `{{!-- … --}}` comments that teach in the source but are stripped
 * on render. The package tests run each source through `validateTemplate`, so an unsafe edit here
 * fails the build, not publish. Sitewright's own compositions (no third-party markup → no licensing
 * constraint).
 */

/** Editor-rail grouping for the reference cookbook (grows as PR2/PR3 add component families). */
export type SnippetCategory = 'slider' | 'data' | 'chrome' | 'effects';

export interface GlobalSnippet {
  /** The `{{> name}}` partial name — a valid Handlebars identifier (also the override key). */
  name: string;
  /** Human label shown in the Snippets rail. */
  label: string;
  /** Grouping bucket for the rail. */
  category: SnippetCategory;
  /** One line: what this recipe demonstrates (shown as the rail tooltip / agent hint). */
  description: string;
  /** Tags naming the directives / helpers / techniques the recipe shows (for discovery + search). */
  demonstrates?: readonly string[];
  /** Handlebars + DaisyUI/Tailwind source. */
  source: string;
}

export const GLOBAL_SNIPPETS: readonly GlobalSnippet[] = [
  // ── Sliders (data-sw-component="carousel") ──────────────────────────────────────────────────────
  {
    name: 'slider-fullscreen',
    label: 'Slider — full-screen hero',
    category: 'slider',
    description:
      'Single full-screen hero slider: height set once on the root, Ken Burns drift, and a caption with editable text + CTA.',
    demonstrates: ['carousel', 'data-kenburns', 'data-sw-bg', 'data-sw-text', 'data-sw-href', 'sw-icon'],
    // Height is set ONCE on the root; the slides fill it (no per-slide height). data-kenburns adds the
    // slow zoom/pan + caption rise-in (keyframes ship with the component). Each slide's `.sw-kenburns`
    // layer is the cover: bind it with data-sw-bg — a CI gradient shows until an image is set.
    source: `{{!-- Single full-screen hero slider. Swap the gradients for images by setting the
  page.data.hero_slide_* values (data-sw-bg), or point the track at a dataset (see slider-dataset). --}}
<div class="relative h-[80vh] min-h-[460px] overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-effect="fade" data-loop="true" data-autoplay="true" data-interval="6000" data-kenburns aria-label="Highlights">
  <div data-sw-part="track">
    <figure data-sw-part="slide">
      <div class="sw-kenburns bg-gradient-to-br from-primary to-secondary" data-sw-bg="page.data.hero_slide_1"></div>
      <div class="absolute inset-0 flex items-center justify-center bg-black/30 p-6">
        <div class="sw-caption max-w-2xl text-center text-white">
          <h2 class="text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="page.data.hero_title_1">Craft that ships</h2>
          <p class="mt-4 text-lg text-white/80" data-sw-text="page.data.hero_lead_1">A full-bleed opener with a slow Ken Burns drift.</p>
          <a class="btn btn-primary mt-6" href="/contact" data-sw-href="page.data.hero_cta_url" data-sw-text="page.data.hero_cta_label">Get started</a>
        </div>
      </div>
    </figure>
    <figure data-sw-part="slide">
      <div class="sw-kenburns bg-gradient-to-tr from-secondary to-accent" data-sw-bg="page.data.hero_slide_2"></div>
      <div class="absolute inset-0 flex items-center justify-center bg-black/30 p-6">
        <div class="sw-caption max-w-2xl text-center text-white">
          <h2 class="text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="page.data.hero_title_2">Built to last</h2>
          <p class="mt-4 text-lg text-white/80" data-sw-text="page.data.hero_lead_2">Each caption is editable; the cover layer is a data-sw-bg image.</p>
        </div>
      </div>
    </figure>
  </div>
  <button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "chevron-left" "size-6"}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "chevron-right" "size-6"}}</button>
  <div data-sw-part="dots" aria-hidden="true"></div>
</div>`,
  },
  {
    name: 'slider-cards',
    label: 'Slider — single content cards',
    category: 'slider',
    description:
      'One-card-at-a-time content slider (testimonials/quotes): slide effect, looping, arrows + dot indicators.',
    demonstrates: ['carousel', 'data-effect=slide', 'data-loop', 'sw-icon', 'parts:prev/next/dots'],
    // data-effect="slide" translates the strip (vs the default crossfade); arrows + dots are optional
    // parts — omit a part to drop that control. Slide spacing is padding INSIDE the slide, never margin.
    source: `{{!-- Single-item content slider. Each slide is one full-width card. --}}
<div class="relative overflow-hidden rounded-3xl border border-base-200" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" aria-label="What clients say">
  <div data-sw-part="track">
    <figure data-sw-part="slide" class="bg-base-100 px-10 py-14 text-center">
      <p class="mx-auto max-w-2xl text-xl leading-relaxed">&ldquo;They shipped twice as fast as our last agency, and the handover was flawless.&rdquo;</p>
      <figcaption class="mt-6 text-sm font-semibold text-base-content/60">Dana R. &middot; Head of Product</figcaption>
    </figure>
    <figure data-sw-part="slide" class="bg-base-100 px-10 py-14 text-center">
      <p class="mx-auto max-w-2xl text-xl leading-relaxed">&ldquo;The site is fast, accessible, and our team edits it without us.&rdquo;</p>
      <figcaption class="mt-6 text-sm font-semibold text-base-content/60">Marco V. &middot; Founder</figcaption>
    </figure>
    <figure data-sw-part="slide" class="bg-base-100 px-10 py-14 text-center">
      <p class="mx-auto max-w-2xl text-xl leading-relaxed">&ldquo;Easily the smoothest launch we&rsquo;ve had. We&rsquo;d work with them again in a heartbeat.&rdquo;</p>
      <figcaption class="mt-6 text-sm font-semibold text-base-content/60">Priya S. &middot; Marketing Lead</figcaption>
    </figure>
  </div>
  <button type="button" data-sw-part="prev" aria-label="Previous slide" class="!bg-base-300 !text-base-content">{{sw-icon "chevron-left" "size-6"}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide" class="!bg-base-300 !text-base-content">{{sw-icon "chevron-right" "size-6"}}</button>
  <div data-sw-part="dots" aria-hidden="true" class="text-primary"></div>
</div>`,
  },
  {
    name: 'slider-multi',
    label: 'Slider — multi-item peek',
    category: 'slider',
    description:
      'Multiple slides per view with a fractional peek via the --sw-items CSS variable (responsive); centred active card.',
    demonstrates: ['carousel', '--sw-items', 'data-effect=slide', 'data-item-align', 'gap-as-padding'],
    // --sw-items (Tailwind arbitrary property) sets slides-per-view; a fractional value leaves a card
    // peeking. REQUIRES data-effect="slide". data-item-align="center" centres the active card with a
    // peek on both sides (first/last clamp to the edges). Author the gap as padding INSIDE each slide.
    source: `{{!-- Multi-item carousel: responsive slides-per-view with a peek. --}}
<div class="relative [--sw-items:1.15] md:[--sw-items:2.4] lg:[--sw-items:3.2]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-item-align="center" aria-label="Recent work">
  <div data-sw-part="track" class="overflow-hidden rounded-3xl">
    <figure data-sw-part="slide" class="px-3 py-1">
      <div class="card h-full overflow-hidden border border-base-200 bg-base-100 shadow-sm">
        <div class="aspect-[16/10] w-full bg-gradient-to-br from-primary/70 to-secondary/70"></div>
        <div class="card-body p-6"><span class="text-xs font-semibold uppercase tracking-wider text-primary">Brand</span><h3 class="text-lg font-bold tracking-tight">Northwind rebrand</h3></div>
      </div>
    </figure>
    <figure data-sw-part="slide" class="px-3 py-1">
      <div class="card h-full overflow-hidden border border-base-200 bg-base-100 shadow-sm">
        <div class="aspect-[16/10] w-full bg-gradient-to-br from-secondary/70 to-accent/70"></div>
        <div class="card-body p-6"><span class="text-xs font-semibold uppercase tracking-wider text-primary">Web</span><h3 class="text-lg font-bold tracking-tight">Atlas storefront</h3></div>
      </div>
    </figure>
    <figure data-sw-part="slide" class="px-3 py-1">
      <div class="card h-full overflow-hidden border border-base-200 bg-base-100 shadow-sm">
        <div class="aspect-[16/10] w-full bg-gradient-to-br from-accent/70 to-primary/70"></div>
        <div class="card-body p-6"><span class="text-xs font-semibold uppercase tracking-wider text-primary">Product</span><h3 class="text-lg font-bold tracking-tight">Lumen dashboard</h3></div>
      </div>
    </figure>
    <figure data-sw-part="slide" class="px-3 py-1">
      <div class="card h-full overflow-hidden border border-base-200 bg-base-100 shadow-sm">
        <div class="aspect-[16/10] w-full bg-gradient-to-br from-primary/70 to-accent/70"></div>
        <div class="card-body p-6"><span class="text-xs font-semibold uppercase tracking-wider text-primary">Brand</span><h3 class="text-lg font-bold tracking-tight">Vertex identity</h3></div>
      </div>
    </figure>
  </div>
  <button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "chevron-left" "size-6"}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "chevron-right" "size-6"}}</button>
</div>`,
  },
  {
    name: 'slider-logowall',
    label: 'Slider — logo wall (ticker)',
    category: 'slider',
    description:
      'A continuously scrolling logo wall built on the carousel auto-scroll ticker (pauses on hover/focus).',
    demonstrates: ['carousel', 'data-autoscroll', 'data-autoscroll-speed', 'data-loop', '--sw-items', 'sw-icon brand:'],
    // data-autoscroll turns stepped slides into a steady marquee (pair with data-loop + data-effect="slide").
    // The logos here are brand glyphs via {{sw-icon "brand:…"}} (no media needed); swap them for your own
    // <img> logos or a {{#sw-folder}} of an "Partners" media folder.
    source: `{{!-- Logo wall: a continuous auto-scroll ticker. --}}
<div class="relative overflow-hidden [--sw-items:2] sm:[--sw-items:3] md:[--sw-items:5]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-autoscroll="true" data-autoscroll-speed="1.2" aria-label="Tools we work with">
  <div data-sw-part="track">
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:react" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:nextdotjs" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:vuedotjs" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:svelte" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:tailwindcss" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:typescript" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:nodedotjs" "h-9 w-auto"}}</div></figure>
    <figure data-sw-part="slide" class="px-4"><div class="grid h-24 place-items-center text-base-content/70">{{sw-icon "brand:figma" "h-9 w-auto"}}</div></figure>
  </div>
</div>`,
  },
  {
    name: 'slider-dataset',
    label: 'Slider — bound to a dataset',
    category: 'slider',
    description:
      'A slider whose slides come from a dataset: one slide per entry via {{#each dataset.x}}, with an empty-state fallback.',
    demonstrates: ['carousel', '{{#each dataset}}', 'sw-url', 'loop fields', '{{else}}', 'sw-icon'],
    // The data-driven pattern: point {{#each}} at any dataset slug. Inside the loop fields are read
    // directly ({{title}}, not {{values.title}}). Renders the {{else}} placeholder until the dataset
    // has entries. On a translated page `dataset.projects` auto-resolves `projects-<locale>`.
    source: `{{!-- Data-bound slider: one slide per entry in the "projects" dataset. --}}
<div class="relative overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-autoplay="true" data-interval="5000" aria-label="Featured projects">
  <div data-sw-part="track">
    {{#each dataset.projects}}
    <figure data-sw-part="slide" class="relative">
      <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[16/9] w-full object-cover" loading="lazy" />
      <figcaption class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-10 pt-16 text-white">
        <span class="text-xs font-semibold uppercase tracking-wider opacity-70">{{category}}</span>
        <span class="block text-xl font-bold">{{title}}</span>
      </figcaption>
    </figure>
    {{else}}
    <figure data-sw-part="slide" class="grid min-h-64 place-items-center bg-base-200 text-center text-base-content/50">Add entries to the &ldquo;projects&rdquo; dataset to populate this slider.</figure>
    {{/each}}
  </div>
  <button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "chevron-left" "size-6"}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "chevron-right" "size-6"}}</button>
  <div data-sw-part="dots" aria-hidden="true"></div>
</div>`,
  },

  // ── Data, loops & bindings (the authoring primitives) ───────────────────────────────────────────
  {
    name: 'recipe-dataset-grid',
    label: 'Recipe — dataset card grid',
    category: 'data',
    description:
      'Loop a dataset into a responsive card grid; uses loop variables, sw-date, sw-truncate and sw-url.',
    demonstrates: ['{{#each dataset}}', '@first', 'sw-date', 'sw-truncate', 'sw-url', '{{else}}'],
    source: `{{!-- Loop a dataset into a card grid. Swap "posts" for any dataset slug. Inside the loop,
  fields are read directly; @index/@first/@last and block params (as |row i|) are available. --}}
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight">From the blog</h2>
  <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {{#each dataset.posts}}
    <article class="card overflow-hidden border border-base-200 bg-base-100 shadow-sm{{#if @first}} sm:col-span-2 lg:col-span-1{{/if}}">
      <img src="{{sw-url image}}" alt="{{title}}" class="aspect-[16/10] w-full object-cover" loading="lazy" />
      <div class="card-body p-6">
        <time class="text-xs font-semibold uppercase tracking-wider text-primary">{{sw-date date}}</time>
        <h3 class="text-lg font-bold tracking-tight">{{title}}</h3>
        <p class="text-sm text-base-content/60">{{sw-truncate summary 120}}</p>
        <a class="mt-2 inline-block text-sm font-semibold text-primary" href="{{sw-url url}}">Read more</a>
      </div>
    </article>
    {{else}}
    <p class="text-base-content/50">Add entries to the &ldquo;posts&rdquo; dataset to list them here.</p>
    {{/each}}
  </div>
</section>`,
  },
  {
    name: 'recipe-folder-gallery',
    label: 'Recipe — media folder gallery',
    category: 'data',
    description:
      'Render every image in a media folder with {{#sw-folder}}, using the per-item url/alt and block params.',
    demonstrates: ['{{#sw-folder}}', 'block params', 'item.url/alt', '@first', 'sw-url', '{{else}}'],
    source: `{{!-- Read a MEDIA folder: one item per image (set the folder name to your own). Each item
  exposes url/filename/kind/alt (+ width/height); block params "as |img i|" + @index/@first/@last work. --}}
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight">Gallery</h2>
  <div class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {{#sw-folder "Gallery" kind="image" as |img i|}}
    <figure class="overflow-hidden rounded-xl border border-base-200{{#if @first}} col-span-2 row-span-2{{/if}}">
      <img src="{{sw-url img.url}}" alt="{{img.alt}}" class="h-full w-full object-cover" loading="lazy" />
    </figure>
    {{else}}
    <p class="text-base-content/50">Upload images to the &ldquo;Gallery&rdquo; folder to show them here.</p>
    {{/sw-folder}}
  </div>
</section>`,
  },
  {
    name: 'recipe-i18n',
    label: 'Recipe — translated section',
    category: 'data',
    description:
      'Translate text with {{sw-translate}} + editable data-sw-translate, plus a flag language switcher over page.translations.',
    demonstrates: ['sw-translate', 'data-sw-translate', 'sw-flag', '{{#each page.translations}}', 'sw-url'],
    source: `{{!-- Translatable content. {{sw-translate "key"}} prints from the project translation catalog
  (falls back to default= when the key is empty). data-sw-translate makes the text editable per-locale.
  Loop page.translations for a switcher to this page's other locales; {{sw-flag}} draws the flag. --}}
<section class="mx-auto max-w-3xl px-6 py-16 text-center">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="home.headline">Welcome</h2>
  <p class="mt-4 text-base-content/60">{{sw-translate "home.lead" default="This line is resolved from the translation catalog."}}</p>
  {{#if page.translations}}
  {{!-- A language switcher. NOTE: content can't use a <nav> landmark (the skeleton owns those) — use a <div>/<ul>. --}}
  <div class="mt-8 flex flex-wrap items-center justify-center gap-3" aria-label="Languages">
    {{#each page.translations}}
    <a class="inline-flex items-center gap-2 rounded-full border border-base-200 px-3 py-1.5 text-sm font-semibold" href="{{sw-url path}}">{{sw-flag locale "size-5"}}<span class="uppercase">{{locale}}</span></a>
    {{/each}}
  </div>
  {{/if}}
</section>`,
  },
  {
    name: 'recipe-page-vars',
    label: 'Recipe — page variables & children',
    category: 'data',
    description:
      'Bind editable page.data values (text/html/src/bg), list child pages, reach the parent, and mark the active page.',
    demonstrates: ['data-sw-text', 'data-sw-html', 'data-sw-src', 'data-sw-bg', 'page.children', 'page.parent', 'sw-active'],
    source: `{{!-- Page variables & relationships. data-sw-text/html/src/bg bind editable values stored in
  page.data (use a page.data.<path> key for nested values). Loop page.children for sub-page cards;
  reach the parent with page.parent; sw-active marks the current page/trail. --}}
<section class="mx-auto max-w-5xl px-6 py-16">
  {{#if page.parent}}<a class="text-sm font-semibold text-primary" href="{{sw-url page.parent.path}}">&larr; {{page.parent.title}}</a>{{/if}}
  <figure class="mt-4 grid min-h-56 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-secondary p-8 text-center" data-sw-bg="page.data.cover">
    <img class="hidden" data-sw-src="page.data.cover_image" alt="" />
    <h1 class="text-4xl font-bold tracking-tight text-white" data-sw-text="page.data.headline">Section title</h1>
  </figure>
  <div class="prose mt-6 max-w-none text-base-content/70" data-sw-html="page.data.intro"><p>A rich intro paragraph &mdash; editable, stored in page.data.intro.</p></div>
  {{#if page.children}}
  <ul class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {{#each page.children}}
    <li><a class="card block h-full border border-base-200 bg-base-100 p-6 shadow-sm transition hover:shadow-md{{#if (sw-active path)}} ring-2 ring-primary{{/if}}" href="{{sw-url path}}">
      <span class="text-lg font-bold tracking-tight">{{title}}</span>
      <span class="mt-1 block text-sm text-base-content/60">{{description}}</span>
    </a></li>
    {{/each}}
  </ul>
  {{/if}}
</section>`,
  },

  // ── Site chrome ─────────────────────────────────────────────────────────────────────────────────
  {
    name: 'navbar',
    label: 'Navbar',
    category: 'chrome',
    description: 'A top navigation bar with active-link highlighting (sw-active) and an editable CTA.',
    demonstrates: ['sw-active', 'data-sw-text', 'company.name'],
    source: `<div class="navbar bg-base-100 shadow-sm">
  <div class="flex-1">
    <a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a>
  </div>
  <div class="flex-none">
    <ul class="menu menu-horizontal px-1 sw-nav-box-solid">
      <li><a href="/features" class="{{#if (sw-active '/features')}}active{{/if}}"{{#if (sw-active '/features' exact=true)}} aria-current="page"{{/if}}>Features</a></li>
      <li><a href="/pricing" class="{{#if (sw-active '/pricing')}}active{{/if}}"{{#if (sw-active '/pricing' exact=true)}} aria-current="page"{{/if}}>Pricing</a></li>
      <li><a class="btn btn-primary btn-sm" href="/contact" data-sw-text="nav_cta">Contact</a></li>
    </ul>
  </div>
</div>`,
  },

  // ── Effects (pure-CSS motion, no JS) ────────────────────────────────────────────────────────────
  {
    name: 'logo-marquee',
    label: 'Logo marquee',
    category: 'effects',
    description: 'A CSS-only auto-scrolling logo strip fed from a media folder (no JavaScript).',
    demonstrates: ['data-sw-marquee', '{{#sw-folder}}', 'sw-url'],
    // A CSS-only, auto-scrolling logo strip (no JS). The `data-sw-marquee` marker ships MARQUEE_CSS; the
    // track holds the logos TWICE (the second set aria-hidden + data-sw-marquee-dup) so the scroll loops
    // seamlessly and reduced-motion can drop the copy. Logos come from a media folder — edit the folder
    // name ("Partners") to your own. Logo height / speed are tunable via the marquee CSS variables.
    source: `<div data-sw-marquee aria-label="Partners">
  <div class="sw-marquee-track">
    {{#sw-folder "Partners" kind="image"}}
    <div class="sw-marquee-item bg-base-100 rounded-box p-4"><img src="{{sw-url url}}" alt="{{alt}}" loading="lazy"></div>
    {{/sw-folder}}
    {{#sw-folder "Partners" kind="image"}}
    <div class="sw-marquee-item bg-base-100 rounded-box p-4" data-sw-marquee-dup aria-hidden="true"><img src="{{sw-url url}}" alt="" loading="lazy"></div>
    {{/sw-folder}}
  </div>
</div>`,
  },
  {
    name: 'rotating-tiles',
    label: 'Rotating tiles (flip cards)',
    category: 'effects',
    description: 'A grid of 3D flip cards that reveal their back on hover — pure Tailwind, no JavaScript.',
    demonstrates: ['transform-3d', 'sw-icon', 'data-sw-text'],
    // A grid of 3D FLIP CARDS — pure Tailwind, no JS. Each card flips on hover to reveal its back. The 3D
    // is plain Tailwind: `[perspective]` on the cell, `transform-3d` on the rotating inner,
    // `backface-hidden` on both faces, and `group-hover:rotate-y-180` to flip.
    // Source-editable: copy a card, change the icon / front title / back text. Each face uses theme tokens.
    source: `<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
  <div class="group h-56 perspective-distant">
    <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
        {{sw-icon "rocket" "h-10 w-10 text-primary"}}
        <h3 class="font-heading text-lg font-semibold text-base-content" data-sw-text="tile1_title">Migrations &amp; Setup</h3>
      </div>
      <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
        <p data-sw-text="tile1_back">Moving your data across and getting you set up, ready to go.</p>
      </div>
    </div>
  </div>
  <div class="group h-56 perspective-distant">
    <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
        {{sw-icon "graduation-cap" "h-10 w-10 text-primary"}}
        <h3 class="font-heading text-lg font-semibold text-base-content" data-sw-text="tile2_title">Training</h3>
      </div>
      <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
        <p data-sw-text="tile2_back">Hands-on training so your team is confident from day one.</p>
      </div>
    </div>
  </div>
  <div class="group h-56 perspective-distant">
    <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
        {{sw-icon "life-buoy" "h-10 w-10 text-primary"}}
        <h3 class="font-heading text-lg font-semibold text-base-content" data-sw-text="tile3_title">Continuous Support</h3>
      </div>
      <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
        <p data-sw-text="tile3_back">Ongoing help whenever you need a hand.</p>
      </div>
    </div>
  </div>
</div>`,
  },
];

/**
 * `name → source` for merging GLOBAL_SNIPPETS into a render's partials map. Spread it FIRST so a
 * project snippet of the same name overrides the global: `{ ...GLOBAL_SNIPPET_PARTIALS, ...project }`.
 */
export const GLOBAL_SNIPPET_PARTIALS: Readonly<Record<string, string>> = Object.fromEntries(
  GLOBAL_SNIPPETS.map((s) => [s.name, s.source]),
);

/** One reference-cookbook entry without its source — the metadata the editor rail + agents use. */
export interface GlobalSnippetMeta {
  name: string;
  label: string;
  category: SnippetCategory;
  description: string;
  demonstrates?: readonly string[];
}

/**
 * Metadata-only view of the cookbook (no `source`) for grouping/describing the built-in snippets in
 * the editor's Snippets rail and for agent discovery. Joined to the live global rows BY NAME, so an
 * admin-edited or admin-added global without a catalog entry simply falls into the "Other" group.
 */
export const GLOBAL_SNIPPET_CATALOG: readonly GlobalSnippetMeta[] = GLOBAL_SNIPPETS.map(
  ({ name, label, category, description, demonstrates }) => ({ name, label, category, description, demonstrates }),
);
