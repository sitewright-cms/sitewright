// Build the nativizer's color palette from a PROJECT's theme tokens, so a captured brand color snaps to
// `bg-primary` / `var(--sw-color-*)` (theme-editable) instead of a frozen hex. The theme stores colors as
// CSS strings (hex/rgb); the transform keys colors by the "r,g,b" triple, so convert here. Pure + tested.
import type { NativizePalette } from './tokens.js';

/** Parse a CSS color (#rgb, #rrggbb, rgb()/rgba()) → "r,g,b" (spaces stripped), or null if unparseable. */
export function colorToRgbKey(css: string | undefined): string | null {
  const v = (css || '').trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) { const h = m[1]!; return `${parseInt(h[0]! + h[0]!, 16)},${parseInt(h[1]! + h[1]!, 16)},${parseInt(h[2]! + h[2]!, 16)}`; }
  m = v.match(/^#([0-9a-f]{6})$/);
  if (m) { const h = m[1]!; return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`; }
  m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  return null; // named colors / oklch / hsl etc. — not snappable to a brand token
}

/** The brand roles a nativized site should track (base/neutral surfaces are left to the platform base CSS). */
const BRAND_ROLES = ['primary', 'secondary', 'accent'] as const;

/**
 * Build a NativizePalette from a project's theme colors (token role → CSS color). Only the brand roles
 * are snapped (white/black are handled intrinsically by the tokenizer). `fonts` defaults to none, so
 * nativized text inherits the platform's typography rather than the imported site's fonts.
 */
export function buildPalette(
  colors: Readonly<Record<string, string>> | undefined,
  fonts: NativizePalette['fonts'] = [],
): NativizePalette {
  const out: Record<string, string> = {};
  for (const role of BRAND_ROLES) {
    const key = colorToRgbKey(colors?.[role]);
    if (key) out[key] = role;
  }
  return { colors: out, fonts };
}
