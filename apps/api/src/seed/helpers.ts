import type { Entry } from '@sitewright/schema';
import { iconBody } from '@sitewright/blocks';

/**
 * Inline one of the platform's built-in icons (the curated Lucide set in `@sitewright/blocks`) as
 * an SVG, matching the `Icon` block's wrapper so code-first pages share the same icon vocabulary.
 * `cls` controls the size/color (Tailwind, e.g. `h-5 w-5 text-primary`). Unknown names render
 * nothing. The markup is a build-time constant (no interpolation) so it passes the no-JS validator.
 */
export function icon(name: string, cls: string): string {
  const body = iconBody(name);
  if (!body) return '';
  return (
    `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  );
}

/** Five filled stars — a rating row, built from the icon set. */
export const STARS = Array.from({ length: 5 }, () => icon('star', 'h-4 w-4 fill-current')).join('');

export const pub = (dataset: string, id: string, values: Record<string, unknown>): Entry => ({
  id,
  dataset,
  status: 'published',
  values,
});

export const placeholderRoot = { id: 'root', type: 'Section' as const };
