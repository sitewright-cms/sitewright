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
  if (prev) prev.addEventListener('click', function () { embla.scrollPrev(); });
  if (next) next.addEventListener('click', function () { embla.scrollNext(); });

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
    if (!loop) {
      if (prev) prev.disabled = !embla.canScrollPrev();
      if (next) next.disabled = !embla.canScrollNext();
    }
  }
  buildDots();
  embla.on('select', sync).on('reInit', function () {
    buildDots();
    sync();
  });
  sync();

  root.addEventListener('keydown', function (e) {
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
