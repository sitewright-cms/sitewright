// Navigation-placeholder rendering + client runtime.
//
// A `kind:'link'` placeholder's NAME is rich (basic HTML + `{{sw-icon}}`/`{{sw-flag}}`). `decorateNav`
// renders each nav item's label into a ready-to-emit `labelHtml`, which the `{{sw-label}}` Handlebars
// helper (see template.ts) outputs as a SafeString — so templates avoid the forbidden `{{{` triple-
// stache. A rich label goes through the SAME validated engine as a page/slot (`renderTemplate`, which
// rejects scripts/handlers/`{{{`); a plain PAGE title is escaped (never treated as a template).
//
// The runtime opens a `<dialog>` when an in-page `#id` link targets one (a "global modal" placeholder)
// and smooth-scrolls to a `#section` otherwise — so anchors/modals work from a plain `<a href="#id">`.
import { walk } from '@sitewright/core';
import type { PageNode } from '@sitewright/schema';
import { escapeHtml } from './escape.js';
import { renderTemplate } from './template.js';

/** Matches a native `<dialog>` OPENING tag (`<dialog`, `<dialog …`, `<dialog/`) — not `</dialog>`. */
const DIALOG_RE = /<dialog[\s/>]/i;

/**
 * Whether an authored HTML/source string embeds a native `<dialog>` — a "global modal" the
 * {@link NAV_LINK_JS} runtime opens via `showModal()` from a matching `a[href="#id"]`. Used (next to
 * the nav-placeholder `#`-target check) to ship the runtime for code-first page sources / skeleton
 * slots / snippets, so a modal triggered from page CONTENT — not only a nav placeholder — opens.
 */
export function usesDialog(html: string | null | undefined): boolean {
  return typeof html === 'string' && DIALOG_RE.test(html);
}

/** Whether a block tree embeds a `<dialog>` in any raw-Html node's props (legacy block-tree pages). */
export function treeUsesDialog(root: PageNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found || !node.props) return;
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && DIALOG_RE.test(value)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

/** The minimal label-bearing shape `decorateNav` reads/writes (a structural view of core's NavItem). */
interface NavItemLike {
  label?: string;
  rich?: boolean;
  labelHtml?: string;
  children?: NavItemLike[];
}

/** Render one item's label: a rich placeholder name via the validated engine, a page title escaped. */
function renderLabel(item: NavItemLike): string {
  const label = typeof item.label === 'string' ? item.label : '';
  if (!item.rich) return escapeHtml(label);
  // Rich label: run it through the same validated template engine as a slot/source (icon helpers
  // resolve; scripts/handlers/`{{{` are rejected). On any validation/render error, fall back to the
  // escaped plain text so a bad label never breaks the whole nav.
  try {
    return renderTemplate(label, {});
  } catch {
    return escapeHtml(label);
  }
}

/**
 * Populates each nav item's `labelHtml` (recursively), IN PLACE, then returns the same object. The
 * nav arrays here are freshly built by `buildNav` (not shared state), so the in-place write is safe
 * and keeps the caller's `{header,footer,mobile}` type intact. Call once on the assembled nav before
 * it enters the render context (publish + preview); the `{{sw-label}}` helper emits `labelHtml`.
 */
export function decorateNav<T extends Record<string, NavItemLike[]>>(nav: T): T {
  // Cache by (rich, label) so the same label string isn't re-validated/re-rendered across slots
  // (header/footer/mobile commonly repeat items) within one call.
  const cache = new Map<string, string>();
  const render = (it: NavItemLike): string => {
    const key = `${it.rich ? '1' : '0'}:${it.label ?? ''}`;
    let html = cache.get(key);
    if (html === undefined) {
      html = renderLabel(it);
      cache.set(key, html);
    }
    return html;
  };
  const walk = (items: NavItemLike[]): void => {
    for (const it of items) {
      it.labelHtml = render(it);
      if (it.children) walk(it.children);
    }
  };
  for (const items of Object.values(nav)) walk(items);
  return nav;
}

/**
 * Client runtime for nav-placeholder targets. On an in-page `#id` link click: opens a matching
 * `<dialog>` as a modal (a "global modal" placeholder), else smooth-scrolls to that section.
 * Honors `prefers-reduced-motion`, closes a modal on backdrop click (Escape is native), and on
 * load honors a `#hash` (open/scroll). Shipped only when a published link placeholder has a `#`
 * target. Self-contained IIFE, mirroring RIPPLE_JS / ANIMATION_JS.
 */
export const NAV_LINK_JS = `(function(){
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(id){ try { return document.getElementById(decodeURIComponent(id)); } catch(e){ return document.getElementById(id); } }
  function go(frag){
    if (!frag || frag.charAt(0) !== '#' || frag.length < 2) return false;
    var t = el(frag.slice(1));
    if (!t) return false;
    if (t.tagName === 'DIALOG') { if (typeof t.showModal === 'function' && !t.open) t.showModal(); return true; }
    t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    return true;
  }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var i = href.indexOf('#');
    if (i < 0) return;
    if (i > 0) {
      var path = href.slice(0, i).replace(/\\/$/, '');
      var here = location.pathname.replace(/\\/$/, '');
      if (path !== here && path !== '.' && path !== './') return;
    }
    if (go(href.slice(i))) e.preventDefault();
  });
  document.addEventListener('click', function(e){
    var d = e.target;
    if (d && d.tagName === 'DIALOG' && d.open) {
      var r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }
  });
  if (location.hash) setTimeout(function(){ go(location.hash); }, 0);
})();`;
