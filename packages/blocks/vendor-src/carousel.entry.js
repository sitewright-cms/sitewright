// Carousel runtime ENTRY — bundled by scripts/gen-vendor.mjs into src/vendor/carousel-runtime.ts.
// Embla Carousel (MIT) + first-party wiring. The authored contract stays declarative:
// `data-sw-component="carousel"` + `data-sw-part` roles + `data-*` config attributes — the
// library is an implementation detail behind the marker (agents/tenants never call it).
//
// Authored markup (see COMPONENT_CATALOG): root > track > slide*, with optional prev/next
// buttons and a dots mount ANYWHERE inside the root. At enhance the runtime moves the slides
// into a generated [data-sw-part="container"] flex element inside the track (Embla transforms
// the container; the track becomes the clipping viewport). With no JS the track stays the
// CSS scroll-snap row from the component CSS — fully swipeable, controls hidden.
import EmblaCarousel from 'embla-carousel';
import Autoplay from 'embla-carousel-autoplay';
import AutoScroll from 'embla-carousel-auto-scroll';
import AutoHeight from 'embla-carousel-auto-height';
import Fade from 'embla-carousel-fade';
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures';

// Lucide `circle` glyph (24×24 grid, r=10, stroke 2) for the generated dot indicators — the
// active dot fills via CSS on [aria-current="true"].
var DOT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>';

function enhance(root) {
  if (root.getAttribute('data-sw-enhanced') === 'true') return;
  var track = root.querySelector('[data-sw-part="track"]');
  if (!track) return;
  var slides = Array.prototype.slice.call(track.querySelectorAll('[data-sw-part="slide"]'));
  if (slides.length < 2) return;

  var attr = function (name, fallback) {
    var v = root.getAttribute(name);
    return v === null || v === '' ? fallback : v;
  };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var loop = attr('data-loop', '') === 'true';

  // Interactive descendants keep their own meaning in click-to-slide mode: clicks on these
  // never advance the carousel, and (matching that) presses on them never ripple the slide.
  var INTERACTIVE = 'a,button,input,select,textarea,label,[contenteditable]';

  // Material-style press ripple ("waves" in contentBase terms) — DEFAULT on every control
  // (arrows + dots), and on the slides themselves in click-to-slide mode. A pointer-anchored
  // disc expands and fades; CSS owns the animation, the span removes itself when it ends.
  // Keyboard activation has no pointer position, so it simply doesn't ripple.
  function addRipple(el, guarded) {
    el.classList.add('sw-waves');
    el.addEventListener('pointerdown', function (e) {
      if (reduce) return;
      if (guarded && e.target && e.target.closest && e.target.closest(INTERACTIVE)) return;
      var r = el.getBoundingClientRect();
      // 2× the control, but never a punier halo than 48px — small controls (dots) get a
      // real unbounded Material ripple that travels past their bounds.
      var d = Math.max(Math.max(r.width, r.height) * 2, 48);
      var s = document.createElement('span');
      s.className = 'sw-ripple';
      s.style.width = d + 'px';
      s.style.height = d + 'px';
      // Pace by SIZE: at a fixed duration the ripple's edge speed grows with the diameter —
      // a wrapper-sized disc (2000px+) would tear across the slider ~45× faster than a dot's
      // halo. Controls keep the snappy 0.65s; large surfaces ease out over up to 1.4s.
      s.style.animationDuration = Math.min(1.4, 0.65 + d / 3000).toFixed(2) + 's';
      s.style.left = e.clientX - r.left - d / 2 + 'px';
      s.style.top = e.clientY - r.top - d / 2 + 'px';
      el.appendChild(s);
      s.addEventListener('animationend', function () {
        if (s.parentNode) s.parentNode.removeChild(s);
      });
    });
  }

  // Restructure for the engine: slides move into a dedicated flex container that Embla
  // translates; the track itself stops scrolling (CSS flips on data-sw-enhanced).
  var container = document.createElement('div');
  container.setAttribute('data-sw-part', 'container');
  for (var i = 0; i < slides.length; i++) {
    var sl = slides[i];
    // EDITOR-PREVIEW only: a dataset-backed slider has each slide wrapped in a <div data-sw-entry>
    // (markEntries) so a click opens that entry's editor. Reparenting the slide into the Embla
    // container would orphan it from that wrapper, so HOIST the marker onto the slide itself and drop
    // the emptied wrapper. No-op in publish (no data-sw-entry) and for whole-carousel markers (e.g.
    // the hero, whose wrapper is OUTSIDE the slides) — there the slide's parent is the track.
    var wrap = sl.parentNode;
    if (wrap && wrap !== track && wrap.nodeType === 1 && wrap.hasAttribute('data-sw-entry') && wrap.children.length === 1) {
      if (!sl.hasAttribute('data-sw-entry')) sl.setAttribute('data-sw-entry', wrap.getAttribute('data-sw-entry') || '');
      var ds = wrap.getAttribute('data-sw-dataset');
      if (ds && !sl.hasAttribute('data-sw-dataset')) sl.setAttribute('data-sw-dataset', ds);
      container.appendChild(sl);
      if (wrap.parentNode && wrap.children.length === 0) wrap.parentNode.removeChild(wrap);
    } else {
      container.appendChild(sl);
    }
  }
  track.appendChild(container);

  // AT semantics (APG carousel pattern): name the widget and announce slide changes from a
  // visually-hidden live region. Auto-rotating carousels stay SILENT (aria-live="off") —
  // announcing every autoplay/autoscroll tick is noise; user-driven ones announce politely.
  if (!root.hasAttribute('role')) root.setAttribute('role', 'region');
  if (!root.hasAttribute('aria-roledescription')) root.setAttribute('aria-roledescription', 'carousel');
  var auto = attr('data-autoscroll', '') === 'true' || attr('data-autoplay', '') === 'true';
  var live = document.createElement('div');
  live.className = 'sw-sr-only';
  live.setAttribute('aria-live', auto ? 'off' : 'polite');
  live.setAttribute('aria-atomic', 'true');
  root.appendChild(live);

  var plugins = [];
  // Default effect is FADE (crossfade between slides); data-effect="slide" restores the
  // translating strip — required for multi-item ( --sw-items ) and peek layouts.
  if (attr('data-effect', 'fade') !== 'slide') plugins.push(Fade());
  if (attr('data-autoheight', '') === 'true') plugins.push(AutoHeight());
  if (attr('data-wheel', '') === 'true') plugins.push(WheelGesturesPlugin());
  // Autoplay (interval steps) vs AutoScroll (continuous ticker) — autoscroll wins when both
  // are authored. Both pause on hover/focus and are skipped entirely under reduced motion.
  if (!reduce && attr('data-autoscroll', '') === 'true') {
    plugins.push(
      AutoScroll({
        speed: parseFloat(attr('data-autoscroll-speed', '2')) || 2,
        startDelay: 0,
        stopOnInteraction: false,
        stopOnMouseEnter: true,
        stopOnFocusIn: true,
      }),
    );
  } else if (!reduce && attr('data-autoplay', '') === 'true') {
    plugins.push(
      Autoplay({
        delay: parseInt(attr('data-interval', '5000'), 10) || 5000,
        stopOnInteraction: false,
        stopOnMouseEnter: true,
        stopOnFocusIn: true,
      }),
    );
  }

  var embla = EmblaCarousel(
    track,
    {
      container: container,
      loop: loop,
      // Active-slide alignment (start|center|end), DEFAULT "center". `data-item-align` is the
      // author-facing knob (it ALSO sets justify-content for non-scrolling partial rows); it drives
      // Embla's align so that, for a scrolling/peek layout, "center" puts the active slide mid-viewport
      // with a peek on BOTH sides. `containScroll:'trimSnaps'` clamps the ends — so with loop off the
      // first slide is flush-left and the last flush-right, while in-between slides centre. Centre is
      // a no-op for single-item (full-width) sliders (centre ≡ start), so the default only shapes
      // MULTI-item layouts; set data-item-align="start" to opt a slider back to left alignment.
      align: attr('data-item-align', '') || attr('data-align', 'center'),
      containScroll: 'trimSnaps',
      duration: reduce ? 0 : 25,
    },
    plugins,
  );

  var prev = root.querySelector('[data-sw-part="prev"]');
  var next = root.querySelector('[data-sw-part="next"]');
  if (prev) { addRipple(prev); prev.addEventListener('click', function () { embla.scrollPrev(); }); }
  if (next) { addRipple(next); next.addEventListener('click', function () { embla.scrollNext(); }); }

  // Click-to-slide (data-click-next="true"): the whole slide advances the carousel — the
  // navigation-less pattern. The press ripple lives on the WRAPPER (root), not the slides —
  // a slide-hosted ripple would translate away with the outgoing slide mid-advance. The
  // guarded flag skips presses on interactive descendants (incl. the arrows/dots buttons,
  // which ripple themselves); clicks on those keep their own meaning, and a click that ends
  // a DRAG never fires (the pointer travelled). The root becomes focusable so arrow keys
  // still work with no controls.
  if (attr('data-click-next', '') === 'true') {
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    addRipple(root, true);
    var downX = 0;
    var downY = 0;
    track.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary) return; // multi-touch: only the first finger anchors the drag check
      downX = e.clientX;
      downY = e.clientY;
    });
    track.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest(INTERACTIVE)) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
      embla.scrollNext();
    });
  }

  var dotsWrap = root.querySelector('[data-sw-part="dots"]');
  var dots = [];
  function buildDots() {
    if (!dotsWrap) return;
    dotsWrap.removeAttribute('aria-hidden');
    while (dotsWrap.firstChild) dotsWrap.removeChild(dotsWrap.firstChild);
    // One dot per SNAP POINT (fewer than slides in multi-item layouts).
    dots = embla.scrollSnapList().map(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = DOT_SVG; // trusted constant above — never tenant data
      b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      addRipple(b);
      b.addEventListener('click', function () { embla.scrollTo(i); });
      dotsWrap.appendChild(b);
      return b;
    });
  }
  // data-active stamping (same convention as Tabs panels): the CSS styling hook for
  // per-activation effects — caption entrances, Ken Burns — because an attribute flip
  // natively restarts matching keyframes. slideRegistry maps snap → slide indices (a snap
  // covers several slides in multi-item layouts); it's the same internalEngine surface the
  // AutoHeight plugin uses. If an Embla upgrade ever drops slideRegistry, the || [] makes
  // this fail SILENTLY (no data-active anywhere, activation CSS stops); if it drops
  // internalEngine() ITSELF this THROWS instead — either way, check here first after bumps
  // (guard pattern if needed: var eng = embla.internalEngine && embla.internalEngine()).
  //
  // Marking is SPLIT: the incoming slide is marked immediately on select (its keyframes
  // must start with the transition), but stale markers are pruned only on SETTLE. Removing
  // the attribute kills a running animation and the transform SNAPS to base — transitions
  // can't catch animation removal — so the outgoing slide keeps drifting until the
  // crossfade/translate has finished and the snap happens off-screen (opacity 0 in fade
  // mode, translated out of the viewport in slide mode).
  function snapRegistry() {
    return embla.internalEngine().slideRegistry[embla.selectedScrollSnap()] || [];
  }
  function pruneActive() {
    var active = snapRegistry();
    for (var s = 0; s < slides.length; s++) {
      if (active.indexOf(s) === -1) slides[s].removeAttribute('data-active');
    }
  }
  function sync() {
    var sel = embla.selectedScrollSnap();
    for (var i = 0; i < dots.length; i++) {
      dots[i].setAttribute('aria-current', i === sel ? 'true' : 'false');
    }
    var active = snapRegistry();
    live.textContent = 'Slide ' + (sel + 1) + ' of ' + embla.scrollSnapList().length;
    for (var s = 0; s < slides.length; s++) {
      if (active.indexOf(s) !== -1) slides[s].setAttribute('data-active', '');
    }
    if (!loop) {
      var pDis = !embla.canScrollPrev();
      var nDis = !embla.canScrollNext();
      // Disabling a focused button drops keyboard focus to <body>, stranding arrow-key
      // navigation (the keydown listener lives on the root). Per the APG carousel pattern,
      // hand focus to the opposite arrow before it happens.
      if (prev && pDis && document.activeElement === prev && next && !nDis) next.focus();
      if (next && nDis && document.activeElement === next && prev && !pDis) prev.focus();
      if (prev) prev.disabled = pDis;
      if (next) next.disabled = nDis;
    }
  }
  // data-item-align on the ENHANCED container: only meaningful when the row FITS (no scrolling) —
  // then justify-content distributes the underfull items. When the track OVERFLOWS, Embla's `align`
  // (set from data-item-align above) centres the active slide instead, and justify-content:center
  // would wrongly centre the overflow (shoving the first slide off-screen left), so it's cleared.
  // Re-evaluated on reInit (a resize can flip fits ↔ overflows).
  var itemAlign = attr('data-item-align', '');
  function applyItemAlign() {
    if (!itemAlign) return;
    var fits = !embla.canScrollNext() && !embla.canScrollPrev();
    container.style.justifyContent = fits ? (itemAlign === 'end' ? 'flex-end' : itemAlign === 'center' ? 'center' : 'flex-start') : '';
  }
  buildDots();
  applyItemAlign();
  embla
    .on('select', sync)
    .on('settle', pruneActive)
    .on('reInit', function () {
      buildDots();
      applyItemAlign();
      sync();
      pruneActive();
    });
  sync();
  pruneActive();

  root.addEventListener('keydown', function (e) {
    // Don't hijack arrow keys from slide content that consumes them natively
    // (text inputs, selects, contenteditable regions authored inside slides).
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      embla.scrollPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      embla.scrollNext();
    }
  });

  root.setAttribute('data-sw-enhanced', 'true');
}

function init() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="carousel"]'), enhance);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
