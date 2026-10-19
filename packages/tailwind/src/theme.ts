import { withGenericFallback, type BrandTokens } from '@sitewright/schema';

/** Brand tokens mapped into the subset of the Tailwind theme we expose as utilities. */
export interface TailwindTheme {
  /** Token name -> CSS color; enables `bg-<name>`, `text-<name>`, `border-<name>`, … */
  colors?: Record<string, string>;
  /** Token name -> font-family stack; enables `font-<name>`. */
  fonts?: Record<string, string>;
}

/**
 * Projects brand tokens onto the Tailwind theme so a project's own colors and
 * fonts become first-class utilities (e.g. `bg-primary`, `font-heading`, `font-display`).
 * Font utilities come from THREE sources:
 *   - the built-in `heading`/`body` slots → `font-heading`/`font-body`, pointing at the live
 *     `--sw-font-heading`/`--sw-font-body` vars (emitted by typographyCss), so the utility always
 *     tracks the current slot;
 *   - custom named slots → `font-<name>` (→ `var(--sw-font-<name>)`);
 *   - legacy `fontFamilies` raw stacks → `font-<key>` (kept as an escape hatch; wins on key clash). A stack
 *     names a family but ships no file, so one without a generic gets one appended (`JetBrains Mono` →
 *     `JetBrains Mono, monospace`): a bare stack fell back to the browser's default serif.
 */
export function brandToTailwindTheme(brand: BrandTokens): TailwindTheme {
  const typo = brand.typography;
  const named = typo?.named ?? {};
  return {
    colors: { ...brand.colors },
    fonts: {
      heading: 'var(--sw-font-heading)',
      body: 'var(--sw-font-body)',
      ...Object.fromEntries(Object.keys(named).map((n) => [n, `var(--sw-font-${n})`])),
      ...Object.fromEntries(Object.entries(typo?.fontFamilies ?? {}).map(([k, v]) => [k, withGenericFallback(k, v)])),
    },
  };
}
