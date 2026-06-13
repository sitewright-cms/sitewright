// SmartPhoto-backed Lightbox runtime ENTRY — bundled by scripts/gen-vendor.mjs into
// src/vendor/lightbox-smartphoto-runtime.ts. SmartPhoto (MIT) + a-template/morphdom/delegate
// (all MIT) + first-party wiring. The IE-only polyfills SmartPhoto pulls in
// (custom-event-polyfill, es6-promise-polyfill, and ie-array-find-polyfill via a-template)
// are aliased away at bundle time (gen-vendor.mjs `alias`) — the platform targets modern
// browsers only, so CustomEvent / Promise / Array.find are all native.
//
// Authored contract = the same progressive-enhancement anchor grid as the GLightbox impl
// it replaces: each [data-sw-part="item"] is <a href="full-image"><img thumbnail></a>. With
// no JS a click opens the full image directly; with JS each component ROOT becomes its own
// gallery — SmartPhoto supplies the bottom thumbnail strip, the header counter + caption,
// swipe / pinch-zoom / keyboard nav, a per-image loader, and the enlarge-from-thumbnail open
// animation. `href` is the FULL image and the inner <img src> is the THUMBNAIL (they may
// differ); SmartPhoto clones that <img> for the open animation and reuses its source as the
// strip thumbnail, so every item MUST contain an <img>.
//
// One-line minimal forms are also accepted (resolveItems): a bare <img data-sw-component="lightbox"
// src=… data-full=… data-caption=…> is a single-image lightbox, and a <div data-sw-component=
// "lightbox"> whose children are plain <img> or <a href><img> becomes a gallery (bare imgs are
// wrapped in an anchor whose href is data-full || src). The explicit data-sw-part form keeps the
// styled grid + thumbnail defaults; the minimal forms are author-styled.
//
// Options are read from data-* on the root (documented in COMPONENT_CATALOG): data-thumbnails,
// data-arrows, data-animation, data-fit, data-tilt, data-history. data-gallery="name" MERGES
// every lightbox sharing that name (across sections and across the single-line/div forms) into one
// gallery — see init().
import SmartPhoto from 'smartphoto/src/core/index.js';

// Generic, vendor-neutral class names for the runtime-built viewer DOM (override SmartPhoto's
// own "smartphoto-*" defaults so no third-party name leaks into the published markup/CSS). These
// MUST stay in lockstep with the vendored stylesheet: gen-vendor.mjs rewrites "smartphoto" →
// "sw-lightbox" in the CSS (and the one hard-coded "smartphoto-sr-only" template class in the JS),
// so every selector below has a matching rule.
var CLASS_NAMES = {
  smartPhoto: 'sw-lightbox',
  smartPhotoClose: 'sw-lightbox-close',
  smartPhotoBody: 'sw-lightbox-body',
  smartPhotoInner: 'sw-lightbox-inner',
  smartPhotoContent: 'sw-lightbox-content',
  smartPhotoImg: 'sw-lightbox-img',
  smartPhotoImgOnMove: 'sw-lightbox-img-onmove',
  smartPhotoImgElasticMove: 'sw-lightbox-img-elasticmove',
  smartPhotoImgWrap: 'sw-lightbox-img-wrap',
  smartPhotoArrows: 'sw-lightbox-arrows',
  smartPhotoNav: 'sw-lightbox-nav',
  smartPhotoArrowRight: 'sw-lightbox-arrow-right',
  smartPhotoArrowLeft: 'sw-lightbox-arrow-left',
  smartPhotoArrowHideIcon: 'sw-lightbox-arrow-hide',
  smartPhotoImgLeft: 'sw-lightbox-img-left',
  smartPhotoImgRight: 'sw-lightbox-img-right',
  smartPhotoList: 'sw-lightbox-list',
  smartPhotoListOnMove: 'sw-lightbox-list-onmove',
  smartPhotoHeader: 'sw-lightbox-header',
  smartPhotoCount: 'sw-lightbox-count',
  smartPhotoCaption: 'sw-lightbox-caption',
  smartPhotoDismiss: 'sw-lightbox-dismiss',
  smartPhotoLoader: 'sw-lightbox-loader',
  smartPhotoLoaderWrap: 'sw-lightbox-loader-wrap',
  smartPhotoImgClone: 'sw-lightbox-img-clone',
};

// Wrap a bare <img> in the <a href><img> structure SmartPhoto expects — href is the FULL image
// (data-full, else the img's own src), and the caption carries over. No-op if the image is already
// inside a linked anchor.
function wrapImg(img) {
  var parent = img.parentNode;
  if (parent && parent.tagName === 'A' && parent.getAttribute('href')) return parent;
  var a = document.createElement('a');
  a.setAttribute('href', img.getAttribute('data-full') || img.getAttribute('src') || '');
  var cap = img.getAttribute('data-caption');
  if (cap) a.setAttribute('data-caption', cap);
  if (parent) parent.insertBefore(a, img);
  a.appendChild(img);
  return a;
}

// Resolve a root to its gallery item anchors, supporting the explicit AND one-line minimal forms:
//   1. explicit  — [data-sw-part="item"] anchors (full control + the styled grid defaults)
//   2. one image — the root IS an <img> (a single-image lightbox: <img data-sw-component="lightbox">)
//   3. minimal   — every descendant <img> that belongs to THIS root becomes an item, via its
//                  wrapping <a href> if it has one, else a fresh wrapper. Handles a mix of bare
//                  <img> and <a href><img> in one container, and skips images that belong to a
//                  NESTED lightbox (they're enhanced as their own gallery).
function resolveItems(root) {
  var explicit = Array.prototype.slice.call(root.querySelectorAll('[data-sw-part="item"]'));
  if (explicit.length) return explicit;
  if (root.tagName === 'IMG') return [wrapImg(root)];
  var items = [];
  Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
    if (img.closest('[data-sw-component="lightbox"]') !== root) return; // belongs to a nested lightbox
    var anchor = img.closest('a[href]');
    var item = anchor && root.contains(anchor) ? anchor : wrapImg(img);
    if (items.indexOf(item) === -1) items.push(item); // dedupe (an anchor with several imgs = one item)
  });
  return items;
}

// Build ONE SmartPhoto gallery from a bucket of items (possibly merged across several roots that
// share a data-gallery name). Options (data-thumbnails etc.) come from the gallery's optionRoot —
// the first lightbox element that contributed to it.
function enhanceGallery(gallery) {
  var root = gallery.optionRoot;
  var items = gallery.items;

  var attr = function (name, fallback) {
    var v = root.getAttribute(name);
    return v === null || v === '' ? fallback : v;
  };
  // A boolean data-* switch following the HTML convention: present (even bare or "") = true,
  // "false"/"0"/"off" = false, absent = the default.
  var flag = function (name, dflt) {
    var v = root.getAttribute(name);
    if (v === null) return dflt;
    return v !== 'false' && v !== '0' && v !== 'off';
  };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // SmartPhoto accepts a NodeList/array as its element set; one shared data-group across all of the
  // gallery's items makes them a single gallery even when they live in different sections.
  items.forEach(function (a, i) {
    a.setAttribute('data-group', gallery.key);
    if (!a.getAttribute('data-id')) a.setAttribute('data-id', gallery.key + '-' + i);
  });

  var sp = new SmartPhoto(items, {
    classNames: CLASS_NAMES, // vendor-neutral "sw-lightbox-*" classes (see CLASS_NAMES above)
    nav: flag('data-thumbnails', true), // bottom thumbnail strip
    arrows: flag('data-arrows', true),
    showAnimation: reduce ? false : flag('data-animation', true), // enlarge-from-thumbnail open
    useOrientationApi: flag('data-tilt', false), // accelerometer pan — off by default
    useHistoryApi: flag('data-history', false), // OFF: a CMS page shouldn't hijack the URL hash
    resizeStyle: attr('data-fit', 'fit') === 'fill' ? 'fill' : 'fit',
  });
  // Caption is SmartPhoto's data-caption, injected into the viewer at TENANT trust (tenants
  // already author raw HTML) — NEVER bind visitor-submitted content into it.

  // Perf: SmartPhoto's constructor starts a 100Hz inertia-animation interval that it only clears
  // on destroy(); left alone it would run forever on a static page. Gate it to while-OPEN — clear
  // the constructor's interval now (the gallery starts closed), re-arm on each open, clear on close.
  if (sp.interval) {
    window.clearInterval(sp.interval);
    sp.interval = null;
  }

  // a11y shim: SmartPhoto already gives the overlay role="dialog", an aria-live caption,
  // Escape + arrow-key nav, and focuses the caption on open. We add the one thing it lacks —
  // RESTORING focus to the triggering thumbnail on close. (We deliberately do NOT stamp
  // aria-modal: SmartPhoto re-renders its overlay through morphdom, which strips any attribute
  // absent from its template, so a DOM-set aria-modal would not persist — a JS close handler does.)
  // SmartPhoto's on() reads the overlay element, so we arm on the first click tick (defensive: the
  // overlay is built synchronously in the constructor's click handler, but deferring is harmless).
  var lastFocus = null;
  var armed = false;
  function arm() {
    if (armed) return;
    try {
      sp.on('close', function () {
        window.clearInterval(sp.interval); // stop the inertia loop while the gallery is closed
        sp.interval = null;
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
        lastFocus = null;
      });
      armed = true;
    } catch {
      /* overlay not built yet — retried on the next open */
    }
  }
  items.forEach(function (a) {
    a.addEventListener('click', function () {
      lastFocus = a;
      // Re-arm the inertia loop for this open (covers the first open too); cleared again on close.
      if (!sp.interval) sp.interval = window.setInterval(function () { sp._doAnim(); }, 10);
      window.setTimeout(arm, 0);
    });
  });
}

// Collect every lightbox root, resolve its items, and bucket them into galleries: roots that share
// a data-gallery="name" MERGE into one gallery (images grouped across sections and across the
// single-line/div forms); roots without the attribute each get their own. Group order + item order
// follow DOM order; a gallery's options come from the first root that contributed to it.
function init() {
  var galleries = [];
  var byName = Object.create(null); // null-proto: a data-gallery="__proto__"/"constructor" can't alias a built-in
  var seq = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="lightbox"]'), function (root) {
    if (root.getAttribute('data-sw-enhanced') === 'true') return;
    var items = resolveItems(root);
    if (!items.length) return;
    root.setAttribute('data-sw-enhanced', 'true');
    var name = root.getAttribute('data-gallery');
    var gallery;
    if (name) {
      gallery = byName[name];
      if (!gallery) {
        gallery = { key: 'sw-lb-g-' + name, items: [], optionRoot: root };
        byName[name] = gallery;
        galleries.push(gallery);
      }
    } else {
      gallery = { key: 'sw-lb-' + ++seq, items: [], optionRoot: root };
      galleries.push(gallery);
    }
    items.forEach(function (it) {
      gallery.items.push(it);
    });
  });
  galleries.forEach(enhanceGallery);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
