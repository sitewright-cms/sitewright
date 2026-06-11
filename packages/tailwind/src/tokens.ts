import type { TailwindTheme } from './theme.js';

// A theme variable NAME must be a safe CSS identifier — defense-in-depth so a brand key cannot
// smuggle characters into the generated `@theme { … }` block. The authoritative constraint is the
// schema's ColorTokenKeySchema, which is STRICTER (rejects a trailing hyphen, caps length); this
// is a looser superset over the same `-`/`_` alphabet, so any schema-valid color key passes here
// and is never silently dropped.
// Caveat: Tailwind treats `_` as a space inside class candidates, so an underscore key (e.g.
// `nav_bg`) emits the `--color-nav_bg` var but is not reachable as a bare `bg-nav_bg` utility —
// use it via `bg-[var(--color-nav_bg)]`, or prefer single-word / camelCase brand token names.
export const SAFE_TOKEN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// A theme variable VALUE must not contain CSS structural characters — a brand color/font value
// cannot break out of its declaration to inject arbitrary rules. Real colors (hex/oklch/rgb)
// and font stacks (`"Inter", sans-serif`) never contain these.
const SAFE_VALUE = /^[^;{}<>\n\r]+$/;

/** The colored surface roles that get an auto-derived readable `-content` foreground. */
const CONTRAST_ROLES = ['primary', 'secondary', 'accent', 'neutral'] as const;

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** sRGB channel (0–1) → linear-light, for WCAG relative luminance. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * A readable foreground (near-black or white) for a hex background; undefined for non-hex. Uses the
 * WCAG relative-luminance formula (with sRGB gamma linearization) and the 0.179 crossover at which
 * black and white text give equal contrast — so the higher-contrast text is chosen even for mid-tone
 * brand colors. Shared by the daisy theme and the nav/button effect layer so any `bg-<role>
 * text-<role>-content` pairing (and the effect schemes) stay WCAG-readable.
 */
export function contentColorFor(bg: string): string | undefined {
  if (!HEX.test(bg)) return undefined;
  const h = bg.length === 4 ? bg.slice(1).replace(/(.)/g, '$1$1') : bg.slice(1);
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? '#1f2937' : '#ffffff';
}

/**
 * Brand colors/fonts as Tailwind theme vars (`--color-<token>`, `--font-<token>`); unsafe keys
 * dropped. Each overridden contrast role (primary/secondary/accent/neutral) also gets an auto-derived
 * readable `--color-<role>-content` — so a brand color never yields unreadable component/effect text,
 * in BOTH the daisy and pure-Tailwind compile branches.
 */
export function brandVars(theme: TailwindTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {})) if (SAFE_TOKEN.test(k)) vars[`--color-${k}`] = v;
  for (const [k, v] of Object.entries(theme.fonts ?? {})) if (SAFE_TOKEN.test(k)) vars[`--font-${k}`] = v;
  for (const role of CONTRAST_ROLES) {
    const value = theme.colors?.[role];
    const content = value ? contentColorFor(value) : undefined;
    if (content) vars[`--color-${role}-content`] = content;
  }
  return vars;
}

/** Emit an `@theme { … }` block from a var map. Vars with structurally-unsafe values are dropped. */
export function renderThemeBlock(vars: Record<string, string>): string {
  const lines = Object.entries(vars)
    .filter(([, v]) => SAFE_VALUE.test(v))
    .map(([k, v]) => `  ${k}: ${v};`);
  return lines.length ? `\n@theme {\n${lines.join('\n')}\n}` : '';
}
