// Collect the source site's CSS (inline <style> blocks + captured stylesheet assets), self-host the
// images its `url()`s reference, and pack the result into the bounded raw slots — `criticalCss` first
// (≤10 KB), overflow into a `<style>` in the raw `head` slot (≤20 KB). url()s are resolved to absolute
// during collection (per the block's base) so the referenced images join the host pass; packCss then
// rewrites them to the `/media` refs. "Faithful-but-bounded": pixel-perfect CSS is NOT a goal; the AI
// rewrite stage re-expresses styling as Tailwind. NEVER emits anything but CSS into the raw slots.
import { allByName, type Document } from '../dom.js';
import { textContent } from 'domutils';
import { assetKey, resolveUrl } from '../url-util.js';
import type { CapturedAsset, CapturedSite, ImportLimits } from '../types.js';

export interface CollectedCss {
  criticalCss?: string;
  headStyle?: string;
  overflow: boolean;
}

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
    .replace(/@import\b[^;]*;/gi, '')
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
 * rewritten to /media refs in packCss). Non-image http(s) url()s (e.g. @font-face) become absolute
 * hotlinks to the source server — they may CORS-fail; the AI rewrite stage re-derives styling.
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

/** Rewrite absolute url()s to hosted refs (keep https hotlink / data: on a miss), then bound into slots. */
export function packCss(cssText: string, assetMap: ReadonlyMap<string, string>, limits: ImportLimits): CollectedCss {
  if (cssText.trim() === '') return { overflow: false };
  const rewritten = cssText.replace(URL_RE, (whole, _q: string, raw: string) => {
    const r = raw.trim();
    if (/^data:/i.test(r)) return whole;
    // r is absolute for http(s) image refs (resolved during collection); assetKey returns null for
    // anything else (relative font refs, etc.) → a safe miss that leaves the url() untouched.
    const key = assetKey(r, r);
    const ref = key ? assetMap.get(key) : undefined;
    return ref ? `url('${ref}')` : whole;
  });

  const all = stripStyleClose(lightMinify(rewritten));
  if (all === '') return { overflow: false };

  const result: CollectedCss = { overflow: false };
  // Fill criticalCss up to its cap. `sliceBytes` returns a CHARACTER prefix whose UTF-8 length fits, so
  // the subsequent `all.slice(critical.length)` (also character-based) lines up exactly.
  const critical = sliceBytes(all, limits.maxCriticalCssBytes);
  if (critical) result.criticalCss = critical;
  let rest = all.slice(critical.length);
  if (rest) {
    const headBudget = limits.maxHeadCssBytes - '<style></style>'.length;
    const headCss = sliceBytes(rest, Math.max(0, headBudget));
    if (headCss) result.headStyle = `<style>${headCss}</style>`;
    rest = rest.slice(headCss.length);
    if (rest) result.overflow = true;
  }
  return result;
}

/** Take the longest prefix of `s` whose UTF-8 byte length is ≤ `maxBytes`. */
function sliceBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(s.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}
