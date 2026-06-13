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
          'Previous button (hidden until enhanced; give it an aria-label and a Lucide glyph, e.g. {{sw-icon "chevron-left" "size-6"}}). Defaults to a mid-left overlay; reposition freely with utility classes.',
      },
      {
        part: 'next',
        element: 'button',
        required: false,
        description: 'Next button (same rules as prev; {{sw-icon "chevron-right" "size-6"}}). Defaults to a mid-right overlay.',
      },
      {
        part: 'dots',
        element: 'div',
        required: false,
        description:
          'Empty mount; the runtime generates one indicator per snap point (aria-current marks the active one). Defaults to a bottom-center overlay; reposition freely with utility classes.',
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
      { name: 'data-align', on: 'root', description: 'Snap alignment: "start" (default), "center" (recommended with peek), or "end".' },
      { name: 'data-item-align', on: 'root', description: 'HORIZONTAL distribution when the slides do NOT fill the row (fewer slides than --sw-items, or a partial last page): "start" (default), "center", or "end". justify-content under the hood; distinct from data-align (which sets the snap position). Only visible with multiple items and an underfull track.' },
      { name: 'data-kenburns', on: 'root', description: 'Present = "standard hero" motion: the active slide\'s `.sw-kenburns` background layer slowly pans/zooms (alternating direction per slide) and its `.sw-caption` rises in. Keyframes ship with the component (no per-site CSS). Pair with full-height slides each containing a `<div class="sw-kenburns" data-sw-bg="key">` background + a `<div class="sw-caption">` overlay. The `hero-slider` global snippet ({{> hero-slider}}) is the ready-made version.' },
      { name: 'data-click-next', on: 'root', description: '"true" makes every slide click-to-advance with ripple feedback (the navigation-less pattern — arrows/dots optional). Clicks on links/buttons/inputs inside a slide keep their own meaning; a drag never counts as a click; the root becomes keyboard-focusable so arrow keys still work.' },
    ],
    skeleton: `<div class="relative" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="true" data-interval="6000">
  <div data-sw-part="track">
    <figure data-sw-part="slide">Slide one content</figure>
    <figure data-sw-part="slide">Slide two content</figure>
  </div>
  <button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "chevron-left" "size-6"}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "chevron-right" "size-6"}}</button>
  <div data-sw-part="dots" aria-hidden="true"></div>
</div>`,
    noJs: 'The track is a CSS scroll-snap row — fully swipeable/scrollable; arrows and dots stay hidden so no inert controls show.',
    notes:
      'Slides-per-view is the --sw-items CSS variable on the root (Tailwind arbitrary properties): class="[--sw-items:1.15]" shows a peek of the next slide, class="[--sw-items:1] md:[--sw-items:3]" is a responsive 3-up — both REQUIRE data-effect="slide" (fade stacks full-width slides). Give slides internal padding (e.g. px-2) for gaps. For a FIXED-HEIGHT slider (hero), set the height ONCE on the ROOT (e.g. class="h-[60vh]") plus overflow-hidden to clip cleanly — the slides fill it automatically (no per-slide height); omit a root height for content/auto-height sliders. To drop a control, omit its part. Arrows and dots get a Material-style press ripple automatically (unbounded — it travels past the control; under data-click-next the WRAPPER ripples on slide presses; suppressed under prefers-reduced-motion; tap-highlight is transparent throughout). The runtime also adds role="region" + aria-roledescription="carousel" and a hidden live region announcing the active slide (silent while auto-rotating) — keep an aria-label on the root. The runtime stamps `data-active` on the slide(s) in the selected snap — a pure CSS styling hook: the attribute flip restarts matching keyframes, so per-activation effects (caption entrance, Ken Burns zoom on a background div) are authored as `[data-sw-part="slide"][data-active] .caption { animation: ... }`. Animate transform/inner elements only — the fade effect owns slide opacity. Hero sliders: slides can be plain divs with data-sw-bg backgrounds (no <img>), fixed height, and fully restyled full-height gradient arrows (the arrow defaults are zero-specificity). DaisyUI\'s `carousel`/`carousel-item` classes are a plain scroll-snap STRIP (no arrows, dots, autoplay, or looping — its documented "buttons" are #anchor hacks). Use the DaisyUI classes as a layout primitive for a swipeable card row; use THIS component for any real slideshow.',
  },
  {
    type: 'Tabs',
    marker: 'tabs',
    summary: 'Content panels behind an accessible APG tablist (roving tabindex, arrow keys); the runtime builds the tab buttons from each panel title.',
    authoring: 'markup',
    parts: [
      { part: 'tablist', element: 'div', required: true, description: 'Empty mount with role="tablist"; the runtime generates one tab button per panel.' },
      { part: 'panel', element: 'div', required: true, description: 'One content panel (role="tabpanel"); any markup inside.' },
    ],
    attributes: [{ name: 'data-sw-title', on: 'panel', description: 'The tab button label for this panel (interpolation allowed, e.g. a page.data key for i18n).' }],
    skeleton: `<div data-sw-component="tabs" data-sw-block="Tabs">
  <div data-sw-part="tablist" role="tablist"></div>
  <div data-sw-part="panel" role="tabpanel" data-sw-title="First tab">First panel content</div>
  <div data-sw-part="panel" role="tabpanel" data-sw-title="Second tab">Second panel content</div>
</div>`,
    noJs: 'The tablist stays hidden and ALL panels render stacked — every panel remains readable.',
    notes:
      "Use this whenever tabs switch CONTENT. DaisyUI's `tabs`/`tab` classes are for tab-STYLED navigation links (a row of links that navigate); do not build DaisyUI radio-input content tabs — they lack tablist semantics and their adjacency-dependent markup is brittle.",
  },
  {
    type: 'Lightbox',
    marker: 'lightbox',
    summary:
      'A GLightbox-powered gallery: thumbnails open a full-screen viewer with animated slide changes, swipe, pinch-zoom, keyboard navigation, and captions. Each component root is its own gallery.',
    authoring: 'markup',
    parts: [
      { part: 'grid', element: 'div', required: true, description: 'The thumbnail grid (override columns with !grid-cols-* utilities).' },
      { part: 'item', element: 'a', required: true, description: 'One thumbnail: an anchor whose href is the FULL-SIZE image URL, containing the <img> thumbnail.' },
    ],
    attributes: [
      { name: 'data-caption', on: 'item', description: 'Caption text shown under the image in the viewer.' },
      { name: 'data-effect', on: 'root', description: 'Open/close animation: "zoom" (default), "fade", or "none".' },
      { name: 'data-slide-effect', on: 'root', description: 'Between-picture animation: "slide" (default), "fade", "zoom", or "none".' },
      { name: 'data-loop', on: 'root', description: '"true" to wrap from the last image to the first while navigating.' },
    ],
    skeleton: `<div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="Gallery">
  <div data-sw-part="grid" class="gap-3 !grid-cols-2 md:!grid-cols-4">
    {{#sw-folder "gallery" kind="image"}}
    <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="overflow-hidden rounded-2xl">
      <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" />
    </a>
    {{/sw-folder}}
  </div>
</div>`,
    noJs: 'Each thumbnail is a plain link to the full image — clicking simply opens it.',
    notes:
      'The viewer DOM is built entirely by the runtime — author ONLY the grid of anchor items (no overlay element). Multiple lightboxes on one page are independent galleries. DaisyUI has no gallery/lightbox equivalent. Pairs naturally with a {{#sw-folder}} loop (media-library folder) or a dataset loop.',
  },
  {
    type: 'Modal',
    marker: 'modal',
    summary: 'A trigger button that opens a native <dialog> — focus trap, Escape, ::backdrop, and background inerting come from the browser.',
    authoring: 'markup',
    parts: [
      { part: 'open', element: 'button', required: true, description: 'The trigger; the runtime wires it to dialog.showModal().' },
      { part: 'dialog', element: 'dialog', required: true, description: 'The native dialog element holding the modal content.' },
      { part: 'close', element: 'button', required: false, description: 'Close button inside the dialog (backdrop click and Escape also close).' },
    ],
    attributes: [],
    skeleton: `<div data-sw-component="modal" data-sw-block="Modal">
  <button type="button" data-sw-part="open" class="btn btn-outline">What happens next?</button>
  <dialog data-sw-part="dialog" class="max-w-md rounded-3xl">
    <button type="button" data-sw-part="close" aria-label="Close">×</button>
    <h2 class="text-xl font-bold">Dialog title</h2>
    <p class="mt-3 text-sm">Dialog body content.</p>
  </dialog>
</div>`,
    noJs: 'The trigger does nothing — the page remains fully usable; never put essential content only inside a modal.',
    notes:
      "This is the ONLY modal that works on this platform: DaisyUI's <dialog> method requires an inline onclick (rejected by the template validator) and its hidden-checkbox method has no focus trap or Escape handling. Style the dialog content with normal Tailwind/DaisyUI classes.",
  },
  {
    type: 'CookieConsent',
    marker: 'cookie-consent',
    summary: 'A consent banner stored in localStorage — server HTML ships it hidden; the runtime reveals it only when consent is not yet stored.',
    authoring: 'markup',
    parts: [{ part: 'accept', element: 'button', required: true, description: 'The accept button; stores consent and hides the banner.' }],
    attributes: [{ name: 'hidden', on: 'root', description: 'REQUIRED in the authored markup — without JS (or after consent) the banner never shows.' }],
    skeleton: `<div data-sw-component="cookie-consent" data-sw-block="CookieConsent" hidden>
  <p>We use a few essential cookies. <a class="link" href="/privacy">Learn more</a></p>
  <button type="button" data-sw-part="accept">OK, got it</button>
</div>`,
    noJs: 'No banner at all — and with no JS there is nothing to consent to.',
    notes: 'Place it ONCE, site-wide, in the website `bottom` slot (not on individual pages). DaisyUI has no equivalent.',
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
];
