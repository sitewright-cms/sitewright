import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import type { TailwindTheme } from './theme.js';
import { TAILWIND_INPUT_BASE, utilityInput } from './compile.js';
import { effectClassNames } from './effects.js';

/**
 * Answers "does this class compile to at least one rule in the utility sheet?" — per class, exactly, by
 * asking Tailwind's own design system. A class scan of RENDERED author content turns up plenty that is not
 * a utility (an imported blog's `wp-image-1234`, `aligncenter`, the platform's own `sw-icon-*`), and a
 * bounded candidate set must not let those crowd out the classes that are.
 */
export interface UtilityProbe {
  /** One answer per candidate, in order. */
  produces(candidates: readonly string[]): boolean[];
}

/** The class name an effect scheme is matched on: the part after any variants (`md:sw-btn-fx-lift`). */
function schemeName(candidate: string): string {
  return candidate.slice(candidate.lastIndexOf(':') + 1);
}

/**
 * A verdict needing no compiler, or undefined. An effect scheme class always compiles (outside Tailwind,
 * see `effectCss`); any other class in the platform's `sw-` namespace never does — Tailwind has no `sw`
 * root, and those classes (`sw-icon`, `sw-h2`, …) are styled by the platform's own sheets. Most of what a
 * rendered page carries beyond its source is the latter, so this spares loading the probe for most sites.
 */
export function knownUtilityVerdict(candidate: string): boolean | undefined {
  const name = schemeName(candidate);
  if (effectClassNames().has(name)) return true;
  if (candidate.startsWith('sw-')) return false;
  return undefined;
}

/**
 * A probe for `theme`, read against the DaisyUI-enabled input — the SUPERSET of the two inputs
 * `compileUtilityCss` chooses between, so a class the sheet can compile is never reported as junk. (The
 * converse can over-report: a DaisyUI theme colour like `bg-base-100`, on a page set with no DaisyUI
 * component and no brand colour of that name, compiles to nothing.) Loading costs one design-system build
 * (~80 ms), so callers create it lazily, only once a class actually needs asking about.
 */
export async function createUtilityProbe(theme: TailwindTheme = {}): Promise<UtilityProbe> {
  const design = await __unstable__loadDesignSystem(utilityInput(theme, true), { base: TAILWIND_INPUT_BASE });
  return {
    produces(candidates) {
      const css = design.candidatesToCss([...candidates]);
      return candidates.map((c, i) => Boolean(css.at(i)) || effectClassNames().has(schemeName(c)));
    },
  };
}
