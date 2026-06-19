// Collect the source site's CSS (inline <style> blocks + captured stylesheet assets) and pack it into
// the bounded raw slots — `criticalCss` first (≤10 KB), overflow into a `<style>` in the raw `head`
// slot (≤20 KB). This is "faithful-but-bounded": pixel-perfect CSS is NOT a goal; the AI rewrite stage
// re-expresses styling as Tailwind. NEVER emits anything but CSS into the raw slots (no scripts).
import { allByName, type Document } from '../dom.js';
import { textContent } from 'domutils';
import type { CapturedSite, ImportLimits } from '../types.js';

export interface CollectedCss {
  criticalCss?: string;
  headStyle?: string;
  overflow: boolean;
}

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

const utf8 = new TextDecoder('utf-8');

export function collectCss(docs: Document[], site: CapturedSite, limits: ImportLimits): CollectedCss {
  const blocks: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const css = raw.trim();
    if (!css || seen.has(css)) return;
    seen.add(css);
    blocks.push(css);
  };

  for (const doc of docs) {
    for (const style of allByName(doc.children, 'style')) push(textContent([style]));
  }
  for (const asset of site.assets.values()) {
    if (asset.kind === 'css' && asset.bytes) push(utf8.decode(asset.bytes));
  }

  if (blocks.length === 0) return { overflow: false };

  const all = stripStyleClose(lightMinify(blocks.join('\n')));
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
  // Binary search the character boundary that fits.
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(s.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}
