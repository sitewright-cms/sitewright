// Lightbox runtime ENTRY — bundled by scripts/gen-vendor.mjs into src/vendor/lightbox-runtime.ts.
// GLightbox (MIT) + first-party wiring. The authored contract stays the progressive-enhancement
// anchor grid: each [data-sw-part="item"] is <a href="full-image"><img thumbnail></a> — with no
// JS a click opens the image directly; with JS each component root becomes its own GALLERY
// (prev/next cycle within that root; multiple roots on a page stay independent).
//
// GLightbox handles touch swipe, pinch-zoom, keyboard (Esc/arrows) and Tab-cycling between its
// buttons. The wiring adds dialog semantics + focus restore (its own a11y stops short of those).
import GLightbox from 'glightbox';

// Lucide glyphs (x / chevron-left / chevron-right) replace GLightbox's stock icons; the
// component CSS restores stroke rendering (the "clean" skin fills paths by default).
var SVG = {
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  prev:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  next:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
};

function enhance(root) {
  if (root.getAttribute('data-sw-enhanced') === 'true') return;
  var items = Array.prototype.slice.call(root.querySelectorAll('[data-sw-part="item"]'));
  if (!items.length) return;

  var attr = function (name, fallback) {
    var v = root.getAttribute(name);
    return v === null || v === '' ? fallback : v;
  };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var openEffect = reduce ? 'none' : attr('data-effect', 'zoom');
  var slideEffect = reduce ? 'none' : attr('data-slide-effect', 'slide');

  var elements = items.map(function (a) {
    var img = a.querySelector('img');
    return {
      href: a.getAttribute('href'),
      type: 'image',
      alt: (img && img.getAttribute('alt')) || '',
      description: a.getAttribute('data-caption') || '',
    };
  });

  var gl = GLightbox({
    elements: elements,
    loop: attr('data-loop', '') === 'true',
    openEffect: openEffect,
    closeEffect: openEffect,
    slideEffect: slideEffect,
    touchNavigation: true,
    keyboardNavigation: true,
    preload: true,
    svg: SVG,
  });

  // a11y shim: dialog semantics on open, focus lands on Close, and focus RETURNS to the
  // triggering thumbnail on close (GLightbox only Tab-cycles its own buttons).
  var lastFocus = null;
  gl.on('open', function () {
    var overlay = document.querySelector('.glightbox-container');
    if (!overlay) return;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Image viewer');
    var close = overlay.querySelector('.gclose');
    if (close) close.focus();
  });
  gl.on('close', function () {
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  });

  items.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      lastFocus = a;
      gl.openAt(i);
    });
  });

  root.setAttribute('data-sw-enhanced', 'true');
}

function init() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="lightbox"]'), enhance);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
