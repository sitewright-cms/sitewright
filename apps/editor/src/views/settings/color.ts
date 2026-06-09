// A small, dependency-free color kernel for the brand color picker: parse + format across
// the four spaces an author edits in (HEX / RGB / HSL / OKLCH) plus the HSV model the visual
// picker drags in, with an alpha channel throughout. We STORE sRGB hex (6-digit, or 8-digit
// `#rrggbbaa` when alpha < 1 — both already allowed by the server's CssColorSchema), so every
// space is just an editing lens over the same canonical sRGB+alpha value.
//
// The OKLCH transform is Björn Ottosson's published sRGB↔OKLab matrices. OKLCH can express
// colors outside the sRGB gamut; converting such a value back to sRGB CLIPS each channel to
// [0,1] (a simple, predictable clip — not perceptual gamut mapping), which is the right
// trade-off for a "store an sRGB hex" picker.

/** sRGB with alpha. r,g,b are integers 0–255; a is 0–1. The canonical stored form. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The HSV model the visual picker uses (a square of s×v at a hue). h 0–360, s/v/a 0–1. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** The editable color spaces, in display order. */
export const COLOR_FORMATS = ['hex', 'rgb', 'hsl', 'oklch'] as const;
export type ColorFormat = (typeof COLOR_FORMATS)[number];

/**
 * A CSS color the editor can preview in a swatch (hex / rgb(a) / hsl(a) incl. `deg` / keyword).
 * Mirrors the server's CssColorSchema so server-valid values render; anything else (an in-progress
 * or injection-shaped string) falls back to a transparent swatch. React sets this as an inert DOM
 * style property regardless — this only decides which color to show. The single source of truth, so
 * the swatch guard can't drift from the schema across files.
 */
export const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$|^(?:rgb|hsl)a?\([0-9\s%,./deg-]+\)$|^[a-zA-Z]+$/;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const round = (n: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const hex2 = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

// A compact set of CSS keywords worth opening the picker at; any other bare keyword parses to
// null (the picker keeps the raw text until the author picks a concrete color). Hex/rgb/hsl
// cover everything else authors actually type.
const NAMED: Readonly<Record<string, Rgba>> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
};

// ----------------------------------------------------------------- hex
function parseHex(input: string): Rgba | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1]!;
  const dup = (s: string): number => parseInt(s + s, 16);
  if (h.length === 3) return { r: dup(h[0]!), g: dup(h[1]!), b: dup(h[2]!), a: 1 };
  if (h.length === 4) return { r: dup(h[0]!), g: dup(h[1]!), b: dup(h[2]!), a: dup(h[3]!) / 255 };
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  if (h.length === 8)
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
  return null; // 5 or 7 digits → not a valid hex color
}

/** Canonical stored form: `#rrggbb`, or `#rrggbbaa` when alpha < 1. */
export function formatHex(c: Rgba): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a >= 1 ? base : `${base}${hex2(c.a * 255)}`;
}

// ----------------------------------------------------------------- function-notation parse
// Pull every signed decimal out of the parentheses, remembering which carried a `%`. The first
// `/` (modern slash-alpha syntax) splits the alpha off so a percentage alpha isn't miscounted.
function fnParts(input: string): { name: string; nums: { v: number; pct: boolean }[]; alpha: number | null } | null {
  const m = /^([a-z]+)\(([^)]*)\)$/i.exec(input.trim());
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const [body = '', alphaSrc] = m[2]!.split('/');
  // A single non-ambiguous number token (optional sign, digits with an optional fraction),
  // optionally exponent- and/or percent-suffixed. parseFloat ignores a trailing `%`/`e…` it
  // can't use, so the captured `%` flag is what drives percentage handling.
  const grab = (s: string): { v: number; pct: boolean }[] =>
    // eslint-disable-next-line security/detect-unsafe-regex -- linear: each branch is anchored, no nested unbounded quantifier; input is a short parenthesised body
    (s.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?%?/gi) ?? []).map((t) => ({ v: parseFloat(t), pct: t.endsWith('%') }));
  const nums = grab(body);
  let alpha: number | null = null;
  if (alphaSrc !== undefined) {
    const a = grab(alphaSrc)[0];
    if (a) alpha = a.pct ? a.v / 100 : a.v;
  } else if ((name === 'rgba' || name === 'hsla') && nums.length >= 4) {
    const a = nums.pop()!;
    alpha = a.pct ? a.v / 100 : a.v;
  } else if (nums.length >= 4 && (name === 'rgb' || name === 'hsl' || name === 'oklch')) {
    // Comma form `rgb(r,g,b,a)` / space form with a trailing alpha but no slash.
    const a = nums.pop()!;
    alpha = a.pct ? a.v / 100 : a.v;
  }
  return { name, nums, alpha: alpha === null ? null : clamp(alpha, 0, 1) };
}

// ----------------------------------------------------------------- rgb ⇄ hsv
export function rgbToHsv(c: Rgba): Hsva {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: c.a };
}

export function hsvToRgb(c: Hsva): Rgba {
  const h = ((c.h % 360) + 360) % 360;
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return c.v - c.v * c.s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255), a: c.a };
}

// ----------------------------------------------------------------- rgb ⇄ hsl
function rgbToHsl(c: Rgba): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (n: number): number => {
    const k = (n + hh * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a };
}

// ----------------------------------------------------------------- rgb ⇄ oklch  (Ottosson)
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklch(c: Rgba): { l: number; c: number; h: number } {
  const r = srgbToLinear(c.r / 255);
  const g = srgbToLinear(c.g / 255);
  const b = srgbToLinear(c.b / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const chroma = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: chroma, h: chroma < 1e-4 ? 0 : h };
}

function oklchToRgb(L: number, C: number, H: number, a: number): Rgba {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = linearToSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const b = linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  // Out-of-gamut OKLCH → clip each channel into sRGB (predictable, if not perceptual).
  return { r: Math.round(clamp(r, 0, 1) * 255), g: Math.round(clamp(g, 0, 1) * 255), b: Math.round(clamp(b, 0, 1) * 255), a };
}

// ----------------------------------------------------------------- public parse / format
/** Parse any supported color string (hex, rgb(a), hsl(a), oklch, or a known keyword) → Rgba, or null. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim();
  if (!s) return null;
  if (s[0] === '#') return parseHex(s);
  const key = s.toLowerCase();
  // own-property check first, so a prototype key (`constructor`, `toString`) never resolves.
  // eslint-disable-next-line security/detect-object-injection -- own-property checked above; NAMED is a fixed literal map
  if (Object.hasOwn(NAMED, key)) return { ...NAMED[key]! };
  const parts = fnParts(s);
  if (!parts) return null;
  const { name, nums, alpha } = parts;
  const a = alpha ?? 1;
  // eslint-disable-next-line security/detect-object-injection -- i is a fixed channel index (0–3)
  const n = (i: number, fallbackPct = false): { v: number; pct: boolean } => nums[i] ?? { v: 0, pct: fallbackPct };
  if ((name === 'rgb' || name === 'rgba') && nums.length >= 3) {
    const ch = (i: number): number => {
      const p = n(i);
      return clamp(Math.round(p.pct ? p.v * 2.55 : p.v), 0, 255);
    };
    return { r: ch(0), g: ch(1), b: ch(2), a };
  }
  if ((name === 'hsl' || name === 'hsla') && nums.length >= 3) {
    return hslToRgb(n(0).v, clamp(n(1).v, 0, 100) / 100, clamp(n(2).v, 0, 100) / 100, a);
  }
  if (name === 'oklch' && nums.length >= 3) {
    const L = clamp(n(0).pct ? n(0).v / 100 : n(0).v, 0, 1);
    const C = Math.max(0, n(1).pct ? (n(1).v / 100) * 0.4 : n(1).v); // 100% chroma = 0.4 per CSS
    return oklchToRgb(L, C, n(2).v, a);
  }
  return null;
}

const alphaStr = (a: number): string => round(a, 3).toString();

/** Format a canonical color in the given space. HEX is the stored form; the rest are editing lenses. */
export function formatColor(c: Rgba, fmt: ColorFormat): string {
  if (fmt === 'hex') return formatHex(c);
  if (fmt === 'rgb') return c.a >= 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgb(${c.r} ${c.g} ${c.b} / ${alphaStr(c.a)})`;
  if (fmt === 'hsl') {
    const { h, s, l } = rgbToHsl(c);
    const base = `${round(h)} ${round(s * 100)}% ${round(l * 100)}%`;
    return c.a >= 1 ? `hsl(${base})` : `hsl(${base} / ${alphaStr(c.a)})`;
  }
  const { l, c: chroma, h } = rgbToOklch(c);
  const base = `${round(l, 3)} ${round(chroma, 3)} ${round(h, 2)}`;
  return c.a >= 1 ? `oklch(${base})` : `oklch(${base} / ${alphaStr(c.a)})`;
}
