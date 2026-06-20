// Collect the source site's CSS (inline <style> blocks + captured stylesheet assets) and emit its FULL
// content as ONE `<style>` block to inline at the top of each imported page's source — the accurate-
// replica path (the page renders in rawFidelity, so the platform's own base CSS doesn't fight it).
// url()s are resolved to absolute during collection (per the block's base) so the referenced images +
// @font-face fonts join the host pass; buildPageStyles then rewrites them to the self-hosted `/media`
// refs. `@import` is stripped (no chain-loading) and `</style`/`{{`/`<script` are neutralized so the
// literal `<style>` passes validateTemplate + the bundle's no-scripts scan.
import { allByName, type Document } from '../dom.js';
import { textContent } from 'domutils';
import { assetKey, resolveUrl } from '../url-util.js';
import type { CapturedAsset, CapturedSite } from '../types.js';

export interface CssCollection {
  /** Concatenated, deduped CSS with every `url()` resolved to an absolute URL. */
  cssText: string;
  /** Image refs discovered in `url()`s, keyed canonically — to merge into the host pass. */
  imageRefs: Map<string, CapturedAsset>;
}

const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|tiff?)(?:[?#]|$)/i;
const utf8 = new TextDecoder('utf-8');

/** Strip comments + `@import` (no external stylesheet chain-loading) + collapse whitespace. */
function lightMinify(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import\b[^;]*(?:;|$)/gi, '') // no external stylesheet chain-loading (incl. a no-semicolon tail)
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/** A `</style` breakout would escape the inline `<style>`/criticalCss slot — neutralize it. */
function stripStyleClose(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

/**
 * Resolve a CSS block's `url()`s to absolute against `base`; collect the IMAGE ones for hosting (they're
 * rewritten to /media refs in buildPageStyles). Non-image url()s are left absolute here; @font-face fonts
 * are self-hosted separately (collectFontFaces → the host pass), and any url() that still isn't hosted
 * stays an absolute https hotlink to the source server.
 */
function resolveBlockUrls(css: string, base: string, imageRefs: Map<string, CapturedAsset>, site: CapturedSite): string {
  return css.replace(URL_RE, (whole, _q: string, raw: string) => {
    const r = raw.trim();
    if (r === '' || /^data:/i.test(r) || r.startsWith('#')) return whole; // inline data / fragment refs
    const abs = resolveUrl(r, base);
    if (!abs || !/^https?:\/\//i.test(abs)) return whole;
    let pathname: string;
    try {
      pathname = new URL(abs).pathname;
    } catch {
      return whole;
    }
    if (IMAGE_EXT.test(pathname)) {
      const key = assetKey(abs, base);
      if (key && !imageRefs.has(key)) imageRefs.set(key, site.assets.get(key) ?? { sourceRef: key, kind: 'image', remoteUrl: key });
    }
    return `url('${abs}')`;
  });
}

/** Gather + dedupe all CSS, resolving url()s to absolute and collecting their image refs. */
export function collectCssRefs(pages: { url: string; doc: Document }[], site: CapturedSite): CssCollection {
  const blocks: string[] = [];
  const seen = new Set<string>();
  const imageRefs = new Map<string, CapturedAsset>();
  const add = (raw: string, base: string): void => {
    const css = raw.trim();
    if (!css) return;
    const resolved = resolveBlockUrls(css, base, imageRefs, site);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    blocks.push(resolved);
  };
  for (const { url, doc } of pages) {
    for (const style of allByName(doc.children, 'style')) add(textContent([style]), url);
  }
  for (const asset of site.assets.values()) {
    if (asset.kind === 'css' && asset.bytes) add(utf8.decode(asset.bytes), asset.sourceRef);
  }
  return { cssText: blocks.join('\n'), imageRefs };
}

/** Rewrite absolute url()s to their hosted /media refs (keep an https hotlink / data: on a miss). */
function rewriteCssUrls(cssText: string, assetMap: ReadonlyMap<string, string>): string {
  return cssText.replace(URL_RE, (whole, _q: string, raw: string) => {
    const r = raw.trim();
    if (/^data:/i.test(r)) return whole;
    // r is absolute for http(s) image refs (resolved during collection); assetKey returns null for
    // anything else (relative font refs, etc.) → a safe miss that leaves the url() untouched.
    const key = assetKey(r, r);
    const ref = key ? assetMap.get(key) : undefined;
    return ref ? `url('${ref}')` : whole;
  });
}

/**
 * Build the FULL imported stylesheet as a single `<style>` block to inline at the top of an imported
 * page's `source` — the accurate-replica path. The page `source` slot is uncapped (vs. the tiny
 * criticalCss/head website slots), so the site's complete CSS is preserved instead of dropped. url()s
 * are rewritten to the self-hosted refs; `</style` is neutralized (no breakout); stray `{{`/`}}` is
 * zero-width-split so the literal `<style>` passes `validateTemplate` (CSS rarely contains them). The
 * page renders in `rawFidelity` mode so the platform's own base CSS doesn't fight this stylesheet.
 * Returns '' when there is no CSS.
 */
export function buildPageStyles(cssText: string, assetMap: ReadonlyMap<string, string>): string {
  if (cssText.trim() === '') return '';
  const css = stripStyleClose(lightMinify(rewriteCssUrls(cssText, assetMap)));
  if (css === '') return '';
  const safe = css
    // `{{`/`}}` would start a Handlebars expression inside the rawtext <style> → split with U+200B.
    .replace(/\{\{/g, '{​{')
    .replace(/\}\}/g, '}​}')
    // A literal `<script` in CSS string content (e.g. `content:"<script>"`) would trip the bundle's
    // assertNoScripts string scan → split it (invisible U+200B; renders identically).
    .replace(/<(\/?script)/gi, '<​$1');
  return `<style>${safe}</style>`;
}
