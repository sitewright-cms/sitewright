import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import type { TailwindTheme } from './theme.js';
import { brandVars, renderThemeBlock } from './tokens.js';
import { DAISY_PLUGIN_PATH, daisyThemeVars, usesDaisyComponents } from './daisy.js';
import { EFFECT_UTILITIES } from './effects.js';

// Resolve Tailwind's own install directory so `@import "tailwindcss/*"` resolves
// from there regardless of the process cwd — robust in the repo, under vitest,
// and inside the `pnpm deploy --prod` bundle (tailwindcss is a direct dep of
// this package, so it is always resolvable from this module's location).
const require = createRequire(import.meta.url);
const TAILWIND_BASE = dirname(require.resolve('tailwindcss/theme.css'));

// Theme + utilities WITHOUT preflight: this is an additive utility layer on top
// of the platform skeleton + brand styles, so it must not reset the document.
// Utilities are imported UNLAYERED so that, placed after the skeleton `<style>`
// in source order, equal-specificity utilities win (layered CSS always loses to
// the skeleton's unlayered rules).
const BASE_INPUT = `@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css";`;

export interface CompileOptions {
  /** Minify the output with Lightning CSS (default true). */
  minify?: boolean;
  /** Directory from which `@import "tailwindcss/*"` is resolved (default: Tailwind's install dir). */
  base?: string;
}

/**
 * Compiles a single minimal Tailwind utility stylesheet from rendered HTML —
 * purely in-process (no CLI, no file watching, no temp files). Only the utility
 * classes actually present in the HTML are emitted, with brand colors/fonts
 * available as `bg-<token>` / `font-<token>` utilities.
 *
 * @param htmlStrings final rendered HTML of every page to scan for class names
 * @param theme       brand tokens mapped into the Tailwind `@theme`
 */
export async function compileUtilityCss(
  htmlStrings: readonly string[],
  theme: TailwindTheme = {},
  opts: CompileOptions = {},
): Promise<string> {
  const { minify = true, base = TAILWIND_BASE } = opts;

  // Extract the candidate class names actually used in the HTML (in-memory, no FS).
  const scanner = new Scanner({});
  const candidates = scanner.scanFiles(
    htmlStrings.map((content) => ({ content, extension: 'html' })),
  );

  // Include the DaisyUI component layer ONLY when the HTML actually uses a DaisyUI class —
  // pure-Tailwind pages stay at their minimal size. DaisyUI runs with `themes:false` (no
  // theme block of its own) and we supply the full var set, brand colors overriding the
  // palette, so `btn-primary` etc. are brand-themed with no cascade fight.
  // The nav/button EFFECT utilities are appended in both branches — they tree-shake per scheme
  // (only schemes whose class appears in the HTML are emitted), so they cost nothing when unused.
  const input = usesDaisyComponents(candidates)
    ? `${BASE_INPUT}\n@plugin "${DAISY_PLUGIN_PATH}" {\n  themes: false;\n  exclude: button;\n}${renderThemeBlock(daisyThemeVars(theme))}\n${EFFECT_UTILITIES}`
    : `${BASE_INPUT}${renderThemeBlock(brandVars(theme))}\n${EFFECT_UTILITIES}`;

  // Build the compiler (auto-resolves `@import "tailwindcss/*"` from node_modules).
  const compiler = await compile(input, { base, onDependency: () => {} });

  const css = compiler.build(candidates);
  return minify ? optimize(css, { minify: true }).code : css;
}
