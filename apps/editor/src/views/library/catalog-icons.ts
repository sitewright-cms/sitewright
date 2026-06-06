import { ICON_NAMES, iconBody } from '@sitewright/blocks';
import type { LibraryItem } from './catalog';

// The icon catalog — split out from `catalog.ts` so the Library can LAZY-load it
// (dynamic import) the first time the Icons modal opens, keeping the icon SVG set out
// of the initial editor bundle.

/** Wrap an icon body in the same <svg> the {{icon}} helper emits, for the preview. */
export function iconSvg(name: string, cls = 'h-6 w-6'): string {
  const body = iconBody(name) ?? '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Every icon in the pack, as a searchable Library item (name + inline SVG + insert snippet). */
export const ICON_ITEMS: LibraryItem[] = ICON_NAMES.map((name) => ({
  id: `icon-${name}`,
  name,
  keywords: 'icon svg lucide',
  description: `The “${name}” Lucide icon, inlined as an SVG.`,
  example: `{{icon "${name}" "h-5 w-5"}}`,
  svg: iconSvg(name),
}));
