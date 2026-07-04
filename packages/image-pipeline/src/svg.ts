/**
 * SVG sanitization for SELF-HOSTING imported (untrusted) SVG images — PRESERVING the vector (and its
 * animation), never rasterizing. SVG is uniquely dangerous among image formats: it can carry `<script>`,
 * `on*` handlers, and remote references (`<image href="http…">`, external entities, `url(http…)`), so
 * serving a raw foreign SVG would be a stored-XSS + client-side-SSRF/tracking vector.
 *
 * This sanitizer strips the executable + remote-fetching surface while KEEPING everything that makes an
 * SVG worth preserving as an SVG: geometry, gradients/filters/clip-paths (internal `#id` refs), `<style>`
 * + CSS `@keyframes`, and SMIL animation (`<animate>` / `<animateTransform>` / `<set>` …) — so an animated
 * logo stays animated and a vector illustration stays infinitely scalable at a fraction of a raster's bytes.
 *
 * DEFENCE IN DEPTH — this string sanitizer is only ONE of three layers. The stored SVG is (1) referenced
 * from pages via `<img src>`, which browsers render in "secure static mode" (no scripts, no external
 * fetches) BY SPEC; and (2) served by the app/media route with a locked-down response CSP
 * (`script-src 'none'`, `default-src 'none'`) + `X-Content-Type-Options: nosniff`, which browser-enforces
 * no-script / no-external even on DIRECT navigation. So the sanitizer's job is to keep the file clean and
 * self-contained (and to strip tracking pixels) — it is not the sole barrier.
 */

/** Hard input ceiling — a pathologically large SVG string is refused outright. Exported so upload
 *  routes can distinguish "too large" (413) from "not a usable SVG" (400) before calling the store. */
export const MAX_SVG_BYTES = 4 * 1024 * 1024;

/**
 * Sanitize an untrusted SVG for safe self-hosting. Removes:
 *   • `<!DOCTYPE>` / `<!ENTITY>` and dangling custom entity refs — external-entity (XXE / SSRF) vector.
 *   • `<script>` / `<foreignObject>` — script + embedded-HTML vectors.
 *   • `on*=` inline event handlers.
 *   • remote references in `href` / `xlink:href` and CSS `url(…)`: anything that is NOT an internal
 *     `#fragment` or a self-contained `data:` URI is neutralized (http/https/protocol-relative/relative
 *     all reach out). Internal `#id` refs (gradients, filters, clip paths, `<use>`) are KEPT.
 *   • `@import` (external stylesheet) inside `<style>`.
 *   • SMIL animations that target `href`/`xlink:href` (the one way animation could re-introduce a
 *     `javascript:` link) — geometry/transform/opacity animations are untouched.
 *
 * Returns the sanitized SVG string, or `null` if the input is not a usable SVG or exceeds the size
 * ceiling. Never throws.
 */
export function sanitizeSvg(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_SVG_BYTES) return null;
  if (!/<svg[\s>]/i.test(input)) return null;
  let svg = input;
  // XML prolog external DTD + any DOCTYPE (with or without an internal subset) → gone.
  svg = svg.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '');
  // Dangling custom entity REFERENCES (`&xxe;`) — declaration now gone; keep only standard XML/numeric.
  svg = svg.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[a-zA-Z][\w.-]*;/g, '');
  // Script / foreignObject blocks (and any unclosed trailing <script …>), incl. a namespaced <x:script>.
  svg = svg.replace(/<(?:[a-z][\w.-]*:)?script[\s\S]*?<\/(?:[a-z][\w.-]*:)?script\s*>/gi, '');
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  svg = svg.replace(/<(?:[a-z][\w.-]*:)?script\b[^>]*>/gi, '');
  // SMIL animation of href/xlink:href — could animate an <a> to a javascript: target. Drop those
  // animation elements; transform/opacity/geometry animations (the actual motion) are untouched.
  svg = svg.replace(
    /<(?:animate|set|animateTransform|animateMotion|animateColor)\b[^>]*\battributeName\s*=\s*["']?\s*(?:xlink:)?href\b[\s\S]*?(?:\/>|<\/(?:animate|set|animateTransform|animateMotion|animateColor)\s*>)/gi,
    '',
  );
  // Inline event handlers: on…="…" / on…='…' / on…=bare. `\b` (not `\s`) so a no-leading-space
  // `width="10"onclick=…` is also caught; SVG has no legitimate attribute that starts with `on`.
  svg = svg.replace(/\bon[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remote href / xlink:href — keep only #fragment and self-contained RASTER data: URIs (for <image>
  // embeds). A `data:text/html` / `data:image/svg+xml` href is a navigation / recursive-script vector, so
  // ONLY the safe raster image types survive; everything else collapses to `#`.
  svg = svg.replace(/\b(?:xlink:)?href\s*=\s*("|')\s*(?!#|data:image\/(?:png|jpe?g|gif|webp|avif)[;,])[^"']*\1/gi, 'href="#"');
  // Belt to the href pass: neutralize any script URL scheme wherever it appears (unquoted href, a
  // value the quoted pass didn't reach, a CSS/animation value) — no valid SVG contains these.
  svg = svg.replace(/(?:javascript|vbscript|livescript|mocha)\s*:/gi, 'x:');
  // CSS url(...) — keep only internal #refs and safe raster data: URIs (same policy as href).
  svg = svg.replace(/url\(\s*(['"]?)\s*(?!#|data:image\/(?:png|jpe?g|gif|webp|avif)[;,])[^)'"]*\1\s*\)/gi, 'none');
  // @import (external stylesheet) inside <style>.
  svg = svg.replace(/@import\b[^;]*;?/gi, '');
  return svg;
}

/**
 * Parse an SVG's intrinsic pixel size from the ROOT `<svg>` tag: explicit `width`/`height` (px) first,
 * else the `viewBox`'s width/height. `%` sizes are ignored (no intrinsic px). Returns null if neither
 * yields positive numbers. The `[\s"']` lead-in avoids matching `stroke-width` etc. Used to give the
 * stored image record real `width`/`height` (so `<img>` reserves the right box → no layout shift).
 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
  const open = svg.match(/<svg\b[^>]*>/i);
  const tag = open ? open[0] : svg;
  const wm = tag.match(/[\s"']width\s*=\s*["']?\s*([\d.]+)\s*(px)?/i);
  const hm = tag.match(/[\s"']height\s*=\s*["']?\s*([\d.]+)\s*(px)?/i);
  if (wm && hm) {
    const w = Number(wm[1]);
    const h = Number(hm[1]);
    if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) return { width: Math.round(w), height: Math.round(h) };
  }
  const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) {
    const w = Number(vb[1]);
    const h = Number(vb[2]);
    if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) return { width: Math.round(w), height: Math.round(h) };
  }
  return null;
}
