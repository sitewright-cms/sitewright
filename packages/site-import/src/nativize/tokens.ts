// Design-token snapping for the mechanical nativizer: map captured computed-style px/colors onto the
// platform's Tailwind scale + theme tokens, so the output is short, idiomatic and THEME-EDITABLE
// (text-lg / p-4 / bg-primary) instead of arbitrary [19.2px] / [#0b4a77] soup. Tight tolerances keep the
// layout within ~1-2px of the capture; anything off the scale stays an exact arbitrary value. Pure — no
// browser, no I/O — so it runs server-side in the import pipeline and unit-tests directly.

/**
 * The project's brand palette, used to snap captured colors → theme tokens. `colors` is keyed by the RGB
 * triple with spaces stripped (`"11,74,119"` → `"primary"`); build it from the project theme's
 * --sw-color-* values. `fonts` maps a substring of the source's computed font-family → a platform font
 * token (font-heading/body/…), first match wins.
 */
export interface NativizePalette {
  colors: Readonly<Record<string, string>>;
  fonts: ReadonlyArray<readonly [match: string, token: string]>;
}

// Tailwind spacing scale (px) ↔ token. Kept in lockstep so `nearest` can snap a captured px to the token.
const SPX = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 384];
const STOK: Readonly<Record<number, string>> = { 0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5', 12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8', 36: '9', 40: '10', 44: '11', 48: '12', 56: '14', 64: '16', 80: '20', 96: '24', 112: '28', 128: '32', 144: '36', 160: '40', 176: '44', 192: '48', 208: '52', 224: '56', 240: '60', 256: '64', 288: '72', 320: '80', 384: '96' };
const FPX: Readonly<Record<number, string>> = { 12: 'text-xs', 14: 'text-sm', 16: 'text-base', 18: 'text-lg', 20: 'text-xl', 24: 'text-2xl', 30: 'text-3xl', 36: 'text-4xl', 48: 'text-5xl', 60: 'text-6xl', 72: 'text-7xl', 96: 'text-8xl', 128: 'text-9xl' };
const RPX: Readonly<Record<number, string>> = { 0: 'rounded-none', 2: 'rounded-sm', 4: 'rounded', 6: 'rounded-md', 8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl' };

const nearest = (px: number, arr: readonly number[]): number => arr.reduce((b, s) => (Math.abs(s - px) < Math.abs(b - px) ? s : b), arr[0]!);

/** A CSS value for a Tailwind arbitrary bracket: spaces → underscores (`1px solid` → `1px_solid`). */
export const arbitrary = (v: string): string => (v || '').replace(/\s+/g, '_');

/** px → spacing-scale token (`"16px"` → `"4"`), or null if off-scale beyond tolerance. The default
 *  tolerance is GENEROUS (≤3px or 18%) so captured values snap to canonical p-4/m-6/gap-8 rather than
 *  staying arbitrary [..] soup — a few px of drift is invisible and the output stays theme-idiomatic. */
export function spaceToken(v: string, tol?: number): string | null {
  const px = parseFloat(v);
  if (Number.isNaN(px)) return null;
  const b = nearest(px, SPX);
  return Math.abs(b - px) <= (tol ?? Math.max(3, px * 0.18)) ? STOK[b]! : null;
}

/** A spacing/size class snapping a captured value to the scale, handling `auto` and NEGATIVES (a captured
 *  `-60px` → `-ml-14`); off-scale → an arbitrary bracket. */
function scaleClass(prefix: string, v: string, tol?: number): string {
  const raw = (v || '').trim();
  if (raw === 'auto') return `${prefix}-auto`;
  const px = parseFloat(raw);
  if (Number.isNaN(px)) return `${prefix}-[${raw}]`;
  const t = spaceToken(String(Math.abs(px)), tol);
  if (t === null) return `${prefix}-[${raw}]`;
  return (px < 0 ? '-' : '') + `${prefix}-${t}`;
}

/** Loose spacing class for padding/margin/gap: `space("p", "16px")` → `"p-4"`; off-scale → `"p-[16.2px]"`. */
export function space(prefix: string, v: string): string {
  return scaleClass(prefix, v);
}

/** Spacing class for w/h/insets/icons. Default tolerance ≤3px or 10% so fixed sizes snap to the scale
 *  (`90px` → `w-24`) instead of staying arbitrary; pass a tighter `tol` where exactness matters. */
export function dim(prefix: string, v: string, tol?: number): string {
  return scaleClass(prefix, v, tol ?? Math.max(3, Math.abs(parseFloat(v) || 0) * 0.1));
}

/** Font-size px → `text-*` token, or an arbitrary `text-[19.2px]` when off-scale. Generous tolerance
 *  (≤2px or 15%) so headings/body snap to text-2xl/text-base instead of arbitrary px. */
export function fontSizeClass(v: string): string {
  const px = parseFloat(v);
  if (Number.isNaN(px)) return `text-[${v}]`;
  const b = nearest(px, Object.keys(FPX).map(Number));
  return Math.abs(b - px) <= Math.max(2, px * 0.15) ? FPX[b]! : `text-[${v}]`;
}

/** Border-radius → `rounded-*`: a `%`/`9999px`/large value → `rounded-full` (a pill/circle); else snap px
 *  to the scale (generous), or an arbitrary value when far off-scale. */
export function radiusClass(v: string): string {
  if (/%/.test(v) && parseFloat(v) >= 50) return 'rounded-full'; // 50%+ radius = circle/pill
  const px = parseFloat(v);
  if (Number.isNaN(px)) return `rounded-[${arbitrary(v)}]`;
  if (px >= 32) return 'rounded-full'; // a big pixel radius is effectively a pill on normal-sized elements
  const b = nearest(px, Object.keys(RPX).map(Number));
  return Math.abs(b - px) <= Math.max(3, px * 0.25) ? RPX[b]! : `rounded-[${arbitrary(v)}]`;
}

// z-index canonical scale (0/10/.../50) — captured 998 / 9 etc. snap to the nearest.
const ZPX = [0, 10, 20, 30, 40, 50];
/** z-index → canonical `z-N` (snaps 998→z-50, 9→z-10); huge values cap at z-50. */
export function zIndexClass(v: string): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return `z-[${v}]`;
  if (n < 0) return `z-[${n}]`; // negative z (decorative layer behind content) must NOT snap to z-0
  if (n >= 45) return 'z-50';
  return `z-${nearest(n, ZPX)}`;
}

/** opacity 0..1 → canonical `opacity-N` (nearest 5%): "0"→opacity-0, "0.5"→opacity-50. */
export function opacityClass(v: string): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return `opacity-[${v}]`;
  return `opacity-${Math.round((n * 100) / 5) * 5}`;
}

const LEAD: ReadonlyArray<readonly [number, string]> = [[1, 'leading-none'], [1.25, 'leading-tight'], [1.375, 'leading-snug'], [1.5, 'leading-normal'], [1.625, 'leading-relaxed'], [2, 'leading-loose']];
// Tailwind fixed-px leading scale (leading-3 .. leading-10 = 12 .. 40px) for a px line-height we can't ratio.
const LEAD_PX: ReadonlyArray<readonly [number, string]> = [[12, 'leading-3'], [16, 'leading-4'], [20, 'leading-5'], [24, 'leading-6'], [28, 'leading-7'], [32, 'leading-8'], [36, 'leading-9'], [40, 'leading-10']];
const byRatio = (r: number): string => LEAD.reduce((a, c) => (Math.abs(c[0] - r) < Math.abs(a[0] - r) ? c : a))[1];
/** line-height → a `leading-*`: a RATIO name when computable against font-size (or unitless), else the
 *  fixed-px scale. Returns null to DROP an implausible line-height (e.g. a 2.6× tall line-box from a
 *  centered single-line heading) so the platform default applies instead of pinning excess vertical space. */
export function leadingClass(lh: string, fontSize?: string): string | null {
  const n = parseFloat(lh);
  if (Number.isNaN(n)) return null;
  if (/px/.test(lh)) {
    const f = parseFloat(fontSize ?? '');
    if (f > 0) { const r = n / f; return r < 0.9 || r > 2.2 ? null : byRatio(r); }
    if (n < 10 || n > 44) return null; // off the fixed-px leading scale → platform default
    return LEAD_PX.reduce((a, c) => (Math.abs(c[0] - n) < Math.abs(a[0] - n) ? c : a))[1];
  }
  if (/[%a-z]/i.test(lh.trim())) return null; // em/rem/% line-height — leave to default
  return n < 0.9 || n > 2.2 ? null : byRatio(n); // unitless
}

const rgbKey = (v: string): string | null => {
  const m = (v || '').match(/(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // fully transparent (alpha 0) → not a color
  return `${m[1]},${m[2]},${m[3]}`;
};

/** Captured `rgb(...)` → `#rrggbb` (passthrough for anything without an rgb triple). */
export const hexOf = (v: string): string => {
  const m = (v || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [1, 2, 3].map((i) => (+m[i]!).toString(16).padStart(2, '0')).join('') : v;
};

// Tailwind neutral (pure-gray) scale: average channel value → token. Snaps an off-brand gray to a
// canonical bg-neutral-200 / text-neutral-800 instead of an arbitrary [#cccccc].
const NEUTRAL: ReadonlyArray<readonly [number, string]> = [[250, 'neutral-50'], [245, 'neutral-100'], [229, 'neutral-200'], [212, 'neutral-300'], [163, 'neutral-400'], [115, 'neutral-500'], [82, 'neutral-600'], [64, 'neutral-700'], [38, 'neutral-800'], [23, 'neutral-900'], [10, 'neutral-950']];
/** A near-gray captured color → the nearest `neutral-*` token, or null if it's chromatic (keep the hex). */
export function graySnap(v: string): string | null {
  const m = (v || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const r = +m[1]!, g = +m[2]!, b = +m[3]!;
  if (Math.max(r, g, b) - Math.min(r, g, b) > 18) return null; // chromatic → not a neutral
  const lvl = (r + g + b) / 3;
  return NEUTRAL.reduce((a, c) => (Math.abs(c[0] - lvl) < Math.abs(a[0] - lvl) ? c : a))[1];
}

const pctOrNum = (x: string): number => (x.trim().endsWith('%') ? parseFloat(x) / 100 : parseFloat(x));

/** oklab/oklch (Lab) → sRGB rgb()/rgba(). Chromium's getComputedStyle returns modern color-spaces verbatim
 *  on Tailwind-v4 sites, and an `oklab(L a b / x)` value emits as a `text-[oklab(L a b / x)]` arbitrary
 *  class whose SPACES break Tailwind → no CSS → the colour silently falls back to black. */
function oklabToRgb(L: number, a: number, b: number, alpha: number): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gam = (c: number): number => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  const r = gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return alpha < 1 ? `rgba(${r}, ${g}, ${bl}, ${Math.round(alpha * 1000) / 1000})` : `rgb(${r}, ${g}, ${bl})`;
}

/** Convert a modern color-space value (oklab/oklch) to sRGB rgb(); pass anything else through unchanged. */
export function normalizeColor(v: string): string {
  if (!v || !/^okl(?:ab|ch)\(/i.test(v.trim())) return v;
  const lab = v.match(/^oklab\(\s*([\d.]+%?)\s+(-?[\d.]+%?)\s+(-?[\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)/i);
  if (lab) return oklabToRgb(pctOrNum(lab[1]!), pctOrNum(lab[2]!), pctOrNum(lab[3]!), lab[4] ? pctOrNum(lab[4]) : 1);
  const lch = v.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+(-?[\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)/i);
  if (lch) { const h = (parseFloat(lch[3]!) * Math.PI) / 180, c = pctOrNum(lch[2]!); return oklabToRgb(pctOrNum(lch[1]!), c * Math.cos(h), c * Math.sin(h), lch[4] ? pctOrNum(lch[4]) : 1); }
  return v;
}

/** A `text-`/`bg-` class for a captured color: a SEMI-TRANSPARENT color keeps its exact rgba (a 10% dark
 *  overlay must NOT collapse to opaque `bg-black`); else brand token → neutral snap → hex arbitrary. */
export function colorClass(prefix: string, v: string, palette: NativizePalette): string {
  v = normalizeColor(v);
  const a = (v || '').match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  if (a) { const al = parseFloat(a[1]!); if (al > 0 && al < 1) return `${prefix}-[${(v || '').replace(/\s+/g, '')}]`; } // keep the alpha
  const t = colorToken(v, palette);
  if (t) return `${prefix}-${t}`;
  const gray = graySnap(v);
  return gray ? `${prefix}-${gray}` : `${prefix}-[${hexOf(v)}]`;
}

/** Captured color → a token name (brand primary/secondary/accent, or white/black), or null if no match. */
export function colorToken(v: string, palette: NativizePalette): string | null {
  const k = rgbKey(v);
  if (!k) return null;
  if (palette.colors[k]) return palette.colors[k]!;
  return k === '255,255,255' ? 'white' : k === '0,0,0' ? 'black' : null;
}

/** Captured color → a CSS value for arbitrary props (e.g. borders): brand → var(--sw-color-*), else hex. */
export function colorValue(v: string, palette: NativizePalette): string {
  v = normalizeColor(v);
  const t = colorToken(v, palette);
  return t && t !== 'white' && t !== 'black' ? `var(--sw-color-${t})` : t === 'white' ? '#fff' : t === 'black' ? '#000' : hexOf(v);
}

/** The platform's default font-family substring → token map (the spike's FONTS), a sensible default palette.fonts. */
export const DEFAULT_FONT_MAP: ReadonlyArray<readonly [string, string]> = [
  ['text-font', 'font-body'], ['primary-font', 'font-heading'], ['client-font-1', 'font-client1'],
  ['client-font-2', 'font-client2'], ['secondary-font', 'font-heading'], ['tertiary-font', 'font-sans'],
];
