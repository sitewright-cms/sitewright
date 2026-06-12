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

  // Material-style press ripple ("waves" in contentBase terms) — DEFAULT on every control
  // (arrows + dots), and on the slides themselves in click-to-slide mode. A pointer-anchored
  // disc expands and fades; CSS owns the animation, the span removes itself when it ends.
  // Keyboard activation has no pointer position, so it simply doesn't ripple.
  function addRipple(el) {
    el.classList.add('sw-waves');
    el.addEventListener('pointerdown', function (e) {
      if (reduce) return;
      var r = el.getBoundingClientRect();
      var d = Math.max(r.width, r.height) * 2;
      var s = document.createElement('span');
      s.className = 'sw-ripple';
      s.style.width = d + 'px';
      s.style.height = d + 'px';
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
  for (var i = 0; i < slides.length; i++) container.appendChild(slides[i]);
  track.appendChild(container);

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
      align: attr('data-align', 'start'),
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
  // navigation-less pattern. Slides get the press ripple; clicks on interactive elements
  // inside a slide keep their own meaning, and a click that ends a DRAG never fires (the
  // pointer travelled). The root becomes focusable so arrow keys still work with no controls.
  if (attr('data-click-next', '') === 'true') {
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    for (var c = 0; c < slides.length; c++) addRipple(slides[c]);
    var downX = 0;
    var downY = 0;
    track.addEventListener('pointerdown', function (e) { downX = e.clientX; downY = e.clientY; });
    track.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('a,button,input,select,textarea,label,[contenteditable]')) return;
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
  function sync() {
    var sel = embla.selectedScrollSnap();
    for (var i = 0; i < dots.length; i++) {
      dots[i].setAttribute('aria-current', i === sel ? 'true' : 'false');
    }
    // Stamp data-active on the slide(s) in the selected snap (same convention as Tabs
    // panels). This is the CSS styling hook for per-activation effects — caption entrance
    // animations, Ken Burns, etc. — because an attribute flip natively restarts matching
    // keyframes. slideRegistry maps snap → slide indices (a snap covers several slides in
    // multi-item layouts); it's the same internalEngine surface the AutoHeight plugin uses.
    var active = embla.internalEngine().slideRegistry[sel] || [];
    for (var s = 0; s < slides.length; s++) {
      if (active.indexOf(s) !== -1) slides[s].setAttribute('data-active', '');
      else slides[s].removeAttribute('data-active');
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
  buildDots();
  embla.on('select', sync).on('reInit', function () {
    buildDots();
    sync();
  });
  sync();

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
