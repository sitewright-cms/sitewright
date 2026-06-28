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

/**
 * Editor-rail grouping for the reference cookbook (grows as later PRs add component families).
 * Keep in sync with the editor's SNIPPET_CATEGORY_LABELS + SNIPPET_CATEGORY_KEY_ORDER in
 * apps/editor/src/views/code/CodeRailPanels.tsx (the labels map is `Record<SnippetCategory, …>`,
 * so a new member there is a compile error until labelled).
 */
export type SnippetCategory = 'slider' | 'gallery' | 'tabs' | 'modal' | 'forms' | 'shop' | 'data' | 'chrome' | 'effects';

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

  // ── Gallery / Lightbox (data-sw-component="lightbox") ───────────────────────────────────────────
  {
    name: 'gallery-grid',
    label: 'Gallery — lightbox grid',
    category: 'gallery',
    description:
      'A uniform square-cover lightbox grid fed from a media folder; click any tile to open the full-screen viewer.',
    demonstrates: ['lightbox', 'data-sw-part:grid/item', 'data-caption', '{{#sw-folder}}', 'sw-url'],
    // Explicit lightbox form: the data-sw-part="grid"/"item" structure gives the batteries-included
    // styled square grid + thumbnail strip. The viewer DOM is built by the runtime (nothing to author).
    // Each item is an <a href=full-image> containing an <img> thumbnail (here both are the folder url).
    source: `{{!-- Lightbox gallery (explicit styled grid) bound to a media folder — set the folder name. --}}
<div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="Gallery">
  <div data-sw-part="grid" class="gap-3 !grid-cols-2 md:!grid-cols-4">
    {{#sw-folder "Gallery" kind="image"}}
    <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="overflow-hidden rounded-2xl">
      <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" />
    </a>
    {{else}}
    <p class="text-base-content/50">Upload images to the &ldquo;Gallery&rdquo; folder to show them here.</p>
    {{/sw-folder}}
  </div>
</div>`,
  },
  {
    name: 'gallery-masonry',
    label: 'Gallery — masonry (no crop)',
    category: 'gallery',
    description:
      'A mixed-aspect masonry lightbox (CSS columns); natural-aspect images stagger without cropping.',
    demonstrates: ['lightbox', 'masonry columns', 'item.width/height', '{{#sw-folder}}', 'sw-url'],
    // Minimal lightbox form: any container of <a href><img> children is a gallery — here a CSS-columns
    // masonry. width/height reserve space (no layout shift); natural aspect ratios avoid cropping.
    source: `{{!-- Masonry lightbox: mixed aspect ratios, no cropping. --}}
<div data-sw-component="lightbox" class="block columns-2 gap-4 sm:columns-3" aria-label="Gallery">
  {{#sw-folder "Gallery" kind="image"}}
  <a href="{{sw-url url}}" data-caption="{{alt}}" class="mb-4 block break-inside-avoid overflow-hidden rounded-xl border border-base-200">
    <img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="block w-full" />
  </a>
  {{else}}
  <p class="text-base-content/50">Upload images to the &ldquo;Gallery&rdquo; folder to show them here.</p>
  {{/sw-folder}}
</div>`,
  },
  {
    name: 'gallery-dataset',
    label: 'Gallery — bound to a dataset',
    category: 'gallery',
    description:
      'A lightbox gallery whose images come from a dataset (image + caption per entry), with an empty-state.',
    demonstrates: ['lightbox', '{{#each dataset}}', 'data-caption', 'sw-url', '{{else}}'],
    source: `{{!-- Lightbox bound to the "portfolio" dataset: one tile per entry (image + title). --}}
<div data-sw-component="lightbox" class="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Portfolio">
  {{#each dataset.portfolio}}
  <a href="{{sw-url image}}" data-caption="{{title}}" class="overflow-hidden rounded-xl">
    <img src="{{sw-url image}}" alt="{{title}}" loading="lazy" class="aspect-square w-full object-cover" />
  </a>
  {{else}}
  <p class="text-base-content/50">Add entries to the &ldquo;portfolio&rdquo; dataset to populate this gallery.</p>
  {{/each}}
</div>`,
  },

  // ── Tabs (data-sw-component="tabs") ─────────────────────────────────────────────────────────────
  {
    name: 'tabs-mixed',
    label: 'Tabs — mixed rich + plain labels',
    category: 'tabs',
    description:
      'Accessible content tabs; the runtime builds the tablist from each panel. Mix a rich (icon) label with plain ones.',
    demonstrates: ['tabs', 'data-sw-part:panel/tabtitle', 'data-sw-title', 'sw-icon'],
    // The runtime generates the tablist, buttons, ARIA + roving tabindex. Per-panel labels: a rich label
    // is a data-sw-part="tabtitle" child (non-interactive markup the runtime MOVES into the button —
    // XSS-safe); a plain label is the data-sw-title attribute. Keep data-sw-title as the accessible name.
    source: `{{!-- Content tabs. First tab has a rich (icon) label; the others use plain data-sw-title text. --}}
<div data-sw-component="tabs">
  <div data-sw-part="panel" data-sw-title="Overview">
    <span data-sw-part="tabtitle">{{sw-icon "sparkles" "size-4"}} Overview</span>
    <div class="prose mt-4 max-w-none"><p>What we do, in one paragraph. Each panel can hold any markup.</p></div>
  </div>
  <div data-sw-part="panel" data-sw-title="Process">
    <div class="prose mt-4 max-w-none"><p>How we work — discovery, build, launch.</p></div>
  </div>
  <div data-sw-part="panel" data-sw-title="FAQ">
    <div class="prose mt-4 max-w-none"><p>Answers to the questions we hear most.</p></div>
  </div>
</div>`,
  },
  {
    name: 'tabs-dataset',
    label: 'Tabs — generated from a dataset',
    category: 'tabs',
    description:
      'One tab per dataset entry: the loop emits a panel whose data-sw-title interpolates a field (e.g. an FAQ).',
    demonstrates: ['tabs', '{{#each dataset}}', 'data-sw-title interpolation', '{{else}}'],
    source: `{{!-- Tabs built from the "faqs" dataset: one panel per entry, label from the question field. --}}
<div data-sw-component="tabs">
  {{#each dataset.faqs}}
  <div data-sw-part="panel" data-sw-title="{{question}}">
    <div class="prose mt-4 max-w-none"><p>{{answer}}</p></div>
  </div>
  {{else}}
  <div data-sw-part="panel" data-sw-title="Getting started">
    <p class="mt-4 text-base-content/50">Add entries to the &ldquo;faqs&rdquo; dataset to build these tabs.</p>
  </div>
  {{/each}}
</div>`,
  },

  // ── Modals (data-sw-component="modal" → native <dialog>) ─────────────────────────────────────────
  {
    name: 'modal-basic',
    label: 'Modal — trigger + dialog',
    category: 'modal',
    description:
      'A link opens a native <dialog> modal (focus trap / Escape / backdrop for free); editable title + body.',
    demonstrates: ['modal', 'href="#id" trigger', 'data-close-label', 'data-sw-text', 'data-sw-html'],
    // Put id + data-sw-component="modal" on the <dialog>; open it from any <a href="#id"> (or a
    // [data-sw-modal="id"] trigger). The browser supplies focus trap, Escape, ::backdrop + inerting;
    // a styled close button is injected automatically. Body content uses normal editable directives.
    source: `{{!-- A link-triggered modal. The styled close button is added automatically. --}}
<a href="#how-it-works" class="btn btn-primary">What happens next?</a>
<dialog id="how-it-works" data-sw-component="modal" data-close-label="Close" class="max-w-lg">
  <h2 class="text-xl font-bold" data-sw-text="page.data.modal_title">How it works</h2>
  <div class="prose mt-3 max-w-none text-base-content/80" data-sw-html="page.data.modal_body"><p>An editable modal body. Never put essential content ONLY in a modal — it does nothing without JS.</p></div>
</dialog>`,
  },
  {
    name: 'modal-confirm',
    label: 'Modal — forced-choice confirm',
    category: 'modal',
    description:
      'A button-triggered confirm dialog: backdrop click disabled, the auto close button hidden, explicit actions.',
    demonstrates: ['modal', 'data-sw-modal trigger', 'data-backdrop-close', 'data-closebutton', 'data-sw-part:close', 'data-sw-href'],
    // The confirm action is a real link the developer points at their own destructive route: href="#"
    // is the inert placeholder, data-sw-href binds the real URL from page.data (kept "#" until set).
    source: `{{!-- Forced-choice modal: a backdrop click won't dismiss it; the auto close button is hidden. --}}
<button type="button" class="btn btn-outline btn-error" data-sw-modal="confirm-delete">Delete item</button>
<dialog id="confirm-delete" data-sw-component="modal" data-backdrop-close="false" data-closebutton="false" class="max-w-sm">
  <h2 class="text-lg font-bold">Are you sure?</h2>
  <p class="mt-2 text-sm text-base-content/70">This action can&rsquo;t be undone.</p>
  <div class="mt-6 flex justify-end gap-2">
    <button type="button" class="btn btn-ghost" data-sw-part="close">Cancel</button>
    <a class="btn btn-error" href="#" data-sw-href="page.data.confirm_url">Yes, delete</a>
  </div>
</dialog>`,
  },

  // ── Forms & inputs (data-sw-form / data-sw-component="datetimepicker") ───────────────────────────
  {
    name: 'form-embed',
    label: 'Form — embed by id',
    category: 'forms',
    description:
      'Drop a stored form into the page with {{sw-form "id"}}; the platform renders fields + anti-spam + messages.',
    demonstrates: ['sw-form', 'form embed'],
    // Create a form named "contact" first (kind "form": fields, submission mode, success/error
    // messages). {{sw-form}} then renders the COMPLETE markup. On a translated page "contact"
    // auto-resolves "contact-<locale>". (In the snippet preview, with no forms, it renders nothing.)
    source: `{{!-- Embed a stored form by id. Create a "contact" form (kind "form") FIRST — referencing a
  form id that does not exist throws at render once the project has any form (rename to match yours). --}}
<section class="mx-auto max-w-xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight">Get in touch</h2>
  <p class="mt-2 text-base-content/60">We usually reply within a day.</p>
  <div class="mt-8">{{sw-form "contact" class="space-y-4"}}</div>
</section>`,
  },
  {
    name: 'form-custom',
    label: 'Form — custom field markup',
    category: 'forms',
    description:
      'Author your own <form data-sw-form="id"> markup; the platform injects the endpoint, honeypot and captcha at render.',
    demonstrates: ['data-sw-form', 'custom fields', 'no action='],
    // Write your OWN field markup inside <form data-sw-form="<id>">; NEVER add an action= or
    // data-sw-component="form" yourself. The platform wires submission at render. Still needs a
    // stored form named "contact" (its definition drives validation + where submissions land).
    source: `{{!-- Hand-authored form: your own fields; the platform injects the submission wiring.
  IMPORTANT: data-sw-form="contact" throws at render if the project has forms but none named "contact"
  — create that form (or rename to your id) first. Never add action=/method=/onsubmit yourself. --}}
<form data-sw-form="contact" class="mx-auto max-w-xl space-y-4 px-6 py-16">
  <label class="block"><span class="mb-1 block text-sm font-medium">Name</span>
    <input type="text" name="name" required class="input input-bordered w-full" /></label>
  <label class="block"><span class="mb-1 block text-sm font-medium">Email</span>
    <input type="email" name="email" required class="input input-bordered w-full" /></label>
  <label class="block"><span class="mb-1 block text-sm font-medium">Message</span>
    <textarea name="message" rows="4" required class="textarea textarea-bordered w-full"></textarea></label>
  <button type="submit" class="btn btn-primary">Send message</button>
</form>`,
  },
  {
    name: 'datetimepicker-field',
    label: 'Input — date / time picker',
    category: 'forms',
    description:
      'A CI-themed calendar/time picker on a text input; data-mode switches date / range / datetime / time.',
    demonstrates: ['datetimepicker', 'data-mode', 'data-min/max', 'forms input'],
    // Put data-sw-component="datetimepicker" on a TEXT <input> (give it a name so it submits). The
    // runtime upgrades it into a popup picker; data-mode chooses the variant (here a bounded range).
    // Use a block element instead of an <input> for an always-open inline calendar.
    source: `{{!-- A date-range picker field (a booking widget). data-mode="date|range|datetime|time".
  Add bounds when you need them, e.g. data-min="2026-06-01" data-max="2026-12-31". --}}
<label class="mx-auto block max-w-sm px-6 py-16">
  <span class="mb-1 block text-sm font-medium">Choose your dates</span>
  <input type="text" name="stay" placeholder="Check-in &ndash; Check-out" class="w-full" data-sw-component="datetimepicker" data-mode="range" />
</label>`,
  },

  // ── Shop & cart (gated by website.shop.enabled — render nothing when the shop is off) ────────────
  {
    name: 'shop-product',
    label: 'Shop — product card + cart',
    category: 'shop',
    description:
      'An add-to-cart product card plus the cart mount; both auto-localize and only render when the shop is enabled.',
    demonstrates: ['sw-add-to-cart', 'sw-cart', 'website.shop'],
    // The mini-shop helpers are GATED: {{sw-add-to-cart}} and {{sw-cart}} render '' unless
    // website.shop.enabled is true (enable it in Website settings). Prices are non-authoritative
    // (front-end localStorage cart); checkout goes through the configured channel (WhatsApp/email/…).
    source: `{{!-- A product card with an add-to-cart button, plus the cart mount. Enable the shop first. --}}
<section class="mx-auto max-w-md px-6 py-16">
  <div class="card overflow-hidden border border-base-200 bg-base-100 shadow-sm">
    <div class="aspect-[4/3] w-full bg-gradient-to-br from-primary/70 to-secondary/70"></div>
    <div class="card-body p-6">
      <h3 class="text-lg font-bold tracking-tight">Studio mug</h3>
      <p class="text-sm text-base-content/60">Ceramic, 350ml.</p>
      <p class="mt-1 text-xl font-bold">&euro;19.90</p>
      {{sw-add-to-cart sku="mug" name="Studio mug" price="19.90" class="btn btn-primary mt-3"}}
    </div>
  </div>
  <div class="mt-8">{{sw-cart}}</div>
</section>`,
  },

  // ── Data, loops & bindings (the authoring primitives) ───────────────────────────────────────────
  {
    name: 'dataset-grid',
    label: 'Data — dataset card grid',
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
    name: 'folder-gallery',
    label: 'Data — media folder gallery',
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
    name: 'i18n',
    label: 'Data — translated section',
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
    name: 'page-vars',
    label: 'Data — page variables & children',
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
    name: 'nav-header',
    label: 'Main navigation (header + mobile drawer)',
    category: 'chrome',
    description:
      'The full default site header: data-driven desktop bar with hover dropdowns + a pure-CSS mobile slide-in drawer (accordions, logo, close), an auto language dropdown when the page is translated, and an auto light/dark toggle when themes are on.',
    demonstrates: ['nav.header', 'nav.mobile', 'sw-active', 'sw-label', 'dropdown-hover', 'peer-checkbox drawer', 'details accordion', 'sw-flag', 'sw-theme-toggle'],
    // Goes in the MAIN NAVIGATION slot (Website settings) — the skeleton wraps it in <nav id="main-nav">.
    // Desktop loops nav.header (pages in the "Main navigation" slot); the mobile DRAWER loops nav.mobile
    // (pages in the "Mobile menu" slot) and falls back to nav.header until you curate a mobile menu. The
    // drawer is no-JS: the hidden peer-checkbox toggles the slide-in panel — the <input> MUST precede the
    // backdrop/panel. "Show child pages in dropdown" (page settings) → a hover dropdown (parent stays a
    // real link) on desktop + a <details> accordion in the drawer. The language dropdown auto-appears when
    // the page has translations; {{sw-theme-toggle}} appears when themes are on. For flags, set
    // website.data.locale_flags = { "en": "gb", "de": "de", "es": "es" }.
    source: `<div>
  {{!-- DESKTOP bar (>=lg) --}}
  <div class="navbar hidden border-b border-base-200 bg-base-100 px-4 sm:px-8 lg:flex">
    <div class="navbar-start">
      <a class="btn btn-ghost gap-2.5 px-2 text-lg font-bold tracking-tight" href="{{sw-url '/'}}">
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-content shadow">{{sw-icon "compass" "h-4.5 w-4.5"}}</span>
        {{ company.name }}
      </a>
    </div>
    <div class="navbar-center">
      <ul class="menu menu-horizontal gap-1 px-1 font-medium">
        {{#each nav.header}}
        {{#if children}}
        <li class="dropdown dropdown-hover">
          <a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}} {{sw-icon "chevron-down" "h-4 w-4 opacity-60"}}</a>
          <ul class="dropdown-content menu z-30 w-52 rounded-xl border border-base-200 bg-base-100 p-2 shadow-xl">{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
        </li>
        {{else}}
        <li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>
        {{/if}}
        {{/each}}
      </ul>
    </div>
    <div class="navbar-end gap-2">
      {{#if page.translations}}
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-1.5">{{sw-flag (lookup @root.website.data.locale_flags page.locale) "h-3.5 w-5 rounded-sm"}}<span class="uppercase">{{page.locale}}</span>{{sw-icon "chevron-down" "h-3 w-3 opacity-60"}}</div>
        <ul tabindex="0" class="dropdown-content menu z-30 mt-2 w-40 rounded-xl border border-base-200 bg-base-100 p-2 shadow-xl">{{#each page.translations}}<li><a href="{{sw-url path}}" hreflang="{{locale}}">{{sw-flag (lookup @root.website.data.locale_flags locale) "h-3.5 w-5 rounded-sm"}}<span class="uppercase">{{locale}}</span></a></li>{{/each}}</ul>
      </div>
      {{/if}}
      {{sw-theme-toggle}}
      <a class="btn btn-primary" href="{{sw-url '/contact'}}">{{sw-translate "nav_cta" default="Contact"}}</a>
    </div>
  </div>

  {{!-- MOBILE bar + slide-in DRAWER (<lg). The peer-checkbox MUST be the first sibling. --}}
  <div class="navbar relative border-b border-base-200 bg-base-100 px-3 lg:hidden">
    <input type="checkbox" id="sw-nav-drawer" class="peer sr-only" aria-label="{{sw-translate "mobile_menu" default='Menu'}}" />
    <div class="navbar-start">
      <label for="sw-nav-drawer" class="btn btn-ghost btn-square" aria-hidden="true">{{sw-icon "menu" "h-6 w-6"}}</label>
      <a class="btn btn-ghost gap-2 px-1 text-base font-bold tracking-tight" href="{{sw-url '/'}}">
        <span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-content">{{sw-icon "compass" "h-4 w-4"}}</span>
        {{ company.name }}
      </a>
    </div>
    <div class="navbar-end">{{sw-theme-toggle}}</div>
    {{!-- backdrop (closes on click) --}}
    <label for="sw-nav-drawer" class="pointer-events-none fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-300 peer-checked:pointer-events-auto peer-checked:opacity-100" aria-hidden="true"></label>
    {{!-- slide-in panel --}}
    <div class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] -translate-x-full flex-col bg-base-100 shadow-2xl transition-transform duration-300 peer-checked:translate-x-0">
      <div class="flex items-center justify-between border-b border-base-200 p-4">
        <a class="flex items-center gap-2 text-base font-bold tracking-tight" href="{{sw-url '/'}}"><span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-content">{{sw-icon "compass" "h-4 w-4"}}</span>{{ company.name }}</a>
        <label for="sw-nav-drawer" class="btn btn-ghost btn-square btn-sm" aria-label="Close">{{sw-icon "x" "h-5 w-5"}}</label>
      </div>
      <ul class="menu w-full flex-1 overflow-y-auto overflow-x-hidden p-3">
        {{#each nav.mobile}}{{#if children}}<li><details><summary>{{sw-label}}</summary><ul><li><a href="{{sw-url path}}" class="{{#if (sw-active path exact=true)}}active{{/if}}">{{sw-label}}</a></li>{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}</ul></details></li>{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/if}}{{else}}{{!-- no "Mobile menu" pages yet → mirror the main navigation --}}{{#each nav.header}}{{#if children}}<li><details><summary>{{sw-label}}</summary><ul><li><a href="{{sw-url path}}" class="{{#if (sw-active path exact=true)}}active{{/if}}">{{sw-label}}</a></li>{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}</ul></details></li>{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/if}}{{/each}}{{/each}}
      </ul>
      {{#if page.translations}}
      <div class="border-t border-base-200 p-3">
        <div class="flex flex-wrap gap-1" aria-label="{{sw-translate "aria_language" default='Language'}}">{{#each page.translations}}<a class="btn btn-ghost btn-sm gap-1.5" href="{{sw-url path}}" hreflang="{{locale}}">{{sw-flag (lookup @root.website.data.locale_flags locale) "h-3.5 w-5 rounded-sm"}}<span class="uppercase">{{locale}}</span></a>{{/each}}</div>
      </div>
      {{/if}}
    </div>
  </div>
</div>`,
  },
  {
    name: 'nav-footer',
    label: 'Footer (data-driven)',
    category: 'chrome',
    description:
      'A data-driven site footer: brand + a main-nav column (nav.header), a legal column (nav.footer), social icons, and a copyright line.',
    demonstrates: ['nav.header', 'nav.footer', 'company.social', 'sw-label', 'sw-active'],
    // Goes in the FOOTER slot — the skeleton wraps it in <footer id="footer"> (so no <footer> here).
    source: `<div class="bg-neutral text-neutral-content">
  <div class="mx-auto grid max-w-6xl gap-x-8 gap-y-10 px-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
    <div class="sm:col-span-2">
      <a class="flex items-center gap-2.5 text-lg font-bold" href="{{sw-url '/'}}"><span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-content">{{sw-icon "compass" "h-4.5 w-4.5"}}</span>{{ company.name }}</a>
      <p class="mt-3 max-w-sm text-sm text-neutral-content/70" data-sw-text="footer_tagline">A short line about what you do.</p>
      {{#if company.social}}<ul class="mt-5 flex flex-wrap gap-2">{{#each company.social}}<li><a class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-content/15 text-neutral-content/70 transition hover:border-primary hover:bg-primary hover:text-primary-content" href="{{sw-url link}}" aria-label="{{name}}" target="_blank" rel="noopener">{{sw-icon icon "h-4 w-4"}}</a></li>{{/each}}</ul>{{/if}}
    </div>
    <div>
      <p class="text-xs font-semibold uppercase tracking-wider text-neutral-content/50">{{sw-translate "footer.menu" default="Menu"}}</p>
      <ul class="mt-3 space-y-2 text-sm">{{#each nav.header}}<li><a class="text-neutral-content/70 transition hover:text-neutral-content{{#if (sw-active path)}} font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <p class="text-xs font-semibold uppercase tracking-wider text-neutral-content/50">{{sw-translate "footer.legal" default="Legal"}}</p>
      <ul class="mt-3 space-y-2 text-sm">{{#each nav.footer}}<li><a class="text-neutral-content/70 transition hover:text-neutral-content{{#if (sw-active path)}} font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
    </div>
  </div>
  <div class="border-t border-neutral-content/10 px-6 py-5 text-center text-xs text-neutral-content/60">&copy; {{ company.name }}. All rights reserved.</div>
</div>`,
  },
  {
    name: 'navbar',
    label: 'Navbar — simple (data-driven)',
    category: 'chrome',
    description:
      'A simple top bar driven by the page tree (nav.header) with hover dropdowns + active highlighting. No mobile drawer — use nav-header for the full default.',
    demonstrates: ['nav.header', 'sw-active', 'sw-label', 'dropdown-hover', 'sw-url'],
    // Goes in the MAIN NAVIGATION slot. Every page you add to the "Main navigation" slot (page settings)
    // appears here, in order; "Show child pages in dropdown" gives a hover dropdown whose parent stays a
    // real link. The skeleton wraps this in <nav id="main-nav"> — no <nav> here.
    source: `<div class="navbar bg-base-100 shadow-sm">
  <div class="flex-1"><a class="btn btn-ghost text-xl" href="{{sw-url '/'}}">{{ company.name }}</a></div>
  <div class="flex-none">
    <ul class="menu menu-horizontal gap-1 px-1">
      {{#each nav.header}}
      {{#if children}}
      <li class="dropdown dropdown-hover">
        <a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}} {{sw-icon "chevron-down" "h-4 w-4 opacity-60"}}</a>
        <ul class="dropdown-content menu z-30 w-52 rounded-xl border border-base-200 bg-base-100 p-2 shadow-xl">{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}</ul>
      </li>
      {{else}}
      <li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>
      {{/if}}
      {{/each}}
    </ul>
  </div>
</div>`,
  },
  {
    name: 'cookie-consent',
    label: 'Cookie consent banner',
    category: 'chrome',
    description:
      'A consent banner that the runtime reveals only until accepted (stored in localStorage). Place it ONCE site-wide.',
    demonstrates: ['cookie-consent', 'data-sw-part:accept', 'hidden'],
    // Ships HIDDEN (the `hidden` attribute is REQUIRED) — the runtime reveals it only when consent
    // is not yet stored, and the accept button hides it for good. Put this ONCE in the website
    // `bottom` slot (not per page); give a second banner a different data-cookiename to track separately.
    source: `{{!-- Place ONCE in the website "bottom" slot. The "hidden" attribute is required. --}}
<div data-sw-component="cookie-consent" hidden class="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t border-base-300 bg-base-100 p-4 text-sm shadow-lg">
  <p class="text-base-content/70">We use a few essential cookies. <a class="link" href="/privacy">Learn more</a>.</p>
  <button type="button" class="btn btn-primary btn-sm" data-sw-part="accept">OK, got it</button>
</div>`,
  },
  {
    name: 'notice-card',
    label: 'Notice — promo card',
    category: 'chrome',
    description: 'A free-content dismissible promo card (corner). "Don\'t show again" remembers the dismissal forever.',
    demonstrates: ['notice', 'data-sw-part:dismiss-forever', 'data-frequency', 'data-position'],
    // Ships HIDDEN (the `hidden` attribute is REQUIRED). The runtime reveals it until dismissed.
    // Give each notice a UNIQUE data-sw-notice-id so dismissals are remembered independently.
    source: `{{!-- A dismissible promo card. Place ONCE (a chrome slot or a single page body). --}}
<div data-sw-component="notice" data-sw-notice-id="promo" data-position="bottom-right" data-frequency="once" hidden>
  <p>To see our latest product, <a class="link link-primary" href="{{sw-url "products"}}">click here</a>.</p>
  <button type="button" class="btn btn-sm btn-ghost" data-sw-part="dismiss-forever">Don't show again</button>
</div>`,
  },
  {
    name: 'notice-bar',
    label: 'Notice — announcement bar',
    category: 'chrome',
    description: 'A full-width top announcement bar that reappears once per browser session after dismissal.',
    demonstrates: ['notice', 'data-sw-part:dismiss', 'data-frequency:session', 'data-position:top'],
    source: `{{!-- A top announcement bar (returns once per session after dismissal). --}}
<div data-sw-component="notice" data-sw-notice-id="announce" data-position="top" data-frequency="session" hidden>
  <p>Free shipping this week — <a class="link" href="{{sw-url "shop"}}">shop now</a>.</p>
  <button type="button" class="btn btn-sm btn-ghost btn-circle" data-sw-part="dismiss" aria-label="Dismiss">{{sw-icon "x" "h-5 w-5"}}</button>
</div>`,
  },
  {
    name: 'notice-modal',
    label: 'Notice — centered card',
    category: 'chrome',
    description: 'A centered notice that fades in after a short delay, with a "remind me later" snooze and a permanent dismiss.',
    demonstrates: ['notice', 'data-sw-part:remind', 'data-delay', 'data-remind-days', 'data-position:center'],
    source: `{{!-- A centered welcome notice; fades in after a short delay. --}}
<div data-sw-component="notice" data-sw-notice-id="welcome" data-position="center" data-frequency="once" data-delay="1200" data-remind-days="7" hidden>
  <div>
    <h3 class="mb-1 text-lg font-semibold">Welcome!</h3>
    <p>Thanks for visiting. Read <a class="link link-primary" href="{{sw-url "about"}}">our story</a>.</p>
  </div>
  <div class="flex w-full justify-end gap-2">
    <button type="button" class="btn btn-sm btn-ghost" data-sw-part="remind">Later</button>
    <button type="button" class="btn btn-sm btn-primary" data-sw-part="dismiss-forever">Got it</button>
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
  {
    name: 'parallax-hero',
    label: 'Parallax — depth scene',
    category: 'effects',
    description:
      'A clipping scene of stacked layers: the background and the heading move at different rates on scroll (data-sw-parallax-scene / -layer).',
    demonstrates: ['data-sw-parallax-scene', 'data-sw-parallax-layer', 'data-sw-parallax-translate', 'data-sw-text'],
    // data-sw-parallax-scene clips the band; each data-sw-parallax-layer is an absolutely-positioned,
    // independently-animated layer. data-sw-parallax-translate="from,to" (px) slides a layer as the band
    // crosses the viewport — oversize a translating cover layer (inline inset) so no edge shows. The
    // runtime only ships when used and bails under prefers-reduced-motion. Any element also supports
    // -opacity / -scale / -blur (from,to), each with its own -range window + optional -out phase.
    source: `{{!-- A scroll-linked depth scene. Any element also takes data-sw-parallax-opacity="0,1" / -scale=".9,1.05". --}}
<section data-sw-parallax-scene class="my-10 flex min-h-[60vh] items-center justify-center overflow-hidden rounded-3xl px-6">
  <div data-sw-parallax-layer data-sw-parallax-translate="70,-70" class="bg-gradient-to-br from-primary to-secondary" style="inset:-14% 0"></div>
  <div data-sw-parallax-layer data-sw-parallax-translate="0,-30" class="grid place-items-center px-6 text-center text-white">
    <div>
      <h2 class="text-4xl font-bold tracking-tight drop-shadow-lg sm:text-6xl" data-sw-text="page.data.parallax_title">Depth scene</h2>
      <p class="mx-auto mt-3 max-w-xl text-lg text-white/85" data-sw-text="page.data.parallax_lead">Stacked layers move at different rates as you scroll past.</p>
    </div>
  </div>
</section>`,
  },
  {
    name: 'shader-hero',
    label: 'Shader background hero',
    category: 'effects',
    description:
      'A WebGL animated background (data-sw-component="shader-bg"), CI-themed, with a legibility overlay scrim.',
    demonstrates: ['shader-bg', 'data-preset', 'data-sw-part:overlay', 'data-sw-text'],
    // The runtime draws the chosen preset on a canvas BEHIND the content (never author a canvas). The
    // optional data-sw-part="overlay" is a scrim for text contrast. Falls back to a CI gradient with no
    // JS, pauses offscreen, and is reduced-motion aware. 30 presets via data-preset.
    source: `{{!-- WebGL animated hero. Swap data-preset (e.g. "silk-flow", "caustics", "plasma"). --}}
<section data-sw-component="shader-bg" data-preset="mesh-gradient" data-speed="1" data-intensity="0.5" class="relative flex min-h-[70vh] items-center justify-center overflow-hidden rounded-3xl">
  <div data-sw-part="overlay" class="bg-black/30"></div>
  <div class="relative z-10 max-w-2xl px-6 text-center text-white">
    <h2 class="text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="page.data.shader_title">Animated background</h2>
    <p class="mt-4 text-lg text-white/85" data-sw-text="page.data.shader_lead">A CI-themed WebGL hero — content sits above the canvas.</p>
  </div>
</section>`,
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
