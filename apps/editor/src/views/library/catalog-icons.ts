import { ICON_NAMES, iconBody, iconTags, BRAND_ICON_NAMES, brandIcon, FLAG_CODES, flagIcon } from '@sitewright/blocks';
import type { LibraryItem } from './catalog';

// The icon catalogs — split out from `catalog.ts` so the Library can LAZY-load them
// (dynamic import) the first time the Icons / Brand-icons modals open, keeping the large
// icon set out of the initial editor bundle.

/** Wrap a stroke icon body in the same <svg> the {{sw-icon}} helper emits, for the preview. */
export function iconSvg(name: string, cls = 'h-6 w-6'): string {
  const body = iconBody(name) ?? '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Wrap a brand (fill) icon path in a current-color <svg> for the preview. */
function brandSvg(path: string, cls = 'h-6 w-6'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}" /></svg>`;
}

/** Every Lucide icon in the pack, searchable by name + lucide's own keyword tags. */
export const ICON_ITEMS: LibraryItem[] = ICON_NAMES.map((name) => ({
  id: `icon-${name}`,
  name,
  keywords: `icon lucide ${iconTags(name)}`,
  description: `The “${name}” Lucide icon.`,
  example: `{{sw-icon "${name}" "h-5 w-5"}}`,
  svg: iconSvg(name),
}));

/** The built-in brand/social logos — inserted with the `brand:` prefix. */
export const BRAND_ITEMS: LibraryItem[] = BRAND_ICON_NAMES.map((slug) => {
  const b = brandIcon(slug)!;
  return {
    id: `brand-${slug}`,
    name: b.title,
    keywords: `brand logo social ${slug}`,
    description: `The ${b.title} brand logo (inline SVG).`,
    example: `{{sw-icon "brand:${slug}" "h-6 w-6"}}`,
    svg: brandSvg(b.path),
  };
});

/** Wrap a flag's full-color body in its native-viewBox <svg> for the preview (keeps its own fills). */
function flagSvg(viewBox: string, body: string, cls = 'h-6'): string {
  return `<svg class="${cls}" viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;
}

/** The built-in country flags — inserted with the `{{sw-flag}}` helper; `-circle` for the round variant. */
export const FLAG_ITEMS: LibraryItem[] = FLAG_CODES.map((code) => {
  const f = flagIcon(code)!;
  return {
    id: `flag-${code}`,
    name: f.name,
    keywords: `flag country nation ${code} ${f.name}`,
    description: f.circle
      ? `${f.name} (${code.toUpperCase()}) — rectangular. Use "${code}-circle" for the round variant.`
      : `${f.name} (${code.toUpperCase()}) — rectangular only (no circular variant).`,
    example: `{{sw-flag "${code}" "h-4"}}`,
    svg: flagSvg(f.rect.viewBox, f.rect.body),
  };
});
