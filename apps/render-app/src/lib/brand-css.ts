import type { Brand } from '@sitewright/schema';

// Defense-in-depth: brand token keys/values are already schema-validated, but we
// never emit anything that could break out of a CSS declaration (`;{}<>`) or
// invoke a CSS function such as `url()`/`expression()` (which could exfiltrate or
// fetch) — so parentheses and quotes are rejected too.
const SAFE = /^[^;{}<>()'"]*$/;

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
 * properties. These feed the Tailwind `@theme` variables in global.css, so the
 * whole site re-themes from a single source of truth.
 */
export function brandToCss(brand: Brand): string {
  const lines: string[] = [];
  emit('color', brand.colors, lines);
  emit('font', brand.typography?.fontFamilies, lines);
  emit('space', brand.spacing, lines);
  emit('radius', brand.radii, lines);
  return `:root {\n${lines.join('\n')}\n}`;
}
