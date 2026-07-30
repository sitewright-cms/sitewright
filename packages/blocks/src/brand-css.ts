// Brand tokens → CSS custom properties for the rendered document (the single source
// of truth now that the legacy Astro renderer is gone).
import { isSafeCssTokenValue, type BrandTokens } from '@sitewright/schema';

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

// FREE-FORM tokens (`identity.cssTokens`) need a wider gate than `SAFE`: their whole point is to hold a
// gradient or a shadow ramp, and `SAFE` rejects parentheses, so `emit` would DROP every such value
// silently. `isSafeCssTokenValue` is the schema's own guard (the real boundary) reused here as its
// defence-in-depth twin — one definition, so the two can't drift apart.
/** Free-form `--sw-<key>` custom properties (no category prefix — the key IS the token name). */
function emitRich(map: Record<string, string> | undefined, lines: string[]): void {
  if (!map) return;
  for (const [key, value] of Object.entries(map)) {
    if (!SAFE.test(key) || !isSafeCssTokenValue(value)) continue;
    lines.push(`  --sw-${key}: ${value};`);
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
  // Last, so a free-form token may deliberately restate a categorized one (later wins in a tie).
  emitRich(brand.cssTokens, lines);
  return `:root {\n${lines.join('\n')}\n}`;
}
