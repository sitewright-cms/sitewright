import type { Brand } from '@sitewright/schema';

/** Brand tokens mapped into the subset of the Tailwind theme we expose as utilities. */
export interface TailwindTheme {
  /** Token name -> CSS color; enables `bg-<name>`, `text-<name>`, `border-<name>`, … */
  colors?: Record<string, string>;
  /** Token name -> font-family stack; enables `font-<name>`. */
  fonts?: Record<string, string>;
}

/**
 * Projects a {@link Brand} onto the Tailwind theme so a project's own colors and
 * fonts become first-class utilities (e.g. `bg-primary`, `font-display`). Only
 * colors and font families are mapped — the high-value, low-risk brand surface.
 */
export function brandToTailwindTheme(brand: Brand): TailwindTheme {
  return {
    colors: { ...brand.colors },
    fonts: { ...(brand.typography?.fontFamilies ?? {}) },
  };
}
