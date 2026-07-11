// Platform-authored behavior + styling for INTERACTIVE component blocks (Carousel,
// Lightbox, Modal, Tabs, Banner, Form).
//
// These are NOT tenant code — they are first-party, audited, static assets shipped
// only when the matching block is used (the same "only-used-ships" discipline as
// icons.ts / brand-icons.ts / the Tailwind sheet). The tenant supplies only DATA
// (slides, captions) through declarative markup; never JavaScript. This keeps the
// "no per-tenant code execution" invariant intact: the JS below is bundled to a
// `components.js` served from the site's own origin (CSP `default-src 'self'`),
// and runs on the published/exported site. Components degrade to usable semantic
// HTML without JS (a carousel stays a swipeable scroll-snap row; a lightbox item
// stays a working link to the full image).
//
// Carousel, Lightbox and DateTimePicker are powered by VENDORED MIT libraries (Embla
// Carousel / SmartPhoto / Vanilla Calendar Pro) bundled together with their first-party wiring
// by scripts/gen-vendor.mjs into the checked-in src/vendor/*-runtime.ts modules (CI guards
// drift via gen:vendor:check). The libraries stay an implementation detail: agents author
// only the declarative data-sw-component / data-sw-part / data-* contract documented in
// COMPONENT_CATALOG — never library API calls.
import { CAROUSEL_RUNTIME_JS } from './vendor/carousel-runtime.js';
// ACTIVE lightbox = SmartPhoto (bottom thumbnail strip, enlarge-from-thumbnail open, header
// counter + caption). The GLightbox runtime (./vendor/lightbox-runtime.js — LIGHTBOX_RUNTIME_JS /
// LIGHTBOX_VENDOR_CSS) is RETAINED as a revertible fallback: still generated + drift-checked by
// gen-vendor, just not imported here. To revert, swap this import and the LIGHTBOX_CSS / LIGHTBOX_JS
// definitions below back to the GLightbox names.
import {
  LIGHTBOX_SMARTPHOTO_RUNTIME_JS,
  LIGHTBOX_SMARTPHOTO_VENDOR_CSS,
} from './vendor/lightbox-smartphoto-runtime.js';
// DateTimePicker = Vanilla Calendar Pro (vendored MIT), bundled with its first-party wiring + the
// vendor's COLOURLESS layout.css (we theme it ourselves below against its data-vc-* hooks). See
// vendor-src/datetimepicker.entry.js for the readable runtime source.
import { DATETIMEPICKER_RUNTIME_JS, DATETIMEPICKER_VENDOR_CSS } from './vendor/datetimepicker-runtime.js';
// ShaderBg = first-party WebGL animated background (no vendored library). Its CSS/JS are authored in
// shader-bg.ts and the GLSL presets are single-sourced in shader-bg-presets.ts.
import { SHADER_BG_CSS, SHADER_BG_JS } from './shader-bg.js';
import { BANNER_CSS, BANNER_JS } from './banner.js';

/** A component's static styling + behavior (either may be empty). */
export interface ComponentAsset {
  css: string;
  js: string;
}

// --- Carousel -------------------------------------------------------------
// Embla-powered slider. PE-first: the authored track is a CSS scroll-snap row
// (swipeable with no JS); the runtime moves the slides into a generated
// [data-sw-part="container"] and flips the track into Embla's clipping viewport
// via data-sw-enhanced. `--sw-items` is the slides-per-view knob (set it with
// Tailwind arbitrary properties, e.g. class="[--sw-items:1.15] md:[--sw-items:3]";
// fractional values = peek mode) — it drives BOTH the no-JS row and the engine.
// Arrow/dot POSITIONING defaults live in zero-specificity :where() rules so any
// authored utility class repositions them; their visibility gates stay strong so
// inert controls never show before enhancement.
const CAROUSEL_CSS = [
  '[data-sw-block="Carousel"]{position:relative}',
  // `scrollbar-width:none` hides it in Firefox (the base layer otherwise gives every
  // element `scrollbar-width:thin`); the ::-webkit rule hides it in Chrome/Safari.
  '[data-sw-block="Carousel"] [data-sw-part="track"]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
  '[data-sw-block="Carousel"] [data-sw-part="track"]::-webkit-scrollbar{display:none}',
  '[data-sw-block="Carousel"] [data-sw-part="container"]{display:flex;width:100%}',
  // height:100% on the track + container lets a height set ONCE on the carousel ROOT cascade
  // to the slides, which then fill it via the default align-items:stretch — so a fixed-height
  // slider (hero) needs no per-slide height. No-op when the root has no explicit height
  // (resolves to auto), so card/ticker sliders are unchanged. EXCLUDES data-autoheight, which
  // OWNS its height (the plugin sets it per active slide) — a resolved 100% there would give
  // its height transition a value to animate FROM, flashing the tallest slide on init.
  '[data-sw-block="Carousel"]:not([data-autoheight="true"]) [data-sw-part="track"],[data-sw-block="Carousel"]:not([data-autoheight="true"]) [data-sw-part="container"]{height:100%}',
  // margin:0 — the rendered-site baseline is modern-normalize (NOT preflight), so UA defaults
  // like figure/blockquote `margin: 1em 40px` survive into slides and break Embla: snaps land
  // 40px apart per slide, fade repositioning drifts, and AutoHeight sizes the container to the
  // border box so overflow:hidden clips the bottom margin. Slides are layout cells; author
  // spacing as padding INSIDE the slide (Embla's documented gap pattern).
  '[data-sw-block="Carousel"] [data-sw-part="slide"]{flex:0 0 calc(100%/var(--sw-items,1));scroll-snap-align:start;min-width:0;margin:0}',
  '[data-sw-block="Carousel"] [data-sw-part="slide"] img{display:block;width:100%;height:auto}',
  // data-item-align: HORIZONTAL distribution when the slides DON'T fill the row (fewer than
  // --sw-items) — start (default), center, or end. justify-content on the NO-JS scroll-snap TRACK
  // only (gated to the un-enhanced state). The enhanced (Embla) container is handled by the runtime,
  // which applies justify-content ONLY when the content FITS — because justify-content:center on an
  // OVERFLOWING flex container centers the overflow and shoves the first slide off-screen left,
  // fighting Embla's transform. When the track scrolls, Embla's `align` (also driven by
  // data-item-align) does the centering instead.
  '[data-sw-block="Carousel"]:not([data-sw-enhanced="true"])[data-item-align="center"] [data-sw-part="track"]{justify-content:center}',
  '[data-sw-block="Carousel"]:not([data-sw-enhanced="true"])[data-item-align="end"] [data-sw-part="track"]{justify-content:flex-end}',
  // Enhanced: the track stops being the scroller (Embla translates the container inside it).
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="track"]{display:block;overflow:hidden;scroll-snap-type:none}',
  // AutoHeight (data-autoheight="true"): the engine sets the container height to the
  // in-view slide; top-align the slides (plugin requirement) and animate the change.
  // NOT gated on data-sw-enhanced: the plugin caches slide heights when Embla inits,
  // BEFORE the runtime marks the root enhanced — a late gate would measure every slide
  // stretched to the tallest. The container only exists once the runtime creates it.
  '[data-sw-block="Carousel"][data-autoheight="true"] [data-sw-part="container"]{align-items:flex-start;transition:height .25s ease}',
  // Press-ripple anchoring ("waves"): the runtime adds .sw-waves to arrows/dots (and to the
  // ROOT in click-to-slide mode). Deliberately overflow:VISIBLE on controls — the unbounded
  // Material ripple travels past small buttons/dots. MUST come BEFORE the default control
  // placement below — all these rules are zero-specificity :where(), so source order decides,
  // and the arrows' default position:absolute has to win over this relative fallback.
  ':where([data-sw-block="Carousel"] .sw-waves){position:relative;overflow:visible}',
  // No mobile tap flash anywhere in the component — the ripple IS the press feedback.
  ':where([data-sw-block="Carousel"],[data-sw-block="Carousel"] *){-webkit-tap-highlight-color:transparent}',
  // Click-to-slide roots host the wrapper-level ripple — clip it at the slider bounds.
  ':where([data-sw-block="Carousel"][data-click-next="true"].sw-waves){overflow:hidden}',
  // Controls stay hidden until the runtime enhances — the no-JS fallback never shows
  // inert UI. (These gates are deliberately strong; to drop a control, omit its part.)
  '[data-sw-block="Carousel"] [data-sw-part="prev"],[data-sw-block="Carousel"] [data-sw-part="next"],[data-sw-block="Carousel"] [data-sw-part="dots"]{display:none}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="prev"],[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="next"]{display:flex;align-items:center;justify-content:center}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="dots"]{display:flex}',
  // DEFAULT placement (zero specificity — any authored utility class wins): arrows
  // overlaid mid-left/right, dots overlaid centered at the bottom of the slides.
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="prev"],[data-sw-part="next"]){position:absolute;top:50%;transform:translateY(-50%);width:2.75rem;height:2.75rem;border:0;border-radius:9999px;background:rgb(0 0 0/.45);color:#fff;cursor:pointer;z-index:1}',
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="prev"]){left:.75rem}',
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="next"]){right:.75rem}',
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="dots"]){position:absolute;bottom:.75rem;left:50%;transform:translateX(-50%);gap:.4rem;z-index:1}',
  '[data-sw-block="Carousel"] [data-sw-part="prev"][disabled],[data-sw-block="Carousel"] [data-sw-part="next"][disabled]{opacity:.35;cursor:default}',
  '[data-sw-block="Carousel"] [data-sw-part="prev"] svg,[data-sw-block="Carousel"] [data-sw-part="next"] svg{margin:auto}',
  // Dots are runtime-generated buttons holding the Lucide `circle` glyph; the active
  // one fills via aria-current.
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button{display:block;width:.7rem;height:.7rem;padding:0;border:0;background:none;color:#fff;opacity:.65;cursor:pointer}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button svg{display:block;width:100%;height:100%}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button[aria-current="true"]{opacity:1}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button[aria-current="true"] svg circle{fill:currentColor}',
  '[data-sw-block="Carousel"] .sw-ripple{position:absolute;border-radius:9999px;pointer-events:none;background:rgb(0 0 0/.35);transform:scale(0);animation:sw-ripple .65s ease-out forwards}',
  // The runtime's live region announcing the active slide — visually hidden, AT-readable.
  '[data-sw-block="Carousel"] .sw-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
  '@keyframes sw-ripple{to{transform:scale(1);opacity:0}}',
  // Click-to-slide (data-click-next="true"): the whole slide is the affordance.
  '[data-sw-block="Carousel"][data-click-next="true"][data-sw-enhanced="true"] [data-sw-part="slide"]{cursor:pointer}',
  // ── Hero motion (data-kenburns on the root) ──────────────────────────────────────────────
  // Turns the slideshow into the "standard hero": the active slide's `.sw-kenburns` background
  // layer drifts (alternating direction by slide parity so consecutive slides pan opposite
  // ways), and its `.sw-caption` rises in. Keyed off data-active (JS-set), so without JS the
  // first slide is simply shown static. Keyframes ship with the component (tiny) but are inert
  // unless data-kenburns is authored — the whole point is to retire the per-site @keyframes the
  // hero used to need in criticalCss. The hero-slider Widget uses exactly these hooks.
  '@keyframes sw-kb-a{0%{transform:scale3d(1.18,1.18,1) translate3d(-2.2%,1.6%,0)}100%{transform:scale3d(1,1,1) translate3d(0,0,0)}}',
  '@keyframes sw-kb-b{0%{transform:scale3d(1.18,1.18,1) translate3d(2.2%,-1.6%,0)}100%{transform:scale3d(1,1,1) translate3d(0,0,0)}}',
  '@keyframes sw-cap-in{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}',
  // The bg layer fills its slide and is the Ken Burns target; the slide clips it AND is the
  // positioning context for the absolute .sw-kenburns/.sw-caption (so authors needn't add
  // `relative` themselves — without it inset:0 would resolve to the carousel root and stack).
  // .sw-kenburns is either a bg <div> (data-sw-bg) or an <img> (the Widget's data-backed slides):
  // width/height + object-fit make the <img> behave like background-size:cover, and the transform
  // animation below applies to both. The two cover declarations are each inert on the other element.
  // POSITIONING + caption rise-in key off the PRESENCE of data-kenburns (the hero layout), so they
  // apply whether the drift is on or off. The image DRIFT (sw-kb-a/b) additionally excludes the
  // explicit off value: `[data-kenburns]:not([data-kenburns="off"])` matches bare `data-kenburns`
  // (back-compat for hand-authored heroes) AND `data-kenburns="on"`, but NOT `data-kenburns="off"`
  // (the Widget's Ken-Burns toggle) — so a static hero still gets the cover layout + caption motion.
  '[data-sw-block="Carousel"][data-kenburns] [data-sw-part="slide"]{overflow:hidden;position:relative}',
  '[data-sw-block="Carousel"][data-kenburns] .sw-kenburns{position:absolute;inset:0;width:100%;height:100%;background-size:cover;background-position:center;object-fit:cover}',
  '@media (prefers-reduced-motion: no-preference){' +
    '[data-sw-block="Carousel"][data-kenburns]:not([data-kenburns="off"])[data-sw-enhanced="true"] [data-sw-part="slide"][data-active]:nth-child(odd) .sw-kenburns{animation:sw-kb-a 8s ease-out both}' +
    '[data-sw-block="Carousel"][data-kenburns]:not([data-kenburns="off"])[data-sw-enhanced="true"] [data-sw-part="slide"][data-active]:nth-child(even) .sw-kenburns{animation:sw-kb-b 8s ease-out both}' +
    '[data-sw-block="Carousel"][data-kenburns][data-sw-enhanced="true"] [data-sw-part="slide"][data-active] .sw-caption{animation:sw-cap-in .9s cubic-bezier(.22,1,.36,1) .4s both}' +
    '}',
  '@media (prefers-reduced-motion: reduce){[data-sw-block="Carousel"] [data-sw-part="track"]{scroll-behavior:auto}[data-sw-block="Carousel"] [data-sw-part="container"]{transition:none}}',
].join('');

// The Embla-powered runtime (vendored library + first-party wiring; see
// vendor-src/carousel.entry.js for the readable source). Wires arrows/dots/keyboard,
// fade or slide effects, autoplay/auto-scroll (paused on hover/focus, skipped under
// reduced motion), wheel gestures, and auto height — all from data-* attributes.
const CAROUSEL_JS = CAROUSEL_RUNTIME_JS;

// --- Lightbox ----------------------------------------------------------------
// SmartPhoto-powered gallery viewer. PE-first: each item is an anchor to the full
// image, so with no JS clicking simply opens the image. With JS each component root
// becomes its own gallery — SmartPhoto supplies the bottom thumbnail strip, a header
// counter + caption, swipe / pinch-zoom / keyboard nav, a per-image loader, and the
// enlarge-from-thumbnail open animation; the viewer DOM is built by the runtime, there
// is no authored overlay. The vendored SmartPhoto stylesheet ships only data: URI icons
// (CSP-safe); the trailing block is a branded reskin (after the vendor sheet so equal-
// specificity rules win): dim + blurred backdrop, bigger rounded/animated arrows + close,
// rounded thumbnails with a brand active-ring, and a brand-coloured loader.
const LIGHTBOX_CSS = [
  '[data-sw-block="Lightbox"]{display:block}',
  // Grid + thumbnail DEFAULTS are zero-specificity :where() so any authored layout wins WITHOUT
  // !important: the uniform default is a square cover grid, but `block columns-3` makes a masonry,
  // `aspect-[4/3]`/`h-auto`/`object-contain` change the crop, etc. (same pattern as the Carousel).
  ':where([data-sw-block="Lightbox"] [data-sw-part="grid"]){display:grid;grid-template-columns:repeat(auto-fill,minmax(8rem,1fr));gap:.5rem}',
  ':where([data-sw-block="Lightbox"] [data-sw-part="item"]){display:block}',
  ':where([data-sw-block="Lightbox"] [data-sw-part="item"] img){display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:1}',
  // "Click to enlarge" affordance for ANY lightbox image — keyed on data-sw-component so it covers
  // the one-line minimal forms (bare <img>/<div> with no data-sw-block/data-sw-part scaffolding) too.
  ':where([data-sw-component="lightbox"]) img{cursor:zoom-in}',
  LIGHTBOX_SMARTPHOTO_VENDOR_CSS,
  // Dim + blurred backdrop (vendor ships solid black). z-index lifts the fullscreen viewer above
  // site chrome — the vendor's z-index:100 sits UNDER the consent banner / dismissible banner and other
  // overlays; a fullscreen image modal must be top-most. font-family:inherit adopts the site's CI
  // body font instead of the vendor's hard-coded sans-serif.
  '.sw-lightbox{z-index:999999;background-color:rgb(0 0 0/.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-family:inherit}',
  // Soft rounding + shadow on the full image.
  '.sw-lightbox-img-wrap img.sw-lightbox-img{border-radius:.5rem;box-shadow:0 12px 40px rgb(0 0 0/.45)}',
  // Open animation = ONE clean enlarge-from-thumbnail zoom. The clone COVERS its box (a cropped
  // thumbnail enlarges without the image being squashed then snapping to aspect) and sits ABOVE the
  // slide list (z 101, vendor list is 101 and the clone is later in source) so the image isn't seen
  // twice during the grow; and we cancel the vendor's secondary "inner slides up 100px" entrance,
  // which moved the real image against the zoom (the content shift).
  '.sw-lightbox-img-clone{object-fit:cover;z-index:101}',
  '.sw-lightbox-inner{animation:none}',
  // Arrows: tall semi-transparent edge tabs (rounded inner corners, centered chevron) that DARKEN
  // and GROW WIDER on hover (dune7 behaviour). Shape/colour on the .arrow-* li; size + width-grow on
  // the inner a. margin-top centers the ~94px tab on the top:50% anchor.
  '.sw-lightbox-arrows li{width:auto;height:auto;margin-top:-47px}',
  '.sw-lightbox-arrow-left,.sw-lightbox-arrow-right{padding:5px 0;background-color:rgb(0 0 0/.5);transition:background-color .35s ease}',
  '.sw-lightbox-arrow-right{border-radius:10px 0 0 10px}',
  '.sw-lightbox-arrow-left{border-radius:0 10px 10px 0}',
  '.sw-lightbox-arrow-left:hover,.sw-lightbox-arrow-right:hover{background-color:rgb(0 0 0/.72)}',
  '.sw-lightbox-arrows a{width:3.5rem;height:5.25rem;background-size:34px;background-position:center;background-repeat:no-repeat;transition:width .35s ease}',
  '.sw-lightbox-arrow-left:hover a,.sw-lightbox-arrow-right:hover a{width:4.75rem}',
  // Bigger, rounded close button with a hover affordance.
  '.sw-lightbox-dismiss{width:2rem;height:2rem;top:12px;right:14px;background-size:55%;background-position:center;background-repeat:no-repeat;border-radius:9999px;transition:background-color .2s ease,transform .2s ease}',
  '.sw-lightbox-dismiss:hover{background-color:rgb(255 255 255/.18);transform:scale(1.08)}',
  // Header gradient for legibility over bright images.
  '.sw-lightbox-header{height:auto;min-height:50px;padding:14px 18px;background:linear-gradient(to bottom,rgb(0 0 0/.55),transparent)}',
  // Thumbnail strip: rounded tiles; the active thumb gets a brand ring.
  '.sw-lightbox-nav{padding:0}',
  '.sw-lightbox-nav li{width:50px;height:50px;border-radius:.5rem;margin:0 .18rem}',
  '.sw-lightbox-nav a{border-radius:.5rem;transition:opacity .2s ease,box-shadow .2s ease}',
  '.sw-lightbox-nav a:hover{opacity:.85}',
  '.sw-lightbox-nav a.current{opacity:1;box-shadow:0 0 0 2px var(--sw-color-primary,#0a7a5a)}',
  // Loader → brand colour (vendor hard-codes teal #17CDDD).
  '.sw-lightbox-loader{border-color:var(--sw-color-primary,#0a7a5a);border-right-color:transparent}',
  // Reduced motion: drop the overlay/clone transitions (the runtime also disables showAnimation).
  '@media (prefers-reduced-motion: reduce){.sw-lightbox,.sw-lightbox-img-clone,.sw-lightbox-list li{transition:none}}',
].join('');

// The SmartPhoto-powered runtime (vendored library + first-party wiring; see
// vendor-src/lightbox-smartphoto.entry.js for the readable source). Per-root galleries from
// the authored anchors (options via data-*), plus an a11y shim (focus restore on close) on top
// of SmartPhoto's own dialog role / keyboard / touch handling. NOTE: aria-modal is intentionally
// not stamped — SmartPhoto re-renders via morphdom, which strips non-template attributes.
const LIGHTBOX_JS = LIGHTBOX_SMARTPHOTO_RUNTIME_JS;

// --- Modal -------------------------------------------------------------------
// A trigger that opens a native <dialog> (which provides focus trap, Escape, ::backdrop, and
// background inerting for free). The dialog is VIEWPORT-CENTERED (CSS position:fixed) so opening it
// never scrolls the page, and the runtime LOCKS page scroll while it is open. A styled close button
// is injected automatically (overhanging the top-right corner) unless data-closebutton="false";
// authored [data-sw-part="close"] buttons + arbitrary content still work; data-backdrop-close="false"
// keeps it open on a backdrop click.
//
// TWO authoring forms (both detected by the same data-sw-component="modal" marker):
//   • LIGHTER (preferred): the marker + an id go on the <dialog>, and the trigger is ANY element that
//     references that id — `<a href="#my-modal">` or `[data-sw-modal="my-modal"]` — anywhere on the
//     page. No wrapper, no data-sw-part. Config attrs (data-closebutton/-backdrop-close/-close-label)
//     go on the <dialog>.
//   • LEGACY: a `data-sw-component="modal"` wrapper containing `[data-sw-part="open"]` + a
//     `[data-sw-part="dialog"]` <dialog>. Still fully supported.
// The dialog FADES + DROPS in from the top on open and FADES + RISES out to the top on close.
// @starting-style + transition-behavior:allow-discrete keep the native <dialog> animating across
// its display toggle (closed ↔ open); engines without that support just show/hide instantly. The
// base (closed) rule doubles as the exit target — opacity:0 + translateY(-24px) — and `[open]`
// is the resting state. Reduced-motion drops straight to a plain show/hide (mirrors the cart drawer).
// Styling keys on the `data-sw-component="modal"` marker (M) so BOTH authoring forms work without a
// parallel data-sw-block: the LIGHTER form puts the marker on the <dialog> itself
// (`<dialog id data-sw-component="modal">`), the LEGACY form puts it on a wrapper whose <dialog> is a
// descendant. `mdlg(suffix)` yields the dialog selector for both (self + descendant).
const M = '[data-sw-component="modal"]';
const mdlg = (suffix = ''): string => `${M} dialog${suffix},dialog${M}${suffix}`;
// The visible box lives in a [data-sw-part="panel"] the JS builds INSIDE the <dialog>; the <dialog>
// itself is only a transparent, full-viewport scroller (see below).
const MP = '[data-sw-part="panel"]';
// The panel is ALWAYS a direct child of the <dialog>. Scope panel appearance/animation rules with a
// `>` child combinator (for both authoring forms) so they never cascade onto a nested component's
// [data-sw-part="panel"] — e.g. a Tabs component's tab panels rendered INSIDE a modal.
const mdlgp = (dsuffix = ''): string => `${M} dialog${dsuffix}>${MP},dialog${M}${dsuffix}>${MP}`;
// The BODY is the visible card (all paint moved here); it's always a direct child of the panel. Scoping
// it as `panel>body` keeps the paint defaults off any nested component's [data-sw-part="body"].
const MB = '[data-sw-part="body"]';
const mbody = (dsuffix = ''): string => `${M} dialog${dsuffix}>${MP}>${MB},dialog${M}${dsuffix}>${MP}>${MB}`;
const MODAL_CSS = [
  // Legacy wrapper stays inline-flowing; the lighter form has no wrapper (the dialog IS the marker,
  // and a closed <dialog> is display:none until opened).
  `${M}:not(dialog){display:inline-block}`,
  // The <dialog> is the CONTAINER: a transparent, full-viewport SCROLLER. `overflow-y:auto` puts the
  // scrollbar at the SCREEN edge (no inner-body scrollbar). `padding` is the all-around SAFETY GUTTER
  // (it replaces the old max-height/max-width caps) so the panel never touches the top/sides — and the
  // overhanging close button, which sits INSIDE this padding, can never be clipped. A panel taller than
  // the viewport top-aligns (the panel's margin:auto in this flex container degrades to top-aligned —
  // no top clip) and scrolls, touching only the bottom. display:none base so a shut modal never lays
  // out; `[open]` → flex (the panel's margin:auto then centers it, or top-aligns a too-tall one). The
  // overlay/display allow-discrete transitions keep it mounted through the exit animation. NOTHING here
  // is author-overridable: the JS SPLITS the author's class off the <dialog> — WIDTH utilities size the
  // panel, everything else + the inline style PAINTS the body — so the one-line `<dialog id
  // data-sw-component="modal" class="…">` authoring is unchanged. box-sizing:border-box keeps the padding
  // inside the 100vw/100dvh.
  // scrollbar-gutter:stable both-edges reserves the scrollbar's space on BOTH sides even when no
  // scrollbar shows, so on native-gutter systems (Windows classic / some Linux) a tall modal's scrollbar
  // never overlaps the overhanging close button, and the centered panel stays symmetric. 100vh precedes
  // 100dvh as a fallback for engines without dvh (old Safari/Firefox).
  `${mdlg()}{position:fixed;inset:0;width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;margin:0;padding:2rem;box-sizing:border-box;border:0;background:transparent;box-shadow:none;display:none;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable both-edges;transition:overlay .22s allow-discrete,display .22s allow-discrete}`,
  `${mdlg('[open]')}{display:flex}`,
  // The PANEL is a NEUTRAL positioning wrapper — it paints NOTHING. Its only jobs: (1) hold the WIDTH so
  // the box has a stable, definite size (it's a child of the definite-width dialog flex container, so the
  // author's width utilities — `max-w-*`/`w-11/12`/`w-full` — resolve stably here, unlike on a shrink-wrap
  // parent), (2) be the position:relative anchor for the overhanging close, (3) center via margin:auto
  // (top-aligning a too-tall panel — no top clip). Defaults at ZERO specificity (:where) so the moved
  // author WIDTH utilities win; `width:100%` → full width on mobile, `max-width` caps desktop only.
  `:where(${mdlgp()}){position:relative;margin:auto;width:100%;max-width:32rem}`,
  // GUARANTEE (normal specificity): the panel is never its OWN scroll box and paints nothing, so the
  // overhanging close (its child) is never clipped and all scrolling stays on the container. outline:none
  // because the panel is only PROGRAMMATICALLY focused (tabindex=-1) to anchor the open-focus at the top —
  // it's a non-interactive container (never in the Tab order), so suppressing its ring is correct.
  `${mdlgp()}{overflow:visible;max-height:none;outline:none}`,
  // Panel enter/exit from the top; @starting-style + the container's allow-discrete let the exit animate.
  `${mdlgp()}{opacity:0;transform:translateY(-24px);transition:opacity .22s ease,transform .22s ease}`,
  `${mdlgp('[open]')}{opacity:1;transform:translateY(0)}`,
  `@starting-style{${mdlgp('[open]')}{opacity:0;transform:translateY(-24px)}}`,
  // Backdrop: dims + BLURS, both fading in and out. The scrim derives from the CONTENT colour so it
  // INVERTS with the palette — a dark dim on a light site, a LIGHTER scrim on a dark site (where a
  // near-black dim would be invisible). Fallback = the old slate dim for engines without color-mix.
  `${mdlg('::backdrop')}{background:rgba(15,23,42,.45);background:color-mix(in srgb,var(--sw-color-base-content,#0f172a) 45%,transparent);opacity:0;-webkit-backdrop-filter:blur(0);backdrop-filter:blur(0);transition:opacity .22s ease,-webkit-backdrop-filter .22s ease,backdrop-filter .22s ease,overlay .22s allow-discrete,display .22s allow-discrete}`,
  `${mdlg('[open]::backdrop')}{opacity:1;-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}`,
  `@starting-style{${mdlg('[open]::backdrop')}{opacity:0;-webkit-backdrop-filter:blur(0);backdrop-filter:blur(0)}}`,
  // The BODY is the VISIBLE CARD — all paint moved here from the panel. Defaults at ZERO specificity so
  // the author's non-width utilities (bg-*/text-*/p-*/rounded-*/shadow-*/overflow-*) win. `width:100%`
  // fills the panel so the close (on the panel) hugs the body's corner. CRUCIALLY, an author `overflow-
  // hidden` clips the card's content (e.g. a full-bleed image to the rounded corners) WITHOUT touching
  // the close, which lives on the neutral panel OUTSIDE this box. `p-0` → content touches the card edge;
  // `p-0 bg-transparent` → content floats directly on the backdrop.
  `:where(${mbody()}){width:100%;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#0f172a);border-radius:.75rem;padding:1.5rem;box-shadow:0 10px 40px rgba(0,0,0,.2);overflow:visible}`,
  // GUARANTEE (normal specificity — beats a moved author `max-h-*`): the body grows with content and is
  // never its OWN scroll box, so a clipped card never turns into an inner scrollbar (scrolling stays on
  // the container, at the screen edge). min-width:0 lets it shrink in the flex/grid context.
  `${mbody()}{min-width:0;max-height:none}`,
  // Auto-injected close button OVERHANGS the panel's top-right corner (needs the panel's overflow:visible);
  // it lands inside the container's padding, so it stays fully on-screen. Hover zooms + spins the icon 180°.
  `${M} [data-sw-part="autoclose"]{position:absolute;top:-1rem;right:-1.5rem;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:3.25rem;height:2.25rem;padding:0;border:0;border-radius:.5rem;background:var(--sw-color-primary,#4f46e5);color:var(--sw-color-primary-content,#fff);cursor:pointer;transition:transform .2s ease}`,
  `${M} [data-sw-part="autoclose"]>svg{width:1.75rem;height:1.75rem;display:block;transition:transform .2s ease}`,
  `${M} [data-sw-part="autoclose"]:hover{transform:scale(1.1)}`,
  `${M} [data-sw-part="autoclose"]:hover>svg{transform:rotate(180deg)}`,
  `@media (prefers-reduced-motion:reduce){${mdlg()},${mdlgp()},${mdlg('::backdrop')},${M} [data-sw-part="autoclose"],${M} [data-sw-part="autoclose"]>svg{transition:none}}`,
].join('');

const MODAL_JS = `(function(){
  var CLOSE_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  // Localized SYSTEM UI string from <html data-sw-i18n="{…}"> (CSP-safe attribute, set per page),
  // flooring to the English fallback. Parsed once.
  var SW_T;
  function swt(k,fb){ if(SW_T===undefined){ try{ SW_T=JSON.parse(document.documentElement.getAttribute('data-sw-i18n')||'{}'); }catch(e){ SW_T={}; } } var v=SW_T[k]; return typeof v==='string'&&v?v:fb; }
  // Page-scroll lock while ANY modal is open: hide the document overflow and pad the body by the
  // scrollbar width so removing it doesn't shift the layout. Ref-counted so nested/sequential
  // modals don't unlock early; the prior inline styles are restored on the last close.
  var docEl=document.documentElement,locks=0,prevOverflow='',prevPad='';
  function lock(){
    if(locks===0){
      var gap=window.innerWidth-docEl.clientWidth;
      prevOverflow=docEl.style.overflow;prevPad=document.body.style.paddingRight;
      docEl.style.overflow='hidden';
      if(gap>0)document.body.style.paddingRight=((parseFloat(getComputedStyle(document.body).paddingRight)||0)+gap)+'px';
    }
    locks++;
  }
  function unlock(){
    if(locks>0)locks--;
    if(locks===0){docEl.style.overflow=prevOverflow;document.body.style.paddingRight=prevPad;}
  }
  // DEFAULT single-modal: opening a modal dismisses any OTHER open SW modal first (so a modal opened from
  // inside a modal REPLACES it). data-allow-multiple="true" (on the marker — the <dialog> in the lighter
  // form, the wrapper in the legacy one) OPTS OUT BOTH WAYS: opening it never dismisses others, AND it is
  // never dismissed when another opens (stacking — the previous behavior). Foreign <dialog>s are untouched.
  function allowMulti(dlg){var m=dlg.closest('[data-sw-component="modal"]');return !!m&&m.getAttribute('data-allow-multiple')==='true';}
  function openOn(dialog){
    if(dialog.open)return;
    if(!allowMulti(dialog)){
      Array.prototype.forEach.call(document.querySelectorAll('dialog[open]'),function(other){
        if(other!==dialog&&other.closest('[data-sw-component="modal"]')&&!allowMulti(other))other.close();
      });
    }
    dialog.showModal();lock();
  }
  function wireTrigger(t,dialog){
    t.addEventListener('click',function(e){
      // <a href="#id"> would otherwise jump + change the URL; buttons need no preventDefault.
      if(t.tagName==='A')e.preventDefault();
      openOn(dialog);
    });
  }
  function enhance(root){
    if(root.getAttribute('data-sw-enhanced'))return;
    // LIGHTER form: the marker IS the <dialog>. LEGACY form: the marker is a wrapper holding the dialog.
    var isDialog=root.tagName==='DIALOG';
    var dialog=isDialog?root:root.querySelector('[data-sw-part="dialog"]');
    if(!dialog||typeof dialog.showModal!=='function')return;
    root.setAttribute('data-sw-enhanced','true');
    // Triggers: lighter form → any <a href="#id"> / [data-sw-modal="id"] anywhere referencing the
    // dialog's id; legacy form → the [data-sw-part="open"] inside the wrapper.
    if(isDialog){
      var id=root.id;
      if(id){
        // Escape the id for the attribute-value selector (author-controlled; an exotic id would
        // otherwise build a malformed selector). try/catch is a further backstop for old engines.
        var eid=(window.CSS&&CSS.escape)?CSS.escape(id):id;
        try{
          Array.prototype.forEach.call(
            document.querySelectorAll('a[href="#'+eid+'"],[data-sw-modal="'+eid+'"]'),
            function(t){wireTrigger(t,dialog);}
          );
        }catch(e){}
      }
    }else{
      var openBtn=root.querySelector('[data-sw-part="open"]');
      if(openBtn)wireTrigger(openBtn,dialog);
    }
    // 'close' fires for EVERY dismissal path (Escape, close button, backdrop, form method=dialog),
    // so the lock is always released exactly once per open.
    dialog.addEventListener('close',unlock);
    // Build the neutral PANEL + the visible BODY inside the <dialog>, leaving the <dialog> itself a
    // transparent, full-viewport SCROLLER — so a TALL modal scrolls at the SCREEN edge (not inside its
    // body) and the overhanging close is never clipped. The author's class is SPLIT off the <dialog>:
    // WIDTH utilities (w-/max-w-/min-w-) size the panel (whose parent — the dialog — is the definite-width
    // flex container, so % widths resolve stably), everything else + the inline style PAINTS the body
    // (bg/rounded/padding/shadow; an author overflow-hidden clips the card WITHOUT touching the
    // panel-anchored close). Nodes are MOVED, not re-serialized, so listeners / form state / iframes
    // survive. Idempotent (skips if a panel already exists); honours an author-supplied [data-sw-part="body"].
    var panel=null;
    for(var pi=0;pi<dialog.children.length;pi++){if(dialog.children[pi].getAttribute('data-sw-part')==='panel'){panel=dialog.children[pi];break;}}
    if(!panel){
      panel=document.createElement('div');
      panel.setAttribute('data-sw-part','panel');
      // Find or create the BODY (the visible card). Content lives in the body; the panel paints nothing.
      var body=null;
      for(var bi=0;bi<dialog.children.length;bi++){if(dialog.children[bi].getAttribute('data-sw-part')==='body'){body=dialog.children[bi];break;}}
      if(body){
        // Author supplied a body part: move it AND any sibling nodes into the panel, preserving order.
        while(dialog.firstChild){panel.appendChild(dialog.firstChild);}
      }else{
        // No body part: wrap ALL authored children in a generated body.
        body=document.createElement('div');body.setAttribute('data-sw-part','body');while(dialog.firstChild){body.appendChild(dialog.firstChild);}
        panel.appendChild(body);
      }
      // SPLIT the author classes: width utilities (with any variant prefix, e.g. sm:w-full) → panel;
      // everything else → body. classList tokenizes robustly; the width regex has NO backslash escape
      // (it lives inside this template literal, where \\s would be mangled). Then the inline style
      // (usually a bg gradient) paints the body too.
      if(dialog.className){
        var wtoks=[],otoks=[],cls=Array.prototype.slice.call(dialog.classList);
        for(var ci=0;ci<cls.length;ci++){(/^(?:[^:]+:)*(?:w|max-w|min-w)-/.test(cls[ci])?wtoks:otoks).push(cls[ci]);}
        if(wtoks.length){panel.className=wtoks.join(' ');}
        if(otoks.length){body.className=body.className?body.className+' '+otoks.join(' '):otoks.join(' ');}
        dialog.removeAttribute('class');
      }
      var st=dialog.getAttribute('style');
      if(st){body.setAttribute('style',st);dialog.removeAttribute('style');}
      // Land the <dialog>'s open-focus on the TOP of the modal (the panel) so a TALL modal opens at its
      // top — NOT scrolled down to whatever the first focusable content happens to be — and neither the
      // close nor a deep control is ring-highlighted on open. Only when the author hasn't set their own
      // autofocus; tabindex=-1 makes the panel programmatically focusable (Tab still walks into content).
      if(!dialog.querySelector('[autofocus]')){panel.setAttribute('tabindex','-1');panel.setAttribute('autofocus','');}
      dialog.appendChild(panel);
    }
    // Config attrs live on the marker (the wrapper in the legacy form, the <dialog> in the lighter one).
    // Auto close button OVERHANGS the panel's top-right corner, unless opted out with data-closebutton="false".
    // Appended LAST (it's position:absolute, so visually unchanged) so it is NOT the first focusable —
    // the <dialog>'s open-focus then lands on the first CONTENT control instead of the dismiss button.
    if(root.getAttribute('data-closebutton')!=='false'&&!panel.querySelector('[data-sw-part="autoclose"]')){
      var x=document.createElement('button');
      x.type='button';
      x.setAttribute('data-sw-part','autoclose');
      x.setAttribute('aria-label',root.getAttribute('data-close-label')||swt('close','Close'));
      x.innerHTML=CLOSE_SVG;
      x.addEventListener('click',function(){dialog.close();});
      panel.appendChild(x);
    }
    // Authored close buttons (any number) inside the dialog dismiss too.
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-sw-part="close"]'),function(b){b.addEventListener('click',function(){dialog.close();});});
    // Backdrop click closes unless data-backdrop-close="false".
    if(root.getAttribute('data-backdrop-close')!=='false'){
      dialog.addEventListener('click',function(e){if(e.target===dialog){dialog.close();}});
    }
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="modal"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Tabs --------------------------------------------------------------------
// A tablist + panels (APG Tabs pattern). The JS builds the tablist (creating the
// mount if absent) from each panel's title, wires roving-tabindex + arrow-key
// navigation + aria, slides a floating "magic" selector pill to the active tab,
// and shows one panel at a time. PE-first: with no JS the tablist stays hidden
// and ALL panels render stacked (fully readable content). Styling keys on the
// `data-sw-component="tabs"` marker so `data-sw-block` is NOT required in markup.
const TABS_CSS = [
  // PE-first: any authored tablist stays hidden until the runtime enhances.
  '[data-sw-component="tabs"] [data-sw-part="tablist"]{display:none}',
  // The enhanced tablist is the positioning context for the floating selector pill.
  '[data-sw-component="tabs"][data-sw-enhanced="true"] [data-sw-part="tablist"]{position:relative;display:flex;flex-wrap:wrap;gap:.25rem;margin-bottom:1rem}',
  // The "magic" floating background selector — a primary pill the runtime slides to
  // the active tab (transform/width/height set inline from the tab's box). Sits BEHIND
  // the tab labels (z-index:0); zero size until positioned so it never flashes at 0,0.
  '[data-sw-component="tabs"] [data-sw-part="tabindicator"]{position:absolute;top:0;left:0;width:0;height:0;border-radius:.5rem;background:var(--sw-color-primary,#0a7a5a);transform:translate(0,0);transition:transform .3s cubic-bezier(.4,0,.2,1),width .3s cubic-bezier(.4,0,.2,1),height .3s cubic-bezier(.4,0,.2,1);pointer-events:none;z-index:0}',
  // Tab buttons: BOLD, default text colour, rounded, above the pill, clipping the ripple.
  '[data-sw-component="tabs"] [data-sw-part="tab"]{position:relative;z-index:1;display:inline-flex;align-items:center;gap:.4rem;overflow:hidden;border:0;background:none;margin:0;padding:.5rem 1rem;border-radius:.5rem;font:inherit;font-weight:700;color:inherit;cursor:pointer;transition:color .2s ease;-webkit-tap-highlight-color:transparent}',
  // A rich-label element (data-sw-part="tabtitle") whose nodes the runtime moves into the
  // tab button. Before enhancement it stays in the panel as that section\'s heading-style
  // label (block + bottom margin so it reads as a heading in the no-JS stack); the runtime
  // removes the wrapper from the panel once it builds the button.
  '[data-sw-component="tabs"] [data-sw-part="tabtitle"]{display:flex;align-items:center;gap:.4rem;font-weight:700;margin-block-end:.5rem}',
  // Hover → primary; the active tab (over the primary pill) keeps the on-primary text colour even on hover.
  '[data-sw-component="tabs"] [data-sw-part="tab"]:hover{color:var(--sw-color-primary,#0a7a5a)}',
  '[data-sw-component="tabs"] [data-sw-part="tab"][aria-selected="true"],[data-sw-component="tabs"] [data-sw-part="tab"][aria-selected="true"]:hover{color:var(--sw-color-primary-content,#fff)}',
  // Press ripple ("waves") on the buttons — self-contained so it ships with the Tabs
  // bundle (the shared .waves-effect runtime only binds elements present at load, but
  // the tab buttons are generated at runtime). Primary tint inactive, on-primary tint over the pill.
  '[data-sw-component="tabs"] [data-sw-part="tab"] .sw-ripple{position:absolute;border-radius:9999px;pointer-events:none;transform:scale(0);background:color-mix(in srgb,var(--sw-color-primary,#0a7a5a) 28%,transparent);animation:sw-tab-ripple .6s ease-out forwards}',
  '[data-sw-component="tabs"] [data-sw-part="tab"][aria-selected="true"] .sw-ripple{background:color-mix(in srgb,var(--sw-color-primary-content,#fff) 50%,transparent)}',
  '@keyframes sw-tab-ripple{to{transform:scale(1);opacity:0}}',
  // One panel at a time once enhanced; reset the UA figure/dl side margins (modern-normalize
  // keeps them — a <figure> panel would otherwise inset its content by 40px).
  '[data-sw-component="tabs"][data-sw-enhanced="true"] [data-sw-part="panel"]:not([data-active]){display:none}',
  '[data-sw-component="tabs"] [data-sw-part="panel"]{margin:0}',
  // Automatic + REPEATABLE fade-in: the data-active flip restarts this keyframe every
  // time a panel is selected (not just the first), so each switch fades the panel in.
  '[data-sw-component="tabs"][data-sw-enhanced="true"] [data-sw-part="panel"][data-active]{animation:sw-tab-in .3s ease both}',
  '@keyframes sw-tab-in{from{opacity:0;transform:translateY(.5rem)}to{opacity:1;transform:none}}',
  // Reduced motion: no pill glide, no panel fade (the ripple is JS-gated off too).
  '@media(prefers-reduced-motion:reduce){[data-sw-component="tabs"] [data-sw-part="tabindicator"]{transition:none}[data-sw-component="tabs"][data-sw-enhanced="true"] [data-sw-part="panel"][data-active]{animation:none}}',
].join('');

const TABS_JS = `(function(){
  var uid=0;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Press ripple: build one span sized to cover the button from the press point. Built
  // with createElement + inline numeric styles only — no markup injection from any string.
  function ripple(e){
    if(reduce)return;
    var el=e.currentTarget,rect=el.getBoundingClientRect();
    var x=(e.clientX!=null?e.clientX:rect.left+rect.width/2)-rect.left;
    var y=(e.clientY!=null?e.clientY:rect.top+rect.height/2)-rect.top;
    var size=Math.max(rect.width,rect.height)*2;
    var s=document.createElement('span');
    s.className='sw-ripple';
    s.style.width=s.style.height=size+'px';
    s.style.left=(x-size/2)+'px';s.style.top=(y-size/2)+'px';
    el.appendChild(s);
    var rm=function(){if(s.parentNode)s.parentNode.removeChild(s);};
    s.addEventListener('animationend',rm,{once:true});setTimeout(rm,800);
  }
  function enhance(root){
    if(root.getAttribute('data-sw-enhanced')==='true')return;
    var panels=Array.prototype.slice.call(root.querySelectorAll('[data-sw-part="panel"]'));
    if(panels.length<2)return;
    // The tablist mount is optional in authored markup — create it if absent.
    var tablist=root.querySelector('[data-sw-part="tablist"]');
    if(!tablist){tablist=document.createElement('div');tablist.setAttribute('data-sw-part','tablist');root.insertBefore(tablist,root.firstChild);}
    tablist.setAttribute('role','tablist');
    // The floating "magic" selector pill (positioned behind the tab labels).
    var pill=document.createElement('div');
    pill.setAttribute('data-sw-part','tabindicator');pill.setAttribute('aria-hidden','true');
    tablist.appendChild(pill);
    var gid='sw-tabs-'+(uid++),tabs=[],current=0;
    function movePill(){
      var t=tabs[current];if(!t)return;
      pill.style.width=t.offsetWidth+'px';pill.style.height=t.offsetHeight+'px';
      pill.style.transform='translate('+t.offsetLeft+'px,'+t.offsetTop+'px)';
    }
    function select(i){
      current=i;
      for(var j=0;j<panels.length;j++){
        var on=j===i;
        if(on){panels[j].setAttribute('data-active','');}else{panels[j].removeAttribute('data-active');}
        tabs[j].setAttribute('aria-selected',on?'true':'false');tabs[j].tabIndex=on?0:-1;
      }
      movePill();
    }
    panels.forEach(function(panel,i){
      panel.setAttribute('role','tabpanel');
      var pid=gid+'-p'+i,tid=gid+'-t'+i;
      panel.id=pid;panel.setAttribute('aria-labelledby',tid);
      var btn=document.createElement('button');
      btn.type='button';btn.id=tid;btn.setAttribute('role','tab');btn.setAttribute('data-sw-part','tab');btn.setAttribute('aria-controls',pid);
      // Rich label: a direct-child data-sw-part="tabtitle" holds already-rendered (server
      // -escaped/sanitized) markup — MOVE its nodes into the button (no string is ever parsed
      // into markup, so no XSS sink). data-sw-title is the text fallback + the aria-label.
      var title=null,kids=panel.children;
      for(var k=0;k<kids.length;k++){if(kids[k].getAttribute('data-sw-part')==='tabtitle'){title=kids[k];break;}}
      if(title){
        while(title.firstChild){btn.appendChild(title.firstChild);}
        title.parentNode.removeChild(title);
        // Always give the button an accessible name (icon-only rich titles have no text).
        btn.setAttribute('aria-label',panel.getAttribute('data-sw-title')||('Tab '+(i+1)));
      }else{
        btn.textContent=panel.getAttribute('data-sw-title')||('Tab '+(i+1));
      }
      btn.addEventListener('pointerdown',ripple);
      btn.addEventListener('click',function(){select(i);tabs[i].focus();});
      btn.addEventListener('keydown',function(e){var n=-1;if(e.key==='ArrowRight'){n=(i+1)%tabs.length;}else if(e.key==='ArrowLeft'){n=(i-1+tabs.length)%tabs.length;}else if(e.key==='Home'){n=0;}else if(e.key==='End'){n=tabs.length-1;}if(n>=0){e.preventDefault();select(n);tabs[n].focus();}});
      tablist.appendChild(btn);tabs.push(btn);
    });
    root.setAttribute('data-sw-enhanced','true');
    // Place the pill INSTANTLY on the initial tab (no slide-in from 0,0), then restore the
    // CSS glide one frame later so subsequent tab switches animate.
    pill.style.transition='none';
    select(0);
    requestAnimationFrame(function(){requestAnimationFrame(function(){pill.style.transition='';});});
    // Re-measure the pill when the tab bar reflows (responsive wrap) + after web fonts
    // settle. A ResizeObserver scoped to the tablist avoids leaking a global resize
    // listener per instance (and catches container resizes, not just window resizes).
    var ric;
    function schedule(){clearTimeout(ric);ric=setTimeout(movePill,100);}
    if(typeof ResizeObserver!=='undefined'){new ResizeObserver(schedule).observe(tablist);}
    else{window.addEventListener('resize',schedule);}
    if(document.fonts&&document.fonts.ready&&document.fonts.ready.then){document.fonts.ready.then(movePill);}
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="tabs"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Form --------------------------------------------------------------------
// A web form with NO `action=` attribute — submission is JS-only. The handler
// posts the fields as JSON to `data-sw-endpoint` (the Sitewright platform), adds
// a time-trap (`_elapsed` ms since load) the server uses to reject instant bot
// posts, then shows the inline success/error message or follows `data-sw-redirect`.
// PE note: with no JS the form simply cannot submit (no action), by design.
const FORM_CSS = [
  '[data-sw-block="Form"] [data-sw-part="field"]{display:block;margin-bottom:1rem}',
  '[data-sw-block="Form"] [data-sw-part="label"]{display:block;margin-bottom:.25rem;font-size:.875rem}',
  '[data-sw-block="Form"] input,[data-sw-block="Form"] textarea,[data-sw-block="Form"] select{width:100%;padding:.5rem .625rem;border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 20%,transparent);border-radius:.375rem;font:inherit}',
  // checkbox / radio inputs must NOT stretch to 100% — they sit inline next to their option label.
  '[data-sw-block="Form"] input[type=checkbox],[data-sw-block="Form"] input[type=radio]{width:auto;padding:0;border-radius:0;flex:none}',
  '[data-sw-block="Form"] fieldset[data-sw-part="field"]{border:0;padding:0;margin:0 0 1rem;min-inline-size:0}',
  '[data-sw-block="Form"] legend[data-sw-part="label"]{padding:0;margin-bottom:.35rem;font-size:.875rem}',
  // option ROWS inside a group sit tight (.25rem); a single-checkbox field keeps the normal field margin.
  '[data-sw-block="Form"] .sw-form-opt{display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem}',
  '[data-sw-block="Form"] .sw-form-check{display:flex;align-items:center;gap:.5rem}',
  '[data-sw-block="Form"] .sw-form-check [data-sw-part="label"]{margin-bottom:0}',
  // The submit button uses the vendored .btn (rendered with `class="btn btn-primary"`); only the
  // submitting/disabled cursor is kept here.
  '[data-sw-block="Form"] [data-sw-part="submit"][disabled]{cursor:progress}',
  // Honeypot: take it out of the layout + the a11y tree, off-screen (not display:none,
  // which some bots skip). Real users never see or tab to it.
  '[data-sw-block="Form"] [data-sw-part="hp"]{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
  '[data-sw-block="Form"] [data-sw-part="success"]{color:#0a7a5a;margin-top:.75rem}',
  '[data-sw-block="Form"] [data-sw-part="error"]{color:#b00020;margin-top:.75rem}',
].join('');

const FORM_JS = `(function(){
  function ensureHcaptcha(){
    if(!document.querySelector('.h-captcha'))return;
    if(window.hcaptcha)return;
    if(document.querySelector('script[data-sw-hcaptcha]'))return;
    var s=document.createElement('script');
    s.src='https://js.hcaptcha.com/1/api.js';s.async=true;s.defer=true;
    s.setAttribute('data-sw-hcaptcha','');
    document.head.appendChild(s);
  }
  function enhance(form){
    var endpoint=form.getAttribute('data-sw-endpoint');
    if(!endpoint)return;
    var started=Date.now();
    var success=form.querySelector('[data-sw-part="success"]');
    var error=form.querySelector('[data-sw-part="error"]');
    var submit=form.querySelector('[data-sw-part="submit"]');
    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(error)error.hidden=true;
      // If this form has an hCaptcha that hasn't been solved yet, prompt instead of
      // posting a token-less submission that the server would reject (fail-closed).
      if(form.querySelector('.h-captcha')){
        var token=(window.hcaptcha&&window.hcaptcha.getResponse)?window.hcaptcha.getResponse():'';
        if(!token){if(error){error.textContent='Please complete the captcha.';error.hidden=false;}return;}
      }
      var data={};
      Array.prototype.forEach.call(form.querySelectorAll('input,textarea,select'),function(el){
        if(!el.name||el.type==='submit'||el.type==='button')return;
        if((el.type==='checkbox'||el.type==='radio')&&!el.checked)return; // only CHECKED options count
        if(el.type==='checkbox'&&Object.prototype.hasOwnProperty.call(data,el.name)){
          // a checkbox GROUP (several boxes share a name) collects into an array; the endpoint joins them
          if(!Array.isArray(data[el.name]))data[el.name]=[data[el.name]];
          data[el.name].push(el.value);
        }else{
          data[el.name]=el.value;
        }
      });
      data['_elapsed']=String(Date.now()-started);
      if(submit)submit.disabled=true;
      fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}).then(function(res){
        if(!res.ok)throw new Error('bad status');
        var redirect=form.getAttribute('data-sw-redirect');
        if(redirect){window.location.assign(redirect);return;}
        form.reset();
        if(success)success.hidden=false;
        form.setAttribute('data-sw-submitted','true');
      }).catch(function(){
        if(error)error.hidden=false;
      }).then(function(){
        if(submit)submit.disabled=false;
      });
    });
  }
  function init(){ensureHcaptcha();Array.prototype.forEach.call(document.querySelectorAll('form[data-sw-component="form"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- DateTimePicker ----------------------------------------------------------
// Vanilla Calendar Pro-powered date / range / datetime / time picker. data-mode="range" shows a
// DUAL-PANEL two-month view. PE-first: the marker sits on a plain text <input>, so with no JS it
// stays a usable, submittable text field; the runtime upgrades it into the popup picker (or an
// inline calendar when the marker is on a block element).
//
// We ship the vendor's POLISHED index.css (layout + its light theme — compact rounded cells, a clean
// header, muted weekday/weekend accents, a soft popup shadow) so the picker looks finished, then
// RECOLOUR its cyan accent to the site CI primary. The recolours are broad `!important` rules: they
// beat the vendor's (non-important) theme rules regardless of how deeply compound those selectors are
// (weekend/holiday/other-month variants), so every selected day / range band / today / month-year
// selection takes the brand colour. We also adopt the body font, lift the popup above sticky chrome,
// and add a fade+rise OPEN ANIMATION (the vendor toggles the popup via opacity, so a transition
// animates it) — dropped under prefers-reduced-motion. The runtime pins the light theme.
const DATETIMEPICKER_CSS = [
  // The enhanced input reads as clickable (the picker opens on focus/click).
  ':where(input[data-sw-component="datetimepicker"][data-sw-enhanced="true"]){cursor:pointer}',
  DATETIMEPICKER_VENDOR_CSS,
  // Adopt the site body font; lift the input-mode popup above sticky chrome.
  '.vc{font-family:var(--sw-font-body,ui-sans-serif,system-ui,sans-serif)}',
  '.vc[data-vc-input]{z-index:1000}',
  // OPEN ANIMATION: the vendor hides the popup with opacity:0 (not display:none), so a transition on
  // the shown vs hidden state animates it — fade in with a small rise + scale.
  '.vc[data-vc-input]{transition:opacity .18s ease,transform .18s ease;transform-origin:top center}',
  '.vc[data-vc-input][data-vc-calendar-hidden]{transform:translateY(-6px) scale(.985)}',
  // When the popup opens ABOVE the input (vendor sets data-vc-position=top near the viewport bottom),
  // flip the animation so it still rises out FROM the input instead of away from it.
  '.vc[data-vc-input][data-vc-position=top]{transform-origin:bottom center}',
  '.vc[data-vc-input][data-vc-position=top][data-vc-calendar-hidden]{transform:translateY(6px) scale(.985)}',
  // --- Recolour the vendor cyan accent → CI primary (broad !important beats its theme rules) ---
  // Selected day(s): single, range endpoints, multiple set — solid primary, white text.
  '[data-vc-theme] .vc-date[data-vc-date-selected] .vc-date__btn{background-color:var(--sw-color-primary,#0a7a5a)!important;color:#fff!important}',
  // Range MIDDLE days: a lighter brand band (the vendor marks them data-vc-date-selected="middle").
  // Text fallback is currentColor (the theme's own text) so it stays legible on the dark theme too,
  // even if --sw-color-base-content is out of scope.
  '[data-vc-theme] .vc-date[data-vc-date-selected="middle"] .vc-date__btn{background-color:color-mix(in srgb,var(--sw-color-primary,#0a7a5a) 16%,transparent)!important;color:var(--sw-color-base-content,currentColor)!important}',
  // Range hover-preview band while dragging the second endpoint.
  '[data-vc-theme] .vc-date[data-vc-date-hover] .vc-date__btn{background-color:color-mix(in srgb,var(--sw-color-primary,#0a7a5a) 16%,transparent)!important;color:var(--sw-color-base-content,currentColor)!important}',
  // Today: brand text (the vendor uses its cyan here).
  '[data-vc-theme] .vc-date[data-vc-date-today] .vc-date__btn{color:var(--sw-color-primary,#0a7a5a)!important}',
  // Neutralise the vendor's RED weekends → the calendar's own neutrals, so the CI primary stays the
  // single accent (cleaner + brand-owned), in BOTH light and dark. Headers match the normal weekday
  // header per theme (light #64748b / dark #fff). The weekend day numbers use `inherit` so they take
  // the calendar's theme text colour automatically (dark text on light, light text on dark) — matching
  // the normal days — excluding selected (stay white), today (stays primary), and other-month (stay muted).
  '[data-vc-theme=light] .vc-week__day[data-vc-week-day-off]{color:#64748b!important}',
  '[data-vc-theme=dark] .vc-week__day[data-vc-week-day-off]{color:#fff!important}',
  '[data-vc-theme] .vc-date[data-vc-date-weekend]:not([data-vc-date-selected]):not([data-vc-date-today]):not([data-vc-date-month="next"]):not([data-vc-date-month="prev"]) .vc-date__btn{color:inherit!important}',
  // TIME-ONLY mode (data-mode="time" → layout is just the time control): the time block is the popup's
  // FIRST child, so drop the calendar-separator border + top spacing it carries when it sits under a
  // calendar (datetime mode keeps them — there the time block is not first-child). VCP 3.1.0: in
  // time-only the .vc root's first child is [data-vc=time] — re-verify if bumping vanilla-calendar-pro.
  '[data-vc=time]:first-child{margin-top:0;padding-top:0;border-width:0}',
  // Month / year drill-in grid: the selected month/year cell = primary.
  '[data-vc-theme] [data-vc-months-month][aria-selected="true"],[data-vc-theme] [data-vc-years-year][aria-selected="true"]{background-color:var(--sw-color-primary,#0a7a5a)!important;color:#fff!important}',
  // Brand-coloured time slider thumbs.
  '.vc input[type=range]{accent-color:var(--sw-color-primary,#0a7a5a)}',
  // Reduced motion: no open/hover transitions.
  '@media (prefers-reduced-motion:reduce){.vc,.vc *{transition:none}}',
].join('');
const DATETIMEPICKER_JS = DATETIMEPICKER_RUNTIME_JS;

// Registry keyed by block `type`. Only blocks with behavior/styling belong here
// (child blocks like Slide/LightboxItem/Tab are styled by their
// parent's entry — no entry of their own). Insertion order = bundle order.
const COMPONENTS = new Map<string, ComponentAsset>([
  ['Carousel', { css: CAROUSEL_CSS, js: CAROUSEL_JS }],
  ['Lightbox', { css: LIGHTBOX_CSS, js: LIGHTBOX_JS }],
  ['Modal', { css: MODAL_CSS, js: MODAL_JS }],
  ['Banner', { css: BANNER_CSS, js: BANNER_JS }],
  ['Tabs', { css: TABS_CSS, js: TABS_JS }],
  ['Form', { css: FORM_CSS, js: FORM_JS }],
  ['DateTimePicker', { css: DATETIMEPICKER_CSS, js: DATETIMEPICKER_JS }],
  ['ShaderBg', { css: SHADER_BG_CSS, js: SHADER_BG_JS }],
]);

/** Block types that are interactive components (have bundled CSS/JS). */
export const COMPONENT_TYPES: ReadonlySet<string> = new Set(COMPONENTS.keys());

/**
 * `data-sw-component` attribute NAME → component block `type`. MUST stay in sync with the names
 * the components above expect on their root marker.
 */
const COMPONENT_NAME_TO_TYPE: ReadonlyMap<string, string> = new Map([
  ['carousel', 'Carousel'],
  ['lightbox', 'Lightbox'],
  ['modal', 'Modal'],
  ['banner', 'Banner'],
  ['tabs', 'Tabs'],
  ['form', 'Form'],
  ['datetimepicker', 'DateTimePicker'],
  ['shader-bg', 'ShaderBg'],
]);

const COMPONENT_MARKER_RE = /data-sw-component="([a-z-]+)"/g;

/**
 * The distinct component block types referenced by `data-sw-component="…"` markers in a rendered /
 * CODE-FIRST Handlebars source string. Pages render from `source`, so this string scan ships the
 * component's CSS/JS the same way animations/lazyload/ripple are detected (a literal-marker scan over
 * page sources, skeleton slots, and snippets). Empty for component-free source.
 */
export function componentTypesInSource(html: string | null | undefined): string[] {
  if (typeof html !== 'string' || html.length === 0) return [];
  const seen = new Set<string>();
  for (const match of html.matchAll(COMPONENT_MARKER_RE)) {
    const name = match[1];
    if (!name) continue;
    const type = COMPONENT_NAME_TO_TYPE.get(name);
    if (type) seen.add(type);
  }
  // A form embedded by REFERENCE — `{{sw-form "id"}}` or an authored `data-sw-form="id"` — only
  // gains its `data-sw-component="form"` marker at render (the form-embed pass), so the source
  // scan must catch the reference itself. Anchored to the two real spellings (helper call /
  // attribute), so prose or a future `sw-format` helper doesn't over-ship the Form assets.
  if (/(?:\{\{\s*|data-)sw-form\b/.test(html)) seen.add('Form');
  return [...seen];
}

/**
 * Component types whose stylesheet keys on `[data-sw-block="<Type>"]` (Carousel, Lightbox, Form) — as
 * opposed to the ones that key on `[data-sw-component="<name>"]` directly (Banner, Tabs, Modal, …) and
 * so need no paired block attribute. DERIVED from each component's own CSS so this can never drift as
 * components are added or re-keyed. Used by {@link addComponentBlockMarkers}.
 */
const BLOCK_KEYED_TYPES: ReadonlySet<string> = new Set(
  [...COMPONENTS].filter(([type, asset]) => asset.css.includes(`[data-sw-block="${type}"]`)).map(([type]) => type),
);

/**
 * Pair a `data-sw-component="<name>"` marker with the `data-sw-block="<Type>"` attribute its stylesheet
 * keys on, when (and only when) that component is BLOCK-KEYED (Carousel, Lightbox, Form) and the tag
 * lacks it. For those, `data-sw-component` ships the CSS/JS (via {@link componentTypesInSource}) + is what
 * the runtime enhances, while `data-sw-block` is the CSS selector target — part layout, control chrome,
 * and the visually-hidden `.sw-sr-only` live region. Source that writes ONLY `data-sw-component` (an easy
 * miss when authoring a clone) would otherwise render the component with NONE of its stylesheet applied:
 * an on-screen "Slide x of y" live region, unsized slides, inert controls left visible. Every seed page /
 * snippet / widget already authors both; this makes the single-attribute form work too. Component-keyed
 * components (Banner/Tabs/Modal/…) are left untouched — their CSS needs no block attribute. Idempotent
 * (skips a tag that already has `data-sw-block`) and a no-op for component-free markup. Runs as a
 * renderTemplate post-pass so BOTH the preview and publish paths get it (no drift).
 */
export function addComponentBlockMarkers(html: string): string {
  if (typeof html !== 'string' || html.indexOf('data-sw-component=') === -1) return html;
  return html.replace(/<[a-zA-Z][^>]*\bdata-sw-component="([a-z-]+)"[^>]*>/g, (tag: string, name: string) => {
    const type = COMPONENT_NAME_TO_TYPE.get(name);
    if (!type || !BLOCK_KEYED_TYPES.has(type) || /\bdata-sw-block\s*=/.test(tag)) return tag;
    return tag.replace(`data-sw-component="${name}"`, `data-sw-component="${name}" data-sw-block="${type}"`);
  });
}

/**
 * Bundles the CSS + JS for the given component types into single strings (deduped,
 * in stable registry order). Unknown types are ignored. Empty when none are used,
 * so callers ship nothing for sites that use no components.
 */
export function componentAssets(types: Iterable<string>): { css: string; js: string } {
  const want = new Set(types);
  const css: string[] = [];
  const js: string[] = [];
  for (const [type, asset] of COMPONENTS) {
    if (!want.has(type)) continue;
    if (asset.css) css.push(asset.css);
    if (asset.js) js.push(asset.js);
  }
  return { css: css.join('\n'), js: js.join('\n') };
}
