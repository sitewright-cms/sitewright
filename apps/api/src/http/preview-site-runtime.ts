/**
 * The preview-site PARENT-BRIDGE runtime, injected inline into every page of the live
 * draft build (see `buildSite`'s `previewRuntime` option). A preview page renders inside a
 * sandboxed, opaque-origin iframe owned by the editor's same-origin SitePreview shell, and
 * this is the only first-party script in that frame.
 *
 * On load it reports the iframe's current route to the parent shell so the shell can:
 *   - know WHICH page is shown (to reload the right page when content changes), and
 *   - reflect the page title.
 *
 * It posts with targetOrigin `*` (the opaque sandbox has no usable origin to target); the
 * parent validates `event.source === iframe.contentWindow` before trusting the message. The
 * payload is LOCATION METADATA ONLY — no rendered content ever crosses the frame boundary.
 *
 * Internal navigation needs no JS here: the build emits page-relative links, so clicking one
 * navigates the iframe naturally and this script re-reports the new location on the next load.
 */
export const PREVIEW_SITE_RUNTIME_JS = `(function () {
  // PREVIEW-only: the page scrolls on <body> (the renderer sets html{overflow:hidden} body{overflow:auto}),
  // because Chrome renders a sandboxed sub-frame's VIEWPORT scrollbar as an auto-hiding overlay — so the
  // brand ::-webkit-scrollbar never shows there. A non-root scroll container's scrollbar IS classic +
  // styled, giving the preview a real, visible scrollbar like the published tab. Bridge window scroll →
  // the body so scroll-linked page JS (back-to-top, parallax, scrollTo, anchor jumps, AOS) keeps working.
  function bridgeScroll() {
    var b = document.body;
    // Self-guard: only bridge when the body is ACTUALLY the scroll container (the renderer's
    // previewScroll CSS is in effect). If the viewport still scrolls, leave the native scroll APIs
    // alone — so this never silently zeroes window.scrollY when the body-scroll CSS isn't present.
    try { if (getComputedStyle(b).overflowY !== 'auto') return; } catch (e) { return; }
    try {
      Object.defineProperty(window, 'scrollY', { configurable: true, get: function () { return b.scrollTop; } });
      Object.defineProperty(window, 'pageYOffset', { configurable: true, get: function () { return b.scrollTop; } });
      Object.defineProperty(window, 'scrollX', { configurable: true, get: function () { return b.scrollLeft; } });
      Object.defineProperty(window, 'pageXOffset', { configurable: true, get: function () { return b.scrollLeft; } });
    } catch (e) { /* non-configurable in this engine: leave the native accessors */ }
    window.scrollTo = function (a, y) {
      if (a && typeof a === 'object') { b.scrollTop = a.top || 0; b.scrollLeft = a.left || 0; }
      else { b.scrollLeft = +a || 0; b.scrollTop = +y || 0; }
    };
    window.scrollBy = function (a, y) {
      if (a && typeof a === 'object') { b.scrollTop += a.top || 0; b.scrollLeft += a.left || 0; }
      else { b.scrollLeft += +a || 0; b.scrollTop += +y || 0; }
    };
    b.addEventListener('scroll', function () { window.dispatchEvent(new Event('scroll')); }, { passive: true });
  }
  function report() {
    try {
      parent.postMessage(
        { source: 'sitewright-preview-site', type: 'location', path: location.pathname, title: document.title },
        '*',
      );
    } catch (e) {
      /* parent gone or cross-origin-blocked: the page still renders, just without auto-tracking */
    }
  }
  function init() { bridgeScroll(); report(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;
