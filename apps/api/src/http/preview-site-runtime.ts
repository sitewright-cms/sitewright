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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', report);
  } else {
    report();
  }
})();`;
