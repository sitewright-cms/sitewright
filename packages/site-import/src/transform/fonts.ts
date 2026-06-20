// Parse `@font-face` rules out of the imported CSS so the web fonts can be self-hosted (and the rule's
// url() rewritten to the hosted ref). Operates on the already-collected CSS whose url()s are absolute
// (collectCssRefs), so the returned refs key + merge into the same host pass as images — buildPageStyles'
// url rewrite then swaps the @font-face url() to the hosted file automatically. Pure + regex-based (no
// CSS engine): tolerant of real-world CSS, conservative on anything it can't confidently read.
import { assetKey } from '../url-util.js';
import type { CapturedAsset } from '../types.js';

// One `@font-face { … }` block. `[^{}]` keeps it flat (no nested braces in a face) → no ReDoS.
const FACE_RE = /@font-face\s*\{([^{}]*)\}/gi;
const FAMILY_RE = /font-family\s*:\s*(['"]?)([^'";]+)\1/i;
const WEIGHT_RE = /font-weight\s*:\s*([^;]+)/i;
const STYLE_RE = /font-style\s*:\s*([^;]+)/i;
// Each `url(...)` in the src, with an optional `format('woff2')` hint right after.
const SRC_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/gi;
const FONT_EXT = /\.(woff2|woff|ttf|otf)(?:[?#]|$)/i;
const FORMAT_RANK: Record<string, number> = { woff2: 4, woff: 3, ttf: 2, otf: 1 };

function parseWeight(raw: string | undefined): number {
  if (!raw) return 400;
  const t = raw.trim().toLowerCase();
  if (t === 'bold') return 700;
  if (t === 'normal') return 400;
  const n = parseInt(t, 10); // "100 900" range → take the first number
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 400;
}

/** Rank a font src candidate (a url + optional format hint) — prefer woff2 > woff > ttf > otf. */
function rank(url: string, formatHint?: string): number {
  const ext = FONT_EXT.exec(url)?.[1]?.toLowerCase();
  return (ext && FORMAT_RANK[ext]) || (formatHint && FORMAT_RANK[formatHint.toLowerCase().replace('truetype', 'ttf').replace('opentype', 'otf')]) || 0;
}

/**
 * Collect the best self-hostable font file per `@font-face` rule, keyed (like images) by canonical
 * asset key, with parsed family/weight/style for createFontAsset. url()s are expected absolute.
 */
export function collectFontFaces(cssText: string): Map<string, CapturedAsset> {
  const refs = new Map<string, CapturedAsset>();
  for (const face of cssText.matchAll(FACE_RE)) {
    const block = face[1] ?? '';
    const family = FAMILY_RE.exec(block)?.[2]?.trim();
    if (!family) continue;
    const weight = parseWeight(WEIGHT_RE.exec(block)?.[1]);
    const style = /italic|oblique/i.test(STYLE_RE.exec(block)?.[1] ?? '') ? 'italic' : 'normal';
    // Pick the single best-format url() in this rule's src.
    let best: { url: string; score: number } | undefined;
    for (const m of block.matchAll(SRC_URL_RE)) {
      const url = m[2]?.trim();
      if (!url || !/^https?:\/\//i.test(url) || !FONT_EXT.test(url)) continue; // absolute font files only
      const score = rank(url, m[3]);
      if (!best || score > best.score) best = { url, score };
    }
    if (!best) continue;
    const key = assetKey(best.url, best.url);
    if (!key || refs.has(key)) continue;
    refs.set(key, { sourceRef: key, kind: 'font', remoteUrl: best.url, font: { family, weight, style } });
  }
  return refs;
}
