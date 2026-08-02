import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import type { TailwindTheme } from './theme.js';
import { brandVars, renderThemeBlock } from './tokens.js';
import { DAISY_EXCLUDED, DAISY_PLUGIN_PATH, daisyThemeVars, usesDaisyComponents } from './daisy.js';
import { effectCss } from './effects.js';

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
  const input = usesDaisyComponents(candidates)
    ? `${BASE_INPUT}\n@plugin "${DAISY_PLUGIN_PATH}" {\n  themes: false;\n  exclude: ${DAISY_EXCLUDED.join(', ')};\n}${renderThemeBlock(daisyThemeVars(theme))}`
    : `${BASE_INPUT}${renderThemeBlock(brandVars(theme))}`;

  // Build the compiler (auto-resolves `@import "tailwindcss/*"` from node_modules).
  const compiler = await compile(input, { base, onDependency: () => {} });

  const css = compiler.build(candidates);
  // daisyUI's `.loading` spinner utility hard-sets `pointer-events:none`. On a REPLACED media element
  // (the importer uses `.loading` as a lazy-media skeleton on a self-hosted PDF/video <iframe>) that class
  // persists after load and makes the embedded viewer un-scrollable / un-clickable. Drop it from the
  // standalone `.loading{…}` rule only — a real spinner has nothing to click anyway.
  const deSpun = css.replace(/(\.loading\s*\{[^}]*?)pointer-events\s*:\s*none\s*;?/g, '$1');

  // The nav/button EFFECT schemes are compiled SEPARATELY and appended, for two reasons.
  //   1. They belong in `@layer sw-effects` — a scheme selector reaches (0,4,1), which no author
  //      selector beats, and layered declarations lose to any unlayered rule whatever its
  //      specificity. Tailwind emits `@utility` output UNLAYERED, so it cannot produce that.
  //   2. Tailwind PRUNES a top-level `@keyframes` it does not see referenced from a utility it
  //      emitted. Feeding it raw layered CSS that animates `sw-btn-pulse` silently dropped the
  //      keyframes while keeping the `animation:` that needs them — a dead animation, no warning.
  //      Compiling this block outside Tailwind removes that coupling entirely.
  // Tree-shaking is ours now: a candidate can carry variants (`md:sw-btn-fx-lift`), so compare on the
  // last segment — the same rule daisy.ts uses. Lightning CSS flattens the `&` nesting either way, so
  // the unminified output is as browser-ready as the minified one.
  const used = new Set(candidates.map((c) => c.slice(c.lastIndexOf(':') + 1)));
  const out = `${deSpun}\n${effectCss((name) => used.has(name))}`;
  return minify ? optimize(out, { minify: true }).code : out;
}
