// The MACHINE-READABLE authoring contract for the platform's first-party interactive
// components (the `data-sw-component` runtime). This is the single source of truth that
// the MCP `get_components` tool, the REST `GET /authoring/components` endpoint, and the
// human docs all serve — so agents discover the markup contracts structurally instead of
// relying on prose instructions alone. Pure data (JSON-safe), no behavior.
//
// Kept in lock-step with the runtime registry in `@sitewright/blocks` (components.ts):
// a test there asserts the catalog's `type` set equals `COMPONENT_TYPES`, that every
// `skeleton` passes the template validator, and that the component scanner detects each
// skeleton — so the catalog can never drift from what actually ships.

/** One `data-sw-part` role inside a component's markup. */
export interface ComponentPart {
  /** The `data-sw-part` attribute value. */
  part: string;
  /** The expected element (informational; the runtime queries by part, not tag). */
  element: string;
  required: boolean;
  description: string;
}

/** One configuration attribute a component reads. */
export interface ComponentAttribute {
  name: string;
  /** Which element carries it (e.g. "root", "panel", "item"). */
  on: string;
  description: string;
}

/** A worked, copy-paste example beyond the canonical `skeleton` (e.g. an alternate authoring form). */
export interface ComponentCatalogExample {
  /** Short heading for the example. */
  label: string;
  /** The copy-paste snippet (illustrative — may be a fragment; only `skeleton` is validator-checked). */
  code: string;
  /** Optional caveat / cross-reference. */
  note?: string;
}

/** The authoring contract of one first-party interactive component. */
export interface ComponentCatalogEntry {
  /** Registry block type (matches `COMPONENT_TYPES` in @sitewright/blocks). */
  type: string;
  /** The `data-sw-component` activation marker value. */
  marker: string;
  summary: string;
  /**
   * `markup` — author the skeleton by hand. `embed` — never hand-author; produced by a
   * helper/render pass (the Form component is stamped by `{{sw-form}}` / `data-sw-form`).
   */
  authoring: 'markup' | 'embed';
  parts: ComponentPart[];
  attributes: ComponentAttribute[];
  /** Canonical, validator-safe markup (or helper call) to start from. */
  skeleton: string;
  /** Progressive-enhancement behavior when JavaScript is unavailable. */
  noJs: string;
  /** Usage guidance, incl. how this relates to the DaisyUI classes that look similar. */
  notes: string;
  /** Optional worked examples beyond the skeleton (alternate forms, layouts). Illustrative only. */
  examples?: ComponentCatalogExample[];
}

export const COMPONENT_CATALOG: readonly ComponentCatalogEntry[] = [
  {
    type: 'Carousel',
    marker: 'carousel',
    summary:
      'An Embla-powered slider: fade (default) or slide effect, arrows/dots/keyboard/swipe, looping, autoplay or continuous auto-scroll, wheel gestures, auto height, and multi-item/peek layouts via --sw-items.',
    authoring: 'markup',
    parts: [
      { part: 'track', element: 'div', required: true, description: 'The slide row (a CSS scroll-snap strip until the runtime enhances it).' },
      { part: 'slide', element: 'figure|div', required: true, description: 'One slide (any content). At least two slides for the runtime to engage. Slide margins are reset — author spacing as padding INSIDE the slide (e.g. px-2), never as margins.' },
      {
        part: 'prev',
        element: 'button',
        required: false,
        description:
          'Previous button (hidden until enhanced; give it an aria-label and a Lucide glyph, e.g. {{sw-icon "caret-double-left:bold" ""}}). A single-item slider styles it as a full-height gradient EDGE arrow by default; a multi-item layout (or data-arrows="circle") gives a compact left-overlay disc. Reposition/restyle freely with utility classes.',
      },
      {
        part: 'next',
        element: 'button',
        required: false,
        description: 'Next button (same rules as prev; {{sw-icon "caret-double-right:bold" ""}}). Full-height gradient EDGE arrow by default (single-item) or a right-overlay disc (multi-item / data-arrows="circle").',
      },
      {
        part: 'dots',
        element: 'div',
        required: false,
        description:
          'Empty mount; the runtime generates one indicator per snap point (aria-current marks the active one). Defaults to a bottom-center overlay — a frosted pill on single-item sliders. Reposition freely with utility classes.',
      },
    ],
    attributes: [
      { name: 'data-effect', on: 'root', description: '"fade" (default — crossfade) or "slide" (translating strip; REQUIRED for --sw-items/peek layouts).' },
      { name: 'data-loop', on: 'root', description: '"true" to wrap from the last slide to the first (also makes autoplay/auto-scroll endless).' },
      { name: 'data-autoplay', on: 'root', description: '"true" to auto-advance in steps (pauses on hover/focus; disabled under prefers-reduced-motion).' },
      { name: 'data-interval', on: 'root', description: 'Autoplay step interval in ms (default 5000).' },
      { name: 'data-autoscroll', on: 'root', description: '"true" for a CONTINUOUS ticker scroll instead of steps (marquee/logo-wall; wins over data-autoplay; pair with data-loop="true" and data-effect="slide").' },
      { name: 'data-autoscroll-speed', on: 'root', description: 'Auto-scroll speed in px per frame (default 2).' },
      { name: 'data-wheel', on: 'root', description: '"true" to navigate with mouse-wheel / trackpad gestures.' },
      { name: 'data-autoheight', on: 'root', description: '"true" to animate the track height to the in-view slide (slides of different heights). Requires data-effect="slide" — incompatible with the default fade effect.' },
      { name: 'data-align', on: 'root', description: 'Fallback snap alignment: "center" (default), "start", or "end". Prefer data-item-align (it covers both the scrolling snap AND the underfull-row case).' },
      { name: 'data-item-align', on: 'root', description: 'Horizontal alignment: "center" (DEFAULT), "start", or "end". Drives BOTH the Embla snap alignment (so "center" centres the ACTIVE slide with a peek on each side; with loop off, containScroll clamps the first slide left + last right) AND justify-content for an UNDERFULL row that does not scroll (fewer slides than --sw-items). Centre is a no-op for single-item full-width sliders (centre ≡ start); set "start" to left-align a multi-item slider.' },
      { name: 'data-arrows', on: 'root', description: 'Arrow STYLE override. By DEFAULT a single full-width slider gets full-height gradient EDGE arrows (the hero look) and a multi-item / peek layout (--sw-items > 1) gets compact CIRCLE arrows — the runtime picks by stamping data-sw-multi (re-checked at responsive breakpoints). Force it with data-arrows="edge" or "circle": a single-item CONTENT card slider (testimonials) usually wants "circle". The .sw-caption inside a slider also defaults to a frosted centered pill. All defaults are zero-specificity, so utility classes still restyle the buttons/caption.' },
      { name: 'data-kenburns', on: 'root', description: '"Standard hero" motion: the active slide\'s `.sw-kenburns` layer (a `<div data-sw-bg>` OR an `<img>`) slowly pans/zooms (alternating per slide) and its `.sw-caption` rises in. Keyframes ship with the component (no per-site CSS). Present (bare or `="on"`) enables the drift; `="off"` keeps the cover layout + caption motion but no zoom/pan. Pair with full-height slides each containing a `.sw-kenburns` background/image + a `.sw-caption` overlay. The `hero-slider` Widget ({{> hero-slider}}) is the ready-made, data-backed version (its Ken-Burns toggle drives this on/off).' },
      { name: 'data-click-next', on: 'root', description: 'Click/tap anywhere on a slide advances the carousel (the navigation-less pattern, with ripple feedback). DEFAULT ON for the hero/full-screen EDGE style (a single full-width slider) — opt out with data-click-next="false". A multi-item row or a data-arrows="circle" content slider keeps it OPT-IN — set data-click-next="true". Clicks on links/buttons/inputs inside a slide keep their own meaning; a drag never counts as a click; the root becomes keyboard-focusable so arrow keys still work.' },
    ],
    skeleton: `<div class="relative" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="true" data-interval="6000">
  <div data-sw-part="track">
    <figure data-sw-part="slide">Slide one content</figure>
    <figure data-sw-part="slide">Slide two content</figure>
  </div>
  <button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "caret-double-left:bold" ""}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "caret-double-right:bold" ""}}</button>
  <div data-sw-part="dots" aria-hidden="true"></div>
</div>`,
    noJs: 'The track is a CSS scroll-snap row — fully swipeable/scrollable; arrows and dots stay hidden so no inert controls show.',
    notes:
      'Slides-per-view is the --sw-items CSS variable on the root (Tailwind arbitrary properties): class="[--sw-items:1.15]" shows a peek of the next slide, class="[--sw-items:1] md:[--sw-items:3]" is a responsive 3-up — both REQUIRE data-effect="slide" (fade stacks full-width slides). Give slides internal padding (e.g. px-2) for gaps. For a FIXED-HEIGHT slider (hero), set the height ONCE on the ROOT (e.g. class="h-[60vh]") plus overflow-hidden to clip cleanly — the slides fill it automatically (no per-slide height); omit a root height for content/auto-height sliders. To drop a control, omit its part. Arrows and dots get a Material-style press ripple automatically (unbounded — it travels past the control; under data-click-next the WRAPPER ripples on slide presses; suppressed under prefers-reduced-motion; tap-highlight is transparent throughout). The runtime also adds role="region" + aria-roledescription="carousel" and a hidden live region announcing the active slide (silent while auto-rotating) — keep an aria-label on the root. The runtime stamps `data-active` on the slide(s) in the selected snap — a pure CSS styling hook: the attribute flip restarts matching keyframes, so per-activation effects (caption entrance, Ken Burns zoom on a background div) are authored as `[data-sw-part="slide"][data-active] .caption { animation: ... }`. Animate transform/inner elements only — the fade effect owns slide opacity. Hero sliders: slides can be plain divs with data-sw-bg backgrounds (no <img>) at a fixed height; a single-item slider ALREADY gets full-height gradient edge arrows + a frosted centered .sw-caption pill by default (set data-arrows="circle" for compact discs; every default is zero-specificity so utility classes still restyle it). DaisyUI\'s `carousel`/`carousel-item` classes are a plain scroll-snap STRIP (no arrows, dots, autoplay, or looping — its documented "buttons" are #anchor hacks). Use the DaisyUI classes as a layout primitive for a swipeable card row; use THIS component for any real slideshow.',
    examples: [
      {
        label: 'Full-screen hero (Ken Burns)',
        code: `<div class="relative h-[80vh] overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-effect="fade" data-loop="true" data-autoplay="true" data-kenburns aria-label="Highlights">
  <div data-sw-part="track">
    <figure data-sw-part="slide">
      <div class="sw-kenburns bg-gradient-to-br from-primary to-secondary" data-sw-bg="page.data.hero_1"></div>
      <div class="absolute inset-0 flex items-center justify-center bg-black/30"><div class="sw-caption text-white">…</div></div>
    </figure>
    <figure data-sw-part="slide">…</figure>
  </div>
</div>`,
        note: 'Height once on the ROOT; the .sw-kenburns layer is the cover (data-sw-bg or <img>), the .sw-caption rises in. Full worked recipe: the `slider-fullscreen` snippet ({{> slider-fullscreen}}).',
      },
      {
        label: 'Multi-item peek (--sw-items)',
        code: `<div class="relative [--sw-items:1.15] md:[--sw-items:2.4] lg:[--sw-items:3.2]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-item-align="center">
  <div data-sw-part="track">
    <figure data-sw-part="slide" class="px-3">…card…</figure>
    <figure data-sw-part="slide" class="px-3">…card…</figure>
  </div>
</div>`,
        note: 'Fractional --sw-items leaves a peek; REQUIRES data-effect="slide"; gap is padding INSIDE the slide. Recipe: {{> slider-multi}}.',
      },
      {
        label: 'Logo-wall ticker (auto-scroll)',
        code: `<div class="relative [--sw-items:2] md:[--sw-items:5]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-autoscroll="true" data-autoscroll-speed="1.2">
  <div data-sw-part="track"><figure data-sw-part="slide" class="px-4">{{sw-icon "brand:react" "h-9 w-auto"}}</figure>…</div>
</div>`,
        note: 'Continuous marquee (pair data-autoscroll + data-loop + data-effect="slide"); pauses on hover/focus. Recipe: {{> slider-logowall}}.',
      },
      {
        label: 'Bound to a dataset',
        code: `<div class="relative" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true">
  <div data-sw-part="track">
    {{#each dataset.projects}}
    <figure data-sw-part="slide"><img src="{{sw-url image}}" alt="{{title}}" loading="lazy" /></figure>
    {{/each}}
  </div>
</div>`,
        note: 'One slide per dataset entry; fields are read directly inside the loop. Recipe: {{> slider-dataset}}.',
      },
    ],
  },
  {
    type: 'Tabs',
    marker: 'tabs',
    summary: 'Content panels behind an accessible APG tablist (roving tabindex, arrow keys); the runtime builds the tab buttons from each panel title and slides a floating primary "magic" selector to the active tab.',
    authoring: 'markup',
    parts: [
      { part: 'panel', element: 'div', required: true, description: 'One content panel; any markup inside. Give it a data-sw-title — the runtime builds a tab button from it and adds role="tabpanel".' },
      { part: 'tablist', element: 'div', required: false, description: 'OPTIONAL mount for the tab buttons. Omit it and the runtime creates one as the first child; author one only to position/style the tab bar (e.g. add classes).' },
      { part: 'tabtitle', element: 'span', required: false, description: 'OPTIONAL rich tab label: a DIRECT child of a panel holding NON-interactive markup (an icon, <b>, a badge — NO <a>/<button>/<input>, since the nodes move into a <button>). The runtime MOVES its nodes into the tab button — so the label can be HTML, safely (it is normal server-rendered markup, not the raw attribute). Optional and PER-PANEL: a panel WITHOUT a tabtitle just uses its data-sw-title text, so rich and plain tabs can be mixed in one component; keep data-sw-title alongside a tabtitle as the accessible name for icon-only labels.' },
    ],
    attributes: [{ name: 'data-sw-title', on: 'panel', description: 'The tab button label for this panel — PLAIN TEXT (interpolation allowed, e.g. a page.data key for i18n). For an HTML label use a data-sw-part="tabtitle" child instead; the attribute then becomes the aria-label.' }],
    skeleton: `<div data-sw-component="tabs">
  <div data-sw-part="panel" data-sw-title="First tab">First panel content</div>
  <div data-sw-part="panel" data-sw-title="Second tab">Second panel content</div>
</div>`,
    noJs: 'The tablist stays hidden and ALL panels render stacked — every panel remains readable.',
    notes:
      "Use this whenever tabs switch CONTENT. The markup is minimal: a `data-sw-component=\"tabs\"` root with a `data-sw-part=\"panel\"` per tab — the runtime generates the tablist (creating the mount if you omit it), the tab buttons, the ARIA roles, and roving tabindex (no `data-sw-block` or `role=` attributes to author). Tab labels are BOLD; the active tab shows white text over a floating primary selector pill that glides to it; inactive tabs use the default text colour and turn primary on hover; the buttons get a press ripple; and each panel fades in (re-triggers on every switch). **Labels are per-panel and you can MIX them:** for a PLAIN label give the panel `data-sw-title=\"…\"`; for an HTML label add a `data-sw-part=\"tabtitle\"` element as a DIRECT child of the panel. The tabtitle is OPTIONAL — a panel without one falls back to its `data-sw-title` text (and a panel with neither gets a `Tab N` label), so some tabs can be rich while others stay plain in the same component. For the HTML path the runtime moves the tabtitle's (already server-rendered) nodes into the button, so it is XSS-safe in a way `data-sw-title` HTML never could be (the attribute resolves from content-editor-editable page.data and is therefore always escaped to text); keep `data-sw-title` alongside a tabtitle as the accessible name. Put only NON-interactive markup in a tabtitle (no `<a>`/`<button>`/`<input>` — the nodes become children of the generated `<button>`). Author a `data-sw-part=\"tablist\"` element yourself only to style the tab bar (e.g. `class=\"px-2\"`) — the runtime still fills it. DaisyUI's `tabs`/`tab` classes are for tab-STYLED navigation links (a row of links that navigate); do not build DaisyUI radio-input content tabs — they lack tablist semantics and their adjacency-dependent markup is brittle.",
    examples: [
      {
        label: 'Mixed labels — rich (tabtitle) + plain (data-sw-title)',
        code: '<div data-sw-component="tabs">\n  <!-- rich: icon + text moved into the button; data-sw-title is the aria-label -->\n  <div data-sw-part="panel" data-sw-title="Overview">\n    <span data-sw-part="tabtitle">{{sw-icon "sparkle" "size-4"}} Overview</span>\n    Panel one content\n  </div>\n  <!-- plain: no tabtitle, so the data-sw-title text is used as the label -->\n  <div data-sw-part="panel" data-sw-title="Pricing">\n    Panel two content\n  </div>\n</div>',
        note: 'tabtitle is optional and per-tab: the first tab gets an HTML label (nodes moved in, no XSS sink), the second falls back to its data-sw-title text — mix freely.',
      },
    ],
  },
  {
    type: 'Lightbox',
    marker: 'lightbox',
    summary:
      'A full-screen gallery viewer: images open into a viewer with a bottom thumbnail strip, an enlarge-from-thumbnail open animation, a header image-counter + caption, swipe / pinch-zoom / keyboard navigation, and a per-image loader. Put data-sw-component="lightbox" on a single <img> (one-image lightbox), on a <div> of <img>/<a> children (a gallery), or use the explicit styled-grid parts below. Each component root is its own gallery.',
    authoring: 'markup',
    parts: [
      { part: 'grid', element: 'div', required: false, description: 'EXPLICIT form only: the thumbnail grid (gives the styled uniform square-cover grid + !grid-cols-* control). Omit it — and data-sw-part — for the one-line minimal forms; see notes.' },
      {
        part: 'item',
        element: 'a',
        required: false,
        description:
          'EXPLICIT form only: one thumbnail — an anchor whose href is the FULL-SIZE image, containing an <img> thumbnail. Every item MUST contain an <img> (the viewer clones it for the open animation + the strip). href and the <img src> MAY DIFFER (small thumbnail tile, large full image).',
      },
    ],
    attributes: [
      { name: 'data-caption', on: 'item', description: 'Caption shown in the viewer header bar for this image (tenant-trusted text; never bind visitor input). Works on an item anchor OR a bare <img>.' },
      { name: 'data-full', on: 'item', description: 'MINIMAL form: on a bare <img>, the FULL-SIZE image URL the viewer opens (the img src stays the thumbnail). Use {{sw-url …}}. (In the explicit form the anchor href is the full image instead.)' },
      { name: 'data-gallery', on: 'root', description: 'Merge into a NAMED gallery: every lightbox on the page with the same data-gallery="…" — across sections, and across the single-<img> / div / explicit forms — opens as ONE combined gallery (clicking any image opens it at that image). Without it, each root is its own gallery. Works on a one-line <img> too. Group options come from the first element with that name.' },
      { name: 'data-thumbnails', on: 'root', description: '"false" to hide the bottom thumbnail strip (shown by default).' },
      { name: 'data-arrows', on: 'root', description: '"false" to hide the prev/next arrows (shown by default).' },
      { name: 'data-animation', on: 'root', description: '"false" to disable the enlarge-from-thumbnail open animation (auto-disabled under prefers-reduced-motion).' },
      { name: 'data-fit', on: 'root', description: 'How the image sits in the viewport: "fit" (default, whole image) or "fill" (cover the screen on touch).' },
      { name: 'data-tilt', on: 'root', description: '"true" to pan the zoomed image with the device accelerometer on mobile (off by default).' },
      { name: 'data-history', on: 'root', description: '"true" to reflect the open image in the URL hash (off by default — a CMS page should not hijack the hash).' },
    ],
    skeleton: `<div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="Gallery">
  <div data-sw-part="grid" class="gap-3 !grid-cols-2 md:!grid-cols-4">
    {{#sw-folder "Gallery" kind="image"}}
    <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="overflow-hidden rounded-2xl">
      <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" />
    </a>
    {{/sw-folder}}
  </div>
</div>`,
    noJs: 'Each thumbnail is a plain link to the full image — clicking simply opens it.',
    notes:
      'The viewer DOM is built entirely by the runtime (no overlay element to author). THREE authoring forms: (1) ONE LINE — a single image: `<img data-sw-component="lightbox" src="{{sw-url thumb}}" data-full="{{sw-url full}}" data-caption="…" alt="…">` (data-full optional; omit it and the src is used full-size). (2) MINIMAL GALLERY — a container of images: `<div data-sw-component="lightbox" class="grid grid-cols-4 gap-2">` whose children are bare `<img>` or `<a href><img></a>` (bare imgs are auto-wrapped; you style the container layout yourself). (3) EXPLICIT — the styled-grid skeleton above (data-sw-block + data-sw-part) for the batteries-included uniform square-cover grid + thumbnail strip. Every image must be an `<img>` (the open animation clones it). PE note: the `<a href>` forms open the full image with NO JS; a bare `<img>` only opens via JS (the image still shows without it). The strip, arrows, open animation, fit, tilt, and URL-hash are toggled via data-* (see attributes). Multiple lightboxes on one page are independent galleries by default; give them a shared data-gallery="name" to MERGE them into one combined gallery (images grouped across sections / forms). For a polished explicit tile, keep the `<img>` and add a DaisyUI .skeleton loader behind + a dim gradient overlay; match the tile aspect to the image (or use a masonry: `class="block columns-2 sm:columns-3"` + natural-aspect imgs) to avoid cropping. DaisyUI has no gallery/lightbox equivalent. Pairs naturally with a {{#sw-folder}} loop or a dataset loop.',
    examples: [
      {
        label: 'Single image (one line)',
        code: '<img data-sw-component="lightbox" data-thumbnails="false" src="{{sw-url thumb}}" data-full="{{sw-url full}}" data-caption="A quiet corner of the studio" alt="Studio" class="mx-auto block w-full max-w-3xl rounded-2xl" />',
        note: 'The whole lightbox in one element. data-full is optional — omit it and the src is used full-size.',
      },
      {
        label: 'Gallery (minimal)',
        code: '<div data-sw-component="lightbox" class="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Studio gallery">\n  {{#sw-folder "Studio" kind="image"}}\n  <a href="{{sw-url url}}" data-caption="{{alt}}">\n    <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" class="aspect-[4/3] w-full rounded-xl object-cover" />\n  </a>\n  {{/sw-folder}}\n</div>',
        note: 'Any container of <img> or <a href><img> children; you style the layout. Bare <img>s are auto-wrapped.',
      },
      {
        label: 'Thumbnail vs full-size',
        code: '<!-- bare image: small thumb in the tile, large image in the viewer -->\n<img data-sw-component="lightbox" src="{{sw-url thumb}}" data-full="{{sw-url full}}" data-caption="…">\n\n<!-- anchor form: the href is the full image -->\n<a data-sw-part="item" href="{{sw-url full}}" data-caption="…">\n  <img src="{{sw-url thumb}}" alt="…">\n</a>',
        note: 'The viewer opens href / data-full (full); the inline <img src> is the thumbnail. Every item MUST contain an <img>.',
      },
      {
        label: 'Masonry (mixed aspect, no crop)',
        code: '<div data-sw-component="lightbox" class="block columns-2 gap-4 sm:columns-3" aria-label="Gallery">\n  {{#sw-folder "Projects" kind="image"}}\n  <a href="{{sw-url url}}" data-caption="{{alt}}" class="mb-4 block break-inside-avoid overflow-hidden rounded-xl">\n    <img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="block w-full" />\n  </a>\n  {{/sw-folder}}\n</div>',
        note: 'CSS columns + natural-aspect images stagger without cropping. width/height reserve space (no layout shift).',
      },
      {
        label: 'Group across sections (data-gallery)',
        code: '<section> … <img data-sw-component="lightbox" data-gallery="tour" src="{{sw-url a}}" data-caption="Exterior"> </section>\n<section> … <img data-sw-component="lightbox" data-gallery="tour" src="{{sw-url b}}" data-caption="Interior"> </section>\n<!-- click either image → one combined gallery -->',
        note: 'A shared data-gallery name merges lightboxes across sections / forms into one gallery.',
      },
    ],
  },
  {
    type: 'Modal',
    marker: 'modal',
    summary: 'A trigger that opens a native <dialog> — focus trap, Escape, ::backdrop, and background inerting come from the browser; centered in the viewport, page scroll locked while open, and a styled close button added automatically.',
    authoring: 'markup',
    parts: [
      { part: 'close', element: 'button|a', required: false, description: 'OPTIONAL extra close control inside the dialog — the styled top-right close button is added automatically, so you only need this for an additional in-content "Close"/"Got it" button. Any number are wired; place and style them yourself. (The LEGACY wrapper form also uses data-sw-part="open" for the trigger and data-sw-part="dialog" for the <dialog> — see notes.)' },
    ],
    attributes: [
      { name: 'id', on: 'root', description: 'On the <dialog> — the id a trigger references. Open it from anywhere on the page with <a href="#<id>"> or any element carrying data-sw-modal="<id>".' },
      { name: 'data-sw-modal', on: 'trigger', description: 'On a trigger element anywhere on the page: opens the modal whose <dialog> id matches — the alternative to <a href="#<id>"> for a <button> or other non-anchor trigger.' },
      { name: 'data-closebutton', on: 'root', description: '"false" hides the auto-injected top-right close button (default shows it — a brand-primary rounded square with a white icon that zooms + spins 180° on hover). Escape and authored close buttons still dismiss.' },
      { name: 'data-backdrop-close', on: 'root', description: '"false" keeps the modal open when the backdrop is clicked (default: a backdrop click closes it). Useful for a forced-choice / confirm dialog.' },
      { name: 'data-close-label', on: 'root', description: 'Accessible label for the auto close button (default "Close"); set it per-locale for i18n, e.g. data-close-label="{{page.data.close_label}}".' },
      { name: 'data-allow-multiple', on: 'root', description: '"true" lets this modal STACK with others (the older behavior). By default only ONE modal is open at a time — opening a modal (e.g. from a trigger inside another modal) first dismisses any other open modal. The opt-out is symmetric: a modal marked data-allow-multiple="true" neither dismisses others when it opens nor is dismissed when another opens.' },
    ],
    skeleton: `<a href="#welcome" class="btn">What happens next?</a>
<dialog id="welcome" data-sw-component="modal">
  <h2 class="text-xl font-bold">Dialog title</h2>
  <p class="mt-3 text-sm">Dialog body content.</p>
</dialog>`,
    noJs: 'The trigger does nothing — the page remains fully usable; never put essential content only inside a modal.',
    notes:
      "This is the ONLY modal that works on this platform: DaisyUI's <dialog> method requires an inline onclick (rejected by the template validator) and its hidden-checkbox method has no focus trap or Escape handling. AUTHORING (lighter form, preferred): put id + data-sw-component=\"modal\" on the <dialog> and open it from any <a href=\"#<id>\"> or [data-sw-modal=\"<id>\"] trigger anywhere on the page — no wrapper or data-sw-part needed; config attrs (data-closebutton / -backdrop-close / -close-label / -allow-multiple) go on the <dialog>. By DEFAULT only one modal is open at a time (opening one dismisses another — a modal opened from inside a modal replaces it); set data-allow-multiple=\"true\" to stack. LEGACY form (still supported): a data-sw-component=\"modal\" wrapper holding [data-sw-part=\"open\"] + a [data-sw-part=\"dialog\"] <dialog>. A styled close button is injected automatically (top-right, brand-primary, white icon, hover zoom + icon spin) — do NOT hand-author one unless you want an ADDITIONAL close control; suppress it with data-closebutton=\"false\". A bare <dialog> (no classes) renders on the global background/text colour with rounded corners and 1.5rem padding; add utility classes to override (the defaults are zero-specificity, so no !important needed). The backdrop dims AND blurs, fading in and out. Style the dialog content with normal Tailwind/DaisyUI classes.",
    examples: [
      {
        label: 'Link trigger + editable body',
        code: `<a href="#how-it-works" class="btn btn-primary">What happens next?</a>
<dialog id="how-it-works" data-sw-component="modal" data-close-label="Close" class="max-w-lg">
  <h2 class="text-xl font-bold" data-sw-text="modal_title">How it works</h2>
  <div class="prose mt-3 max-w-none" data-sw-html="page.data.modal_body">…</div>
</dialog>`,
        note: 'Open from any <a href="#id">; the close button is auto-injected. Full recipe: the `modal-basic` snippet ({{> modal-basic}}).',
      },
      {
        label: 'Forced-choice confirm',
        code: `<button type="button" class="btn" data-sw-modal="confirm-delete">Delete</button>
<dialog id="confirm-delete" data-sw-component="modal" data-backdrop-close="false" data-closebutton="false">
  <p>This can't be undone.</p>
  <button type="button" class="btn btn-ghost" data-sw-part="close">Cancel</button>
  <a class="btn btn-error" href="/contact">Confirm</a>
</dialog>`,
        note: 'data-sw-modal opens from a <button>; data-backdrop-close="false" forces a choice. Recipe: {{> modal-confirm}}.',
      },
    ],
  },
  {
    type: 'Banner',
    marker: 'banner',
    summary:
      'A free-content dismissible banner / announcement (promos, "see our latest product"). You author the content + the action buttons; the runtime reveals it and remembers the dismissal in localStorage per its frequency. Server HTML ships it hidden. NOT the cookie/consent banner — that is the auto-injected Consent Manager.',
    authoring: 'markup',
    parts: [
      { part: 'dismiss', element: 'button', required: false, description: 'Dismisses the banner for the configured data-frequency (for "once", permanently).' },
      { part: 'dismiss-forever', element: 'button', required: false, description: 'Permanently dismisses ("don\'t show again") regardless of frequency.' },
      { part: 'remind', element: 'button', required: false, description: 'Snoozes the banner; it reappears after data-remind-days (default 1).' },
    ],
    attributes: [
      { name: 'hidden', on: 'root', description: 'REQUIRED in the authored markup — without JS (or once dismissed) the banner never shows.' },
      {
        name: 'data-sw-banner-id',
        on: 'root',
        description: 'The localStorage key suffix the dismissal is stored under (default "default"). Give EACH banner a unique id so they are remembered independently.',
      },
      {
        name: 'data-frequency',
        on: 'root',
        description: 'How often it reappears after a plain dismiss: "once" (default, permanent), "session", "days:N", or "always" (never persisted — shows every load until dismissed).',
      },
      {
        name: 'data-position',
        on: 'root',
        description: 'Placement: bottom | top | bottom-left | bottom-right (default) | top-left | top-right | center | inline.',
      },
      { name: 'data-delay', on: 'root', description: 'Optional. Milliseconds to wait before showing, or "scroll" to reveal after the first scroll. Works on every placement.' },
      { name: 'data-remind-days', on: 'root', description: 'Optional. Days the "remind" button snoozes for (default 1).' },
      { name: 'data-sw-animation', on: 'root', description: 'Optional. A scroll-reveal effect (fade-up | zoom-in | flip-left | …) used for the ENTRANCE instead of the built-in fade+rise; data-sw-delay/-duration/-easing tune it. The dismiss reverses whichever entrance was used. On an inline (in-flow) banner prefer a plain "fade" — a transform effect animates the banner over its reserved box.' },
    ],
    examples: [
      {
        label: 'Top announcement bar with a data-sw-animation entrance + reveal delay',
        code: `<div data-sw-component="banner" data-sw-banner-id="sale" data-position="top" data-frequency="session" data-sw-animation="fade-up" data-sw-duration="600" data-delay="800" hidden>
  <p>Free shipping this week — <a class="link" href="{{sw-url "shop"}}">shop now</a>.</p>
  <button type="button" class="btn btn-sm btn-ghost btn-circle" data-sw-part="dismiss" aria-label="Dismiss">{{sw-icon "x" "h-5 w-5"}}</button>
</div>`,
        note: 'data-position="top"|"bottom" = full-width bar; data-delay reveals it after 800ms; data-sw-animation="fade-up" drives the entrance (the dismiss reverses it). data-frequency="session" → returns next browser session.',
      },
      {
        label: 'Centered welcome card, snooze + permanent dismiss',
        code: `<div data-sw-component="banner" data-sw-banner-id="welcome" data-position="center" data-frequency="once" data-delay="1200" data-remind-days="7" hidden>
  <div><h3 class="mb-1 text-lg font-semibold">Welcome!</h3><p>Thanks for visiting.</p></div>
  <div class="flex w-full justify-end gap-2">
    <button type="button" class="btn btn-sm btn-ghost" data-sw-part="remind">Later</button>
    <button type="button" class="btn btn-sm btn-primary" data-sw-part="dismiss-forever">Got it</button>
  </div>
</div>`,
        note: 'data-position="center" is a NON-modal centered card (no focus trap). "remind" snoozes for data-remind-days (7); "dismiss-forever" hides it for good. Recipe: banner-modal.',
      },
      {
        label: 'Full-bleed background (photo or live shader) — inner wrapper required',
        code: `<div data-sw-component="banner" data-sw-banner-id="promo" data-position="inline" class="overflow-hidden border-0 p-0 text-white" hidden>
  <div class="relative flex w-full items-center gap-3 p-4">       <!-- INNER positioning context (an inline banner is position:static) -->
    <div data-sw-component="shader-bg" data-preset="silk-flow" class="absolute inset-0"></div>  <!-- or: <img class="absolute inset-0 h-full w-full object-cover" src="…"> -->
    <div class="absolute inset-0 bg-black/30"></div>             <!-- legibility scrim -->
    <div class="relative grow"><p class="font-semibold">Now showing: summer collection</p></div>
    <button type="button" class="btn btn-sm btn-ghost relative text-white" data-sw-part="dismiss" aria-label="Dismiss">{{sw-icon "x" "h-5 w-5"}}</button>
  </div>
</div>`,
        note: 'GOTCHA: an inline banner is position:static, so the absolute media/scrim MUST live in an INNER relative wrapper (else they escape to the viewport). overflow-hidden clips to the rounded corners; set a light text colour over the scrim.',
      },
    ],
    skeleton: `<div data-sw-component="banner" data-sw-banner-id="promo" data-position="bottom-right" data-frequency="once" hidden>
  <p>To see our latest product, <a class="link" href="{{sw-url "products"}}">click here</a>.</p>
  <button type="button" class="btn btn-sm btn-ghost" data-sw-part="dismiss-forever">Don't show again</button>
</div>`,
    noJs: 'No banner at all — and with no JS there is nothing to dismiss.',
    notes:
      'Place each banner ONCE — either site-wide in a chrome slot (e.g. the website `bottom` slot) or in a single page body for a page-specific banner. Use a UNIQUE data-sw-banner-id per banner (omitting it falls back to "default" — two banners then share one dismissal). For a cookie/consent banner, enable the Consent Manager (website.consent) — it auto-injects, no component needed. Accessibility: author role="status" (polite) or role="alert" (assertive) on the root so screen readers announce it on reveal; data-position="center" is a non-modal centered card (it does NOT block the page, so no focus trap). Entrance: a fade+rise by default, or add a data-sw-animation effect for fade-up/zoom/flip/etc. — both reverse on dismiss. For a rich background, wrap an absolute media layer + an overlay scrim inside it (or nest a data-sw-component="shader-bg"), give the root overflow-hidden, and set a light text colour. Recipes to copy: banner-bar, banner-card, banner-modal.',
  },
  {
    type: 'Form',
    marker: 'form',
    summary: 'The platform form runtime: JSON submit to the injected endpoint, honeypot + time-trap, optional hCaptcha, inline success/error or redirect.',
    authoring: 'embed',
    parts: [
      { part: 'fields', element: 'div', required: true, description: 'Generated: the labelled inputs from the stored form definition.' },
      { part: 'hp', element: 'div', required: true, description: 'Generated: the off-screen honeypot field.' },
      { part: 'submit', element: 'button', required: true, description: 'Generated: the submit button (label from the definition).' },
      { part: 'success', element: 'p', required: true, description: 'Generated: the success message (hidden until submit succeeds).' },
      { part: 'error', element: 'p', required: true, description: 'Generated: the error message (hidden until submit fails).' },
    ],
    attributes: [
      { name: 'data-sw-form', on: 'form', description: 'The stored form id to embed. Locale pages auto-resolve "<id>-<locale>" when it exists.' },
    ],
    skeleton: `{{sw-form "contact"}}`,
    noJs: 'The form has no action attribute, so it cannot submit without JS — by design (submission is JSON + anti-spam).',
    notes:
      'NEVER hand-wire endpoints or author data-sw-component="form" yourself. First create the form definition (put_content kind "form": fields, submission mode, messages), then embed it by reference: {{sw-form "<id>" class="…"}} renders the complete markup, or write your own <form data-sw-form="<id>">…custom field markup…</form> and the platform injects the endpoint, honeypot, and captcha at render. DaisyUI only styles inputs; it has no form runtime.',
  },
  {
    type: 'DateTimePicker',
    marker: 'datetimepicker',
    summary:
      'A Vanilla Calendar Pro-powered date / date-range / datetime / time picker: a CI-themed popup calendar with a slider time picker, keyboard support, and per-locale day/month names. data-mode="range" shows a DUAL-PANEL two-month view. The marker goes on a text <input> (popup) or a block element (inline calendar); data-mode chooses the variant and data-* attributes give full control.',
    authoring: 'markup',
    parts: [
      {
        part: '(the marked element — no data-sw-part)',
        element: 'input',
        required: true,
        description:
          'This component has NO data-sw-part children. Put data-sw-component="datetimepicker" on a single text <input> (give it a name + id and a <label> for forms) — see the skeleton — and the runtime upgrades it into a POPUP picker, writing the chosen value back into the input. Put the marker on a block element instead (e.g. a <div>) to render an always-open INLINE calendar in the page flow. Everything else is configured through the data-* attributes below.',
      },
    ],
    attributes: [
      {
        name: 'data-mode',
        on: 'input',
        description:
          '"date" (default — a calendar), "range" (a start–end span in one field, shown as a DUAL-PANEL two-month view), "datetime" (calendar + time), or "time" (only the time picker). This is the one knob most pickers need.',
      },
      { name: 'data-months', on: 'input', description: 'How many months to show side by side (2–12). Defaults to 2 in range mode (the dual panel) and 1 otherwise; set it to widen any mode (e.g. data-months="3").' },
      { name: 'data-time-format', on: 'input', description: 'Time clock for datetime/time modes: "HH:mm" → 24-hour (default), or any am/pm format like "hh:mm aa" → 12-hour.' },
      { name: 'data-min', on: 'input', description: 'Earliest selectable date (e.g. "2026-01-01"). Days before it are disabled.' },
      { name: 'data-max', on: 'input', description: 'Latest selectable date (e.g. "2026-12-31"). Days after it are disabled.' },
      { name: 'data-locale', on: 'input', description: 'Force the picker language: "en", "de", or "es" (month/weekday names via the Intl API). Omit it and the picker follows the page\'s <html lang>, so localized pages localize automatically, flooring to English.' },
      { name: 'data-first-day', on: 'input', description: 'First weekday column: 0 = Sunday, 1 = Monday … 6 = Saturday. Defaults to the locale convention.' },
      { name: 'data-multiple', on: 'input', description: '"true" lets the user pick any number of separate (non-contiguous) dates. Mutually exclusive with data-mode="range".' },
      { name: 'data-time-step', on: 'input', description: 'Minutes increment for the time slider (e.g. "5", "15", "30") in datetime/time modes.' },
      { name: 'data-position', on: 'input', description: 'Where the popup opens relative to the input: "bottom left" (default-ish), "bottom right", "top center", "auto", etc. (vertical = top|bottom, horizontal = left|center|right).' },
    ],
    skeleton: `<label class="block">
  <span class="mb-1 block text-sm font-medium">Pick a date</span>
  <input type="text" name="appointment" data-sw-component="datetimepicker" placeholder="Select…" class="w-full" />
</label>`,
    noJs: 'The element stays a plain text <input> — the visitor can still type a value and it still submits inside a form; only the calendar popup is unavailable.',
    notes:
      'THE 90% CASE IS ONE LINE: `<input data-sw-component="datetimepicker">` is a date picker. Add `data-mode="range"` for a start–end span (rendered as TWO MONTHS side by side so a range across months is easy), `data-mode="datetime"` for date + time, or `data-mode="time"` for just the clock — that single attribute covers almost every need. FULL CONTROL for the rest comes from the data-* attributes: data-months (widen the panel), data-min / data-max (bounds), data-first-day, data-multiple, data-time-step, data-time-format (12h vs 24h), data-position, data-locale. The picker is brand-themed automatically — the selected day(s), the range band, the today ring, the month/year selection and the time slider all use the site CI primary, with the body font and card radius; transitions are dropped under prefers-reduced-motion. LOCALE: it follows the page <html lang> (en/de/es) for day/month names with no extra work — override with data-locale. INLINE: put the marker on a block element (e.g. <div data-sw-component="datetimepicker" data-mode="range">) to render an always-open calendar in the page flow instead of a popup. FORMS: give the <input> a name; the runtime writes the selection back as a locale-formatted string (range = "start – end") which submits like any field. Put the marker on a TEXT input (not type="date"/"time", which would also trigger the browser\'s own native picker). The input box itself is styled by the PLATFORM automatically (theme-aware surface/text/border + a brand-coloured focus ring, light or dark) — a bare <input> looks finished; add utilities or DaisyUI .input only to restyle it.',
    examples: [
      {
        label: 'Dual-panel date range with bounds',
        code: '<input type="text" name="stay" data-sw-component="datetimepicker"\n  data-mode="range" data-min="2026-06-01" data-max="2026-12-31"\n  class="w-full" placeholder="Check-in – Check-out" />',
        note: 'range mode shows two months side by side; one field captures the whole span. Bounds disable out-of-window days. Locale follows <html lang> (override with data-locale).',
      },
      {
        label: 'Date + time, 15-minute steps',
        code: '<input type="text" name="appointment" data-sw-component="datetimepicker"\n  data-mode="datetime" data-time-step="15" data-time-format="HH:mm"\n  class="w-full" />',
        note: 'datetime mode adds the slider time picker under the calendar; data-time-format="HH:mm" is a 24-hour clock.',
      },
      {
        label: 'Inline always-open calendar (block marker)',
        code: '<div data-sw-component="datetimepicker" data-mode="range" data-months="2"></div>',
        note: 'A block element (not an <input>) renders the calendar in the page flow — here an inline dual-panel range, e.g. for a booking widget.',
      },
    ],
  },
  {
    type: 'ShaderBg',
    marker: 'shader-bg',
    summary:
      'A first-party WebGL animated background, themed by the project CI colors. Put it on any section/hero/full-page wrapper; the runtime renders the chosen preset on a canvas BEHIND the content. 30 presets, optional pointer interactivity, a global angle, and speed/intensity knobs. CSP-clean, reduced-motion aware, pauses when offscreen.',
    authoring: 'markup',
    parts: [
      {
        part: 'overlay',
        element: 'div',
        required: false,
        description:
          'OPTIONAL legibility scrim between the animated background and your content (improves text contrast). Tint it with utilities, e.g. class="bg-black/30" or class="bg-gradient-to-t from-black/50". It sits above the canvas, below your content; the runtime injects the canvas itself — never author a canvas.',
      },
    ],
    attributes: [
      {
        name: 'data-preset',
        on: 'root',
        description:
          'Which background to render (default "mesh-gradient"). One of: mesh-gradient, silk-flow, plasma, halftone-pulse, caustics, marble-ink, sun-rays, lava-lamp, corner-mesh, flow-field, interference, ribbons, brushed-streaks, voronoi-cells, pointer-ripples, liquid-metal, rising-smoke, edge-glow, waterfall, heat-haze, bokeh-drift, contours, starfield, sine-strands, vortex-swirl, ink-bloom, mist-layers, drifting-blobs, glow-orbits, gradient-flow.',
      },
      { name: 'data-speed', on: 'root', description: 'Animation speed multiplier 0–4 (default 1). "0" renders a single static frame.' },
      { name: 'data-intensity', on: 'root', description: 'Saturation/brightness 0–1 (default 0.5). Lower = more muted/subtle behind text.' },
      { name: 'data-angle', on: 'root', description: 'Rotates the whole field, in degrees -360–360 (default 0). Reorients directional presets (gradients, sweeps, rays).' },
      {
        name: 'data-interactive',
        on: 'root',
        description: '"true" lets the pointer morph the effect while hovering the section (default off). Ignored under prefers-reduced-motion.',
      },
      {
        name: 'data-colors',
        on: 'root',
        description:
          'Override the 3 palette slots, comma-separated. Use CI token names ("accent,primary,base-content") or literal CSS colors ("#fff,rgb(0,0,0),steelblue"). Defaults to primary,secondary,neutral, and follows light/dark themes automatically.',
      },
    ],
    skeleton: `<section class="relative grid min-h-[60vh] place-items-center" data-sw-component="shader-bg" data-preset="mesh-gradient">
  <div class="sw-container text-center text-white">
    <h1 class="text-4xl font-bold">Your headline</h1>
    <p class="mt-3 opacity-90">A short supporting line over the animated background.</p>
  </div>
</section>`,
    noJs:
      'Until enhanced (and with JavaScript off or WebGL unavailable) the host shows a static CSS gradient built from the same CI color tokens — never a blank box. Content stays fully readable; nothing is hidden behind a stuck overlay.',
    notes:
      'Place this on a wrapper that already sizes itself (give the section a min-height or padding) — the canvas fills the host and your content renders above it (no z-index work needed; the host becomes an isolated stacking context). For legible text add a data-sw-part="overlay" scrim and/or lower data-intensity. Performance: one WebGL context per instance; the animation pauses when the element scrolls offscreen or the tab is hidden, and prefers-reduced-motion renders a single static frame — keep to a few instances per page. Colors are read live from the --sw-color-* tokens, so the background re-themes itself on a light/dark theme switch. Subtle presets (mesh-gradient, gradient-flow, mist-layers, edge-glow) read best behind content; bolder ones (plasma, caustics, voronoi-cells) suit decorative bands. This is NOT a DaisyUI/utility gradient — use a plain bg-* gradient for a flat background; use this for motion.',
    examples: [
      {
        label: 'Full-bleed hero with a darkening scrim',
        code: '<section class="relative grid min-h-screen place-items-center" data-sw-component="shader-bg" data-preset="silk-flow" data-intensity="0.4" data-interactive="true">\n  <div data-sw-part="overlay" class="bg-gradient-to-t from-black/60 to-black/10"></div>\n  <div class="sw-container text-center text-white">\n    <h1 class="text-5xl font-bold">Build something striking</h1>\n  </div>\n</section>',
        note: 'data-interactive lets the cursor morph the flow; the gradient scrim keeps the headline legible.',
      },
      {
        label: 'Static, angled accent band',
        code: '<section class="relative py-24" data-sw-component="shader-bg" data-preset="gradient-flow" data-speed="0" data-angle="135" data-colors="accent,primary,base-100">\n  <div class="sw-container">…</div>\n</section>',
        note: 'data-speed="0" renders one still frame (no animation); data-colors remaps the palette to the accent/primary/background tokens.',
      },
    ],
  },
];
