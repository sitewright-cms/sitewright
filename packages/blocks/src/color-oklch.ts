// Minimal, dependency-free colour maths for dark-mode brand tuning. Runs ONLY server-side at
// render time (never shipped to the browser), so it costs nothing in the published bundle.
//
// The platform stores brand colours as hex (the editor's colour picker emits hex, and brand-css's
// SAFE filter drops parenthesised values like rgb()/oklch() before they reach a token), so the only
// input we must parse is hex. We convert hex → OKLCH using Björn Ottosson's standard transform
// (sRGB → linear → OKLab → OKLCH), which lets us reason about a colour's *perceptual lightness* and
// tune it for a dark surface while preserving hue. Anything we cannot parse returns `null`, so every
// caller degrades gracefully to the existing behaviour (the untuned light brand value carries over).
//
// We never need the reverse transform: the dark block emits `oklch(…)` directly (CSS gamut-maps it),
// and the text-on-brand pick returns a fixed light/dark literal — so this file is forward-only.

/** Perceptual lightness floor for a dark-tuned brand colour: a darker brand is lifted to at least
 *  this OKLCH L so it clears the dark base (L≈0.25) and reads as a vivid surface. A brand already
 *  lighter than the floor is left untouched (it is already legible on dark). Set just ABOVE
 *  {@link CONTENT_DARK_THRESHOLD} so that a brand lifted exactly to the floor takes DARK text and
 *  clears WCAG AA (~4.7:1) against it — at L=0.60 dark text would fall just short of 4.5:1. */
export const DARK_BRAND_L_FLOOR = 0.62;

/** At/above this OKLCH lightness a fill wants DARK text; below it wants light text. Used to derive the
 *  `*-content` (text-on-brand) tokens so a button's label stays legible whatever the brand colour. */
export const CONTENT_DARK_THRESHOLD = 0.6;

/** Text-on-brand literals chosen by {@link contrastText}. Near-black mirrors the default base-content
 *  so dark labels feel native; white is the usual label on a saturated/dark fill. */
export const TEXT_ON_LIGHT = '#1a1a23';
export const TEXT_ON_DARK = '#ffffff';

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, ≥0. */
  c: number;
  /** Hue in degrees, 0–360 (0 when achromatic). */
  h: number;
  /** Alpha, 0–1; omitted when fully opaque. */
  alpha?: number;
}

/** Parse a 3/4/6/8-digit hex string to sRGB channels in 0–1 (+ alpha). Returns null for non-hex. */
function parseHex(input: string): { r: number; g: number; b: number; alpha?: number } | null {
  // Only the four real hex shapes (3/4/6/8) — not 5- or 7-digit strings — reach the body.
  const m = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(input.trim());
  if (!m || m[1] === undefined) return null;
  const hex = m[1];
  // Expand one nibble (a single hex char) of a 3/4-digit shorthand to a 0–255 channel.
  const nibble = (i: number): number => {
    const ch = hex.slice(i, i + 1);
    return parseInt(ch + ch, 16);
  };
  let r: number, g: number, b: number, a = 255;
  if (hex.length === 3 || hex.length === 4) {
    r = nibble(0);
    g = nibble(1);
    b = nibble(2);
    if (hex.length === 4) a = nibble(3);
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16);
  } else {
    return null; // 5- or 7-digit hex is invalid
  }
  const out: { r: number; g: number; b: number; alpha?: number } = { r: r / 255, g: g / 255, b: b / 255 };
  if (a !== 255) out.alpha = a / 255; // alpha is set ONLY when not fully opaque (so `alpha:1` never appears)
  return out;
}

/** sRGB companded channel (0–1) → linear-light. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert a hex colour string to OKLCH. Returns null when the input is not a hex colour (named or
 * function colours, or malformed strings) so callers can skip tuning and keep the light value.
 */
export function hexToOklch(input: string): Oklch | null {
  const rgb = parseHex(input);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  // linear sRGB → LMS (Ottosson's matrix), then cube-root, then → OKLab.
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(a * a + bb * bb);
  // Hue is undefined for an achromatic colour; pin it to 0 so the output is a stable grey.
  const h = c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;

  const out: Oklch = { l: L, c, h };
  if (rgb.alpha !== undefined) out.alpha = rgb.alpha;
  return out;
}

/** Round to `digits` decimals and drop trailing zeros — keeps the emitted CSS compact. A non-finite
 *  input (unreachable from a parsed hex, but guard anyway) collapses to '0' so the token never becomes
 *  the malformed literal `NaN`/`Infinity`. */
function round(n: number, digits: number): string {
  return Number.isFinite(n) ? parseFloat(n.toFixed(digits)).toString() : '0';
}

/** Serialise an OKLCH colour to a CSS `oklch(L C H[ / A])` string. */
export function formatOklch(v: Oklch): string {
  const base = `oklch(${round(v.l, 4)} ${round(v.c, 4)} ${round(v.h, 2)}`;
  return v.alpha !== undefined && v.alpha < 1 ? `${base} / ${round(v.alpha, 3)})` : `${base})`;
}

/** A dark-tuned brand role: the `oklch(…)` surface fill + a legible text colour for labels on it. */
export interface DarkBrandShade {
  /** The dark-mode brand fill — an `oklch(…)` literal for the dark token block. */
  fill: string;
  /** The text-on-fill colour ({@link TEXT_ON_LIGHT}/{@link TEXT_ON_DARK}) for the `*-content` token. */
  content: string;
}

/**
 * Derive a brand role's DARK-mode shade from its (light) brand colour: lift the perceptual lightness
 * to at least `floor` so a low-contrast / dark brand colour stays legible on the dark base, while
 * preserving hue and chroma; a colour already lighter than the floor keeps its lightness. Alpha is
 * dropped — a brand surface (button/pill) is a SOLID fill, never see-through. The matching text colour
 * is picked from the lifted lightness so a label stays legible on the fill. Returns null for non-hex
 * input, so the caller keeps the untuned light value (graceful degradation).
 */
export function darkBrandShade(input: string, floor: number = DARK_BRAND_L_FLOOR): DarkBrandShade | null {
  const oklch = hexToOklch(input);
  if (!oklch) return null;
  const l = Math.max(oklch.l, floor);
  return { fill: formatOklch({ l, c: oklch.c, h: oklch.h }), content: contrastTextForOklch(l) };
}

/**
 * Pick a legible text colour ({@link TEXT_ON_LIGHT} or {@link TEXT_ON_DARK}) for a label sitting on
 * the given fill colour, by its OKLCH lightness. Returns null for non-hex input so the caller falls
 * back to its existing literal (e.g. `var(--sw-color-primary-content,#fff)`).
 */
export function contrastText(input: string): string | null {
  const oklch = hexToOklch(input);
  if (!oklch) return null;
  return oklch.l >= CONTENT_DARK_THRESHOLD ? TEXT_ON_LIGHT : TEXT_ON_DARK;
}

/** Pick legible text for a colour already expressed as OKLCH (e.g. a dark-tuned fill). */
export function contrastTextForOklch(l: number): string {
  return l >= CONTENT_DARK_THRESHOLD ? TEXT_ON_LIGHT : TEXT_ON_DARK;
}
