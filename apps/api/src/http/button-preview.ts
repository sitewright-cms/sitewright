// The compiled button-preview stylesheet for the editor's "Button effects" settings modal — the
// platform `.btn` baseline (ripple/hover-fill/radius) + EVERY button utility (effects/shapes/accents)
// compiled once. Brand-AGNOSTIC: the utilities read `var(--sw-color-*)`, and the editor injects the
// project's brand vars into the preview iframe, so this is STATIC platform data — computed once + cached
// (same discipline as effect-forks). No tenant data participates.
import { BUTTON_EFFECTS, BUTTON_SHAPES, BUTTON_ACCENTS, DEFAULT_BRAND_COLORS } from '@sitewright/schema';
import { compileUtilityCss } from '@sitewright/tailwind';
import { baseStyles } from '@sitewright/blocks';

let cache: string | null = null;

/** The platform `.btn` baseline + all button utilities, compiled for the default brand (cached). */
export async function buttonPreviewCss(): Promise<string> {
  if (cache) return cache;
  const candidates = [
    'btn btn-primary btn-secondary btn-accent btn-neutral btn-ghost btn-outline btn-soft',
    ...BUTTON_EFFECTS.map((e) => `sw-btn-fx-${e}`),
    ...BUTTON_SHAPES.map((s) => `sw-btn-shape-${s}`),
    ...BUTTON_ACCENTS.map((a) => `sw-btn-accent-${a}`),
  ].join(' ');
  const utility = await compileUtilityCss([candidates], { colors: { ...DEFAULT_BRAND_COLORS } }, { minify: true });
  cache = `${baseStyles()}\n${utility}`;
  return cache;
}
