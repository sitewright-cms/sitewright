import type { Entry } from '@sitewright/schema';
import { renderIconSvg } from '@sitewright/blocks';

/**
 * Inline one of the platform's built-in icons as an SVG via the SHARED renderer — the SAME resolution the
 * {{sw-icon}} helper uses: a Phosphor glyph (FILL by default; a `name:weight` suffix picks a weight), with
 * a Lucide→Phosphor alias then a Lucide-outline fallback. `cls` controls size/colour (Tailwind, e.g.
 * `h-5 w-5 text-primary`). Unknown names render nothing. The markup is a build-time constant (no
 * interpolation) so it passes the no-JS validator.
 */
export function icon(name: string, cls: string): string {
  return renderIconSvg(name, cls);
}

/** Five filled stars — a rating row, built from the icon set. */
export const STARS = Array.from({ length: 5 }, () => icon('star', 'h-4 w-4 fill-current')).join('');

export const pub = (dataset: string, id: string, values: Record<string, unknown>): Entry => ({
  id,
  dataset,
  status: 'published',
  values,
});
