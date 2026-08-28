// NAV ACTIVE-ON-CLICK — move the `.active` highlight to the nav link the visitor just clicked, at
// CLICK time, instead of leaving the old link lit until the next document has loaded and rendered its
// own server-side `{{sw-active}}` highlight. On a slow connection that gap is the whole perceived
// latency of the click: the visitor taps "Services", nothing in the nav acknowledges it, and the only
// feedback is the browser's own spinner. This runtime closes it — the server render still OWNS the
// final state (it repaints on load), this only fills the interval.
//
// SCOPE — a link inside a `.menu` (the daisyUI menu the platform's nav chrome, the nav-effect schemes
// and scrollspy all key on). That is deliberately narrower than "every link in `#main-nav`": the brand
// mark and the header CTA button live in the nav landmark too, and neither is a menu item — lighting
// them `.active` would style a button as a selected route. A nav authored without a `.menu` class
// simply keeps the old behaviour (no runtime ships for it at all — see {@link usesNavMenu}).
//
// ONLY REAL NAVIGATION — the click must be one that actually LEAVES this page. The guard chain is the
// same one the preloader's internal-link bridge uses (preloader.ts), deliberately, so the two runtimes
// can never disagree about what "leaving" means: primary button, no modifier keys, no `download` /
// `target` / `rel="external"`, resolves to this origin, and lands somewhere other than the current
// path+search. That last clause is what excludes ANCHORS: an in-page `#section` link does not navigate,
// and its highlight belongs to the scrollspy runtime, which tracks the section actually in view.
//
// Invariants (shared with the other runtimes):
//   • Static, first-party, audited code; no tenant string reaches it. It never calls preventDefault —
//     the navigation proceeds exactly as it would without JS.
//   • No-JS → the link still works and still highlights, just on arrival instead of on click
//     (graceful degradation; this is a latency-perception nicety, never a correctness dependency).
//   • Moves the `.active` CLASS and nothing else. `aria-current` is deliberately LEFT ALONE: it states
//     which page the visitor is on, and during a click they are still on the old one. Claiming the new
//     page before it loads would tell a screen-reader user they had arrived somewhere they had not —
//     the same false-location bug the visual state avoids by being obviously transient. So the class
//     is the feedback and the attribute stays the truth, and they re-converge on the next render.
//
// Everything is addressed through ONE selector — the links that currently carry the highlight — never
// "every link in the nav". A 30-item mega menu has one lit link, so both the clear and the undo visit
// exactly that one element. It also makes nested menus a non-issue: a dropdown `.menu` inside a bar
// `.menu` lists its links twice under a per-scope walk, which is what forced an explicit
// de-duplication pass in an earlier revision of this file.

/**
 * Matches a `class` attribute containing a `menu` token — the marker for "this surface has a platform
 * nav menu", so the runtime ships only where it can do something ({@link NAV_ACTIVE_JS} is a no-op
 * without a `.menu`). Scans SOURCE as well as rendered HTML: the class is authored literally in the
 * nav slot / snippet markup, so the publish-side source scan sees it exactly as the preview's
 * rendered-HTML scan does.
 *
 * Word-boundary matching over-matches slightly (`mega-menu` counts, `menu-horizontal` counts twice) —
 * chosen on purpose: the failure mode is shipping under a kilobyte to a page that had no menu, never a
 * nav that silently lost its click highlight.
 */
const MENU_CLASS_RE = /class\s*=\s*(?:"[^"]*\bmenu\b|'[^']*\bmenu\b)/i;

/**
 * Whether a rendered HTML / authored source string contains a platform nav menu (a `class` with a
 * `menu` token), gating the {@link NAV_ACTIVE_JS} runtime for both publish (source scan) and the
 * editor preview (rendered-HTML scan).
 */
export function usesNavMenu(html: string | null | undefined): boolean {
  return typeof html === 'string' && MENU_CLASS_RE.test(html);
}

/** The nav active-on-click runtime, linked per page (publish) or inlined in the preview. */
export const NAV_ACTIVE_JS = `(function(){
  'use strict';
  // What we changed, so a Back can change it straight back: the links we un-lit (querySelectorAll
  // returns a STATIC list, so it IS the record — nothing to copy out) and the one we lit.
  var dimmed=null,lit=null;
  document.addEventListener('click',function(e){
    var t=e.target;
    if(!t||!t.closest)return;
    var a=t.closest('a[href]');
    if(!a||!a.closest('.menu'))return; // brand mark, header CTA, in-content link — not a menu item
    // Does this click LEAVE the page? Mirrors the preloader's internal-link test exactly.
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var href=a.getAttribute('href');
    if(!href||a.hasAttribute('download'))return;
    if(a.target&&a.target!=='_self')return;
    if(/\\bexternal\\b/.test(a.getAttribute('rel')||''))return;
    var url;
    try{url=new URL(href,location.href);}catch(_){return;}
    if(url.origin!==location.origin)return; // external site, mailto:, tel:, etc.
    if(url.pathname===location.pathname&&url.search===location.search)return; // in-page #anchor
    // Clear across every menu on the page: the same route is usually listed in the desktop bar, the
    // mobile drawer and the footer, and a highlight left behind in one of them is the stale state.
    dimmed=document.querySelectorAll('.menu a.active');
    Array.prototype.forEach.call(dimmed,function(l){l.classList.remove('active');});
    a.classList.add('active');
    lit=a;
  },true); // CAPTURE: the preloader bridge cancels these same clicks on the way up, and script ORDER
           // must not decide whether the highlight moves. Safe to run first — this never cancels.
  // A bfcache Back replays the DOM exactly as we left it, with the highlight on the link that took the
  // visitor AWAY — a nav pointing at a page they are no longer on. Undo, in the order we did it.
  window.addEventListener('pageshow',function(e){
    if(!e.persisted||!lit)return;
    lit.classList.remove('active');
    Array.prototype.forEach.call(dimmed,function(l){l.classList.add('active');});
    lit=null;
  });
})();`;
