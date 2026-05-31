// Mirrors apps/render-app/src/lib/brand-css.ts. Kept here so the shared renderer
// can produce a brand-themed preview document on its own; Phase F converges the
// Astro renderer onto this package and removes the duplicate.
import type { BrandTokens } from '@sitewright/schema';

// Defense-in-depth: brand token keys/values are already schema-validated, but we
// never emit anything that could break out of a CSS declaration (`;{}<>`) or
// invoke a CSS function such as `url()`/`expression()` (which could exfiltrate or
// fetch) — so parentheses and quotes are rejected too. Whitespace controls,
// backslash (CSS hex escapes like `\28` → `(`) and NUL are also denied so a value
// cannot straddle a `/* */` comment or reconstruct a blocked character.
// eslint-disable-next-line no-control-regex -- intentionally denying NUL/control chars
const SAFE = /^[^;{}<>()'"\\\n\r\t\f\x00]*$/;

function emit(
  prefix: string,
  map: Record<string, string | number> | undefined,
  lines: string[],
): void {
  if (!map) return;
  for (const [key, value] of Object.entries(map)) {
    const v = String(value);
    if (!SAFE.test(key) || !SAFE.test(v)) continue;
    lines.push(`  --sw-${prefix}-${key}: ${v};`);
  }
}

/**
 * Compiles a project's brand tokens into a `:root { … }` block of CSS custom
 * properties. These feed the preview stylesheet's theme variables, so the
 * preview re-themes from the same single source of truth as the published site.
 */
export function brandToCss(brand: BrandTokens): string {
  const lines: string[] = [];
  emit('color', brand.colors, lines);
  emit('font', brand.typography?.fontFamilies, lines);
  emit('space', brand.spacing, lines);
  emit('radius', brand.radii, lines);
  return `:root {\n${lines.join('\n')}\n}`;
}
