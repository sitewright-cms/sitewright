import { createRequire } from 'node:module';
import type { TailwindTheme } from './theme.js';
import { brandVars } from './tokens.js';

const require = createRequire(import.meta.url);

/**
 * Absolute path to DaisyUI's Tailwind-v4 plugin entry (resolved from this package's deps).
 * @internal package-private — consumed only by `compile.ts`, never re-exported from the barrel.
 */
export const DAISY_PLUGIN_PATH = require.resolve('daisyui');

/**
 * DaisyUI v5's light-theme defaults — the full set of CSS vars its components reference. We
 * run DaisyUI with `themes: false` (it emits components but NO theme block), then supply these
 * vars ourselves, so brand colors override the palette with no cascade fight.
 * @internal Pinned to the installed DaisyUI version (its values track `daisyui` in package.json);
 * `daisy.test.ts` asserts the shape and `compile.test.ts` guards against the indigo default
 * leaking back into output.
 */
export const DAISY_THEME_DEFAULTS: Readonly<Record<string, string>> = {
  '--color-base-100': 'oklch(100% 0 0)',
  '--color-base-200': 'oklch(98% 0 0)',
  '--color-base-300': 'oklch(95% 0 0)',
  '--color-base-content': 'oklch(21% 0.006 285.885)',
  '--color-primary': 'oklch(45% 0.24 277.023)',
  '--color-primary-content': 'oklch(93% 0.034 272.788)',
  '--color-secondary': 'oklch(65% 0.241 354.308)',
  '--color-secondary-content': 'oklch(94% 0.028 342.258)',
  '--color-accent': 'oklch(77% 0.152 181.912)',
  '--color-accent-content': 'oklch(38% 0.063 188.416)',
  '--color-neutral': 'oklch(14% 0.005 285.823)',
  '--color-neutral-content': 'oklch(92% 0.004 286.32)',
  '--color-info': 'oklch(74% 0.16 232.661)',
  '--color-info-content': 'oklch(29% 0.066 243.157)',
  '--color-success': 'oklch(76% 0.177 163.223)',
  '--color-success-content': 'oklch(37% 0.077 168.94)',
  '--color-warning': 'oklch(82% 0.189 84.429)',
  '--color-warning-content': 'oklch(41% 0.112 45.904)',
  '--color-error': 'oklch(71% 0.194 13.428)',
  '--color-error-content': 'oklch(27% 0.105 12.094)',
  '--radius-selector': '0.5rem',
  '--radius-field': '0.25rem',
  '--radius-box': '0.5rem',
  '--size-selector': '0.25rem',
  '--size-field': '0.25rem',
  '--border': '1px',
  '--depth': '1',
  '--noise': '0',
};

/** DaisyUI v5 component class stems — used to detect whether a page uses DaisyUI at all. */
const DAISY_COMPONENT_STEMS: ReadonlySet<string> = new Set([
  'alert', 'avatar', 'badge', 'breadcrumbs', 'btn', 'card', 'carousel', 'chat', 'checkbox',
  'collapse', 'countdown', 'diff', 'divider', 'dock', 'drawer', 'dropdown', 'fieldset',
  'file-input', 'footer', 'hero', 'indicator', 'input', 'join', 'kbd', 'label', 'link', 'list',
  'loading', 'mask', 'menu', 'modal', 'navbar', 'progress', 'radial-progress', 'radio', 'range',
  'rating', 'select', 'skeleton', 'stack', 'stat', 'stats', 'status', 'steps', 'swap', 'tab',
  'tabs', 'table', 'textarea', 'theme-controller', 'timeline', 'toast', 'toggle', 'tooltip',
  'validator',
]);

/**
 * Whether any scanned class candidate is a DaisyUI component class (a bare stem, a
 * `stem-modifier`, or a DaisyUI base-surface color). Variant prefixes (`hover:`, `md:`) are
 * stripped first. A false positive (e.g. a literal `table` meaning `display:table`) only adds
 * DaisyUI's small base layer; a false negative would leave a component unstyled, so the stem
 * set is kept complete.
 */
export function usesDaisyComponents(candidates: readonly string[]): boolean {
  for (const candidate of candidates) {
    const cls = candidate.slice(candidate.lastIndexOf(':') + 1);
    // DaisyUI surface colors used via any utility, e.g. `bg-base-200`, `text-base-content`,
    // `border-base-300` — these need DaisyUI's vars, so their presence means DaisyUI is in use.
    if (/(?:^|-)base-(?:100|200|300|content)$/.test(cls)) return true;
    for (const stem of DAISY_COMPONENT_STEMS) {
      if (cls === stem || cls.startsWith(`${stem}-`)) return true;
    }
  }
  return false;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** sRGB channel (0–1) → linear-light, for WCAG relative luminance. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * A readable foreground (near-black or white) for a hex background; undefined for non-hex.
 * Uses the WCAG relative-luminance formula (with sRGB gamma linearization) and the 0.179
 * crossover at which black and white text give equal contrast — so the higher-contrast text
 * is chosen even for mid-tone brand colors.
 */
function contentColorFor(bg: string): string | undefined {
  if (!HEX.test(bg)) return undefined;
  const h = bg.length === 4 ? bg.slice(1).replace(/(.)/g, '$1$1') : bg.slice(1);
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? '#1f2937' : '#ffffff';
}

/**
 * The DaisyUI theme var map: DaisyUI's light defaults overlaid with the brand's color/font
 * tokens (so `primary`/`secondary`/`accent` re-theme the components) plus a computed readable
 * `-content` for each overridden hex role. Emitted into the `@theme {}` block — DaisyUI runs
 * with `themes:false`, so these vars are authoritative.
 */
export function daisyThemeVars(theme: TailwindTheme): Record<string, string> {
  const vars: Record<string, string> = { ...DAISY_THEME_DEFAULTS, ...brandVars(theme) };
  for (const role of ['primary', 'secondary', 'accent'] as const) {
    const value = theme.colors?.[role];
    const content = value ? contentColorFor(value) : undefined;
    if (content) vars[`--color-${role}-content`] = content;
  }
  return vars;
}
