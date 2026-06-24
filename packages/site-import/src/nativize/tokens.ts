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

/** px → spacing-scale token (`"16px"` → `"4"`), or null if off-scale beyond tolerance. */
export function spaceToken(v: string, tol?: number): string | null {
  const px = parseFloat(v);
  if (Number.isNaN(px)) return null;
  const b = nearest(px, SPX);
  return Math.abs(b - px) <= (tol ?? Math.max(1.5, px * 0.06)) ? STOK[b]! : null;
}

/** Loose spacing class for padding/margin/gap: `space("p", "16px")` → `"p-4"`; off-scale → `"p-[16.2px]"`. */
export function space(prefix: string, v: string): string {
  const t = spaceToken(v);
  return t !== null ? `${prefix}-${t}` : `${prefix}-[${v}]`;
}

/** Tight spacing class for w/h/insets/icons (default tol 1px): `dim("h", "16px")` → `"h-4"`. */
export function dim(prefix: string, v: string, tol = 1): string {
  const t = spaceToken(v, tol);
  return t !== null ? `${prefix}-${t}` : `${prefix}-[${v}]`;
}

/** Font-size px → `text-*` token, or an arbitrary `text-[19.2px]` when off-scale. */
export function fontSizeClass(v: string): string {
  const px = parseFloat(v);
  if (Number.isNaN(px)) return `text-[${v}]`;
  const b = nearest(px, Object.keys(FPX).map(Number));
  return Math.abs(b - px) <= Math.max(1.5, px * 0.08) ? FPX[b]! : `text-[${v}]`;
}

/** Border-radius px → `rounded-*` (≥400px → `rounded-full`), or an arbitrary value when off-scale. */
export function radiusClass(v: string): string {
  const px = parseFloat(v);
  if (Number.isNaN(px)) return `rounded-[${arbitrary(v)}]`;
  if (px >= 400) return 'rounded-full';
  const b = nearest(px, Object.keys(RPX).map(Number));
  return Math.abs(b - px) <= Math.max(2, px * 0.12) ? RPX[b]! : `rounded-[${arbitrary(v)}]`;
}

const rgbKey = (v: string): string | null => {
  const m = (v || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? `${m[1]},${m[2]},${m[3]}` : null;
};

/** Captured `rgb(...)` → `#rrggbb` (passthrough for anything without an rgb triple). */
export const hexOf = (v: string): string => {
  const m = (v || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [1, 2, 3].map((i) => (+m[i]!).toString(16).padStart(2, '0')).join('') : v;
};

/** Captured color → a token name (brand primary/secondary/accent, or white/black), or null if no match. */
export function colorToken(v: string, palette: NativizePalette): string | null {
  const k = rgbKey(v);
  if (!k) return null;
  if (palette.colors[k]) return palette.colors[k]!;
  return k === '255,255,255' ? 'white' : k === '0,0,0' ? 'black' : null;
}

/** Captured color → a CSS value for arbitrary props (e.g. borders): brand → var(--sw-color-*), else hex. */
export function colorValue(v: string, palette: NativizePalette): string {
  const t = colorToken(v, palette);
  return t && t !== 'white' && t !== 'black' ? `var(--sw-color-${t})` : t === 'white' ? '#fff' : t === 'black' ? '#000' : hexOf(v);
}

/** The platform's default font-family substring → token map (the spike's FONTS), a sensible default palette.fonts. */
export const DEFAULT_FONT_MAP: ReadonlyArray<readonly [string, string]> = [
  ['text-font', 'font-body'], ['primary-font', 'font-heading'], ['client-font-1', 'font-client1'],
  ['client-font-2', 'font-client2'], ['secondary-font', 'font-heading'], ['tertiary-font', 'font-sans'],
];
