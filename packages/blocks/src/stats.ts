/**
 * BUILT-IN STATISTICS — the page's half: one cookieless beacon per pageview.
 *
 * Published only when the site has `website.statistics.enabled` on, and never into the draft preview. It
 * reads nothing from and writes nothing to the visitor's device (no cookie, no storage), and it sends:
 *
 *   - `r`/`k` — the page's own route and the publisher's signature for it. The collector counts a page only
 *     when the signature matches, so a stranger posting to the endpoint cannot invent pages;
 *   - `h` — the host the page is running on, so a copy of the site on another host (or a page opened from a
 *     file) is not counted as a visit;
 *   - `f` — the referring HOST, when the visit came from another site (never the path or query);
 *   - `u` — a campaign name from `utm_source` / `ref`, when the link carried one;
 *   - `m`/`t`/`w` — the browser's own mobile hint, a touch screen, and the automation flag
 *     (`navigator.webdriver`), which the collector uses to tell devices and headless browsers apart.
 *
 * The beacon goes as `text/plain`, which needs no CORS preflight, so it costs one request. A page that is being
 * PRERENDERED is counted only when the visitor actually opens it.
 *
 * Like the form endpoint (see formApiScript in render.ts), the collector address is not written into the
 * markup as a ready-to-POST URL: the tag carries base64 parts, and the address is assembled here.
 */
import { escapeAttr } from './escape.js';

/** The tracker's file name under the site's platform-script directory. */
export const STATS_SCRIPT = 'stats.js';

// ES5 + URL/URLSearchParams, kept as a string like the other runtimes; minified at publish. NO backticks
// inside (they would close this template literal).
export const STATS_JS = `(function(){
  'use strict';
  var el = document.currentScript;
  var n = navigator;
  if (!el || !n.sendBeacon) return;
  var c;
  try { c = JSON.parse(atob(el.getAttribute('data-sw-stats') || '')); } catch (e) { return; }
  if (!c || typeof c.p !== 'string' || typeof c.r !== 'string' || typeof c.k !== 'string') return;
  var url = (c.b || '') + '/' + 'a' + '/' + c.p;
  function send(){
    var d = { r: c.r, k: c.k, h: location.hostname };
    try {
      if (document.referrer) {
        var h = new URL(document.referrer).hostname;
        if (h && h !== location.hostname) d.f = h;
      }
    } catch (e) {}
    try {
      var q = new URLSearchParams(location.search);
      var u = q.get('utm_source') || q.get('ref');
      if (u) d.u = u.slice(0, 64);
    } catch (e) {}
    if (n.userAgentData && n.userAgentData.mobile) d.m = 1;
    if (n.maxTouchPoints > 1) d.t = 1;
    if (n.webdriver) d.w = 1;
    try { n.sendBeacon(url, JSON.stringify(d)); } catch (e) {}
  }
  if (document.prerendering) document.addEventListener('prerenderingchange', send, { once: true });
  else send();
})();`;

export interface StatsTagOptions {
  /** The tracker's URL, relative to the page (with its `?v=` cache-buster). */
  src: string;
  /** The platform's public base URL, or '' for a same-origin collector. */
  base: string;
  /** The project id — the collector's site key. */
  project: string;
  /** The page's route as served, e.g. `/` or `/de/about/`. */
  route: string;
  /** The publisher's signature for `route` (see the collector). */
  token: string;
}

/** The `<script>` tag that loads the tracker on one page. */
export function statsScriptTag(o: StatsTagOptions): string {
  const payload = Buffer.from(
    JSON.stringify({ b: o.base.replace(/\/+$/, ''), p: o.project, r: o.route, k: o.token }),
    'utf8',
  ).toString('base64');
  return `<script defer src="${escapeAttr(o.src)}" data-sw-stats="${payload}"></script>`;
}
