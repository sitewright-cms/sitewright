// IN-PAGE LINK — the ONE answer to "does this href stay on the current page, and to which fragment?",
// shared as JavaScript SOURCE by every runtime that acts on an in-page link: NAV_LINK_JS (smooth-scroll /
// open a `<dialog>`) and STICKY_HEADER_JS (close the stock mobile drawer). Two hand-kept copies would
// drift, and a drift here is a visible bug — e.g. the page smooth-scrolls to a section while the drawer,
// judging the same link "cross-page", stays open over it.
//
// A bare `#fragment` is in-page. A PATH-PREFIXED anchor (e.g. /#features, /en/#features) is IN-PAGE when
// its path equals the current page, is root-relative-only, OR is a SUFFIX of the current path — so it
// still resolves under the /sites/<slug> (or /preview/<token>) base the editor preview + local hosting
// serve from. A genuine cross-page link (a different page, different last segment) is not. String-based
// on purpose (no `new URL`): it must behave identically on every surface the runtimes run on.
//
// It is a function DECLARATION spliced into each runtime's IIFE (so each keeps its own private copy and
// nothing leaks to the page's global scope). No backticks / `${` / `</script` inside — it is embedded in
// template literals that become inline <script>s.

/**
 * JS source of `inPageFragment(href)`: the `#fragment` (including the `#`) an href jumps to ON THIS PAGE,
 * or `''` when the href has no fragment or leaves the page. A bare `#` comes back as `'#'` — callers
 * decide whether an empty fragment means anything to them.
 */
export const IN_PAGE_FRAGMENT_FN = `function inPageFragment(href){
    var i = href.indexOf('#');
    if (i < 0) return '';
    if (i > 0) {
      var path = href.slice(0, i).replace(/\\/$/, '');
      var here = location.pathname.replace(/\\/$/, '');
      var samePath = path === '' || path === '.' || path === './' || path === here || here.endsWith(path);
      if (!samePath) return '';
    }
    return href.slice(i);
  }`;
