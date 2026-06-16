// Opt-in light/dark color schemes for the rendered site (website.enableColorSchemes). When enabled,
// the platform's theme tokens gain a DARK variant; because every layer reads those tokens — DaisyUI
// components + Tailwind utilities (bg-base-100 / text-base-content) via `--color-*`, and base-css +
// the first-party components via `--sw-color-*` — swapping the neutral tokens flips the whole site at
// once. This (PR 1) is ZERO-JS: the per-project DEFAULT scheme is server-rendered onto `<html
// data-theme>` and 'auto' follows the OS via prefers-color-scheme, so there is no flash and no script.
// (A visitor `{{darkModeToggle}}` + OKLCH dark-tuned brand shades are follow-up PRs.)

export type ColorScheme = 'auto' | 'light' | 'dark';

// DaisyUI v5's curated dark-theme NEUTRALS, applied to BOTH token namespaces (--color-* drives
// DaisyUI + utilities; --sw-color-* drives base-css + the first-party components). The brand roles
// (primary / secondary / accent) are intentionally KEPT at the tenant's light values for now — a
// follow-up derives dark-tuned brand shades in OKLCH so a dark brand colour stays legible on dark.
const DARK_TOKENS = [
  '--color-base-100:oklch(25.33% 0.016 252.42)',
  '--color-base-200:oklch(23.26% 0.014 253.1)',
  '--color-base-300:oklch(21.15% 0.012 254.09)',
  '--color-base-content:oklch(97.807% 0.029 256.847)',
  '--sw-color-base-100:oklch(25.33% 0.016 252.42)',
  '--sw-color-base-200:oklch(23.26% 0.014 253.1)',
  '--sw-color-base-300:oklch(21.15% 0.012 254.09)',
  '--sw-color-base-content:oklch(97.807% 0.029 256.847)',
  'color-scheme:dark',
].join(';');

/**
 * The dark-scheme CSS for the rendered document — emitted ONLY when color schemes are enabled. It is
 * emitted UNLAYERED in the inline base <style>, which gives it two cascade advantages so no
 * `!important` is needed: (a) unlayered always beats the compiled utility sheet's layered token
 * declarations (Tailwind's `@layer theme` + DaisyUI's `@layer base`), and (b) at (0,2,0) it beats the
 * unlayered `:root{…}` light tokens from brandToCss (0,1,0) in any source order. Two paths:
 *  - FORCED dark via `:root[data-sw-scheme="dark"]` — the server-set default + the future visitor toggle.
 *  - AUTO dark via `prefers-color-scheme` that YIELDS to an explicit `data-sw-scheme` (so a pinned
 *    light/dark default, or a toggle choice, always wins over the OS).
 * We use our OWN `data-sw-scheme` attribute (not DaisyUI's `data-theme`) to stay fully decoupled from
 * DaisyUI's attribute handling. DaisyUI runs with themes:false so it emits no brand `[data-theme=…]`
 * block anyway — but owning the attribute keeps this independent of that.
 */
export function colorSchemeCss(): string {
  return (
    `:root[data-sw-scheme="dark"]{${DARK_TOKENS}}\n` +
    `@media (prefers-color-scheme: dark){:root:not([data-sw-scheme]){${DARK_TOKENS}}}`
  );
}

/**
 * The `data-sw-scheme` attribute (with a leading space) for the `<html>` tag, given the project's
 * default scheme. A forced 'light'/'dark' is pinned server-side; 'auto' (or unset) emits nothing so
 * the prefers-color-scheme media query governs. The value is a fixed enum literal — never user input.
 */
export function colorSchemeHtmlAttr(defaultScheme: ColorScheme | undefined): string {
  return defaultScheme === 'light' || defaultScheme === 'dark' ? ` data-sw-scheme="${defaultScheme}"` : '';
}
