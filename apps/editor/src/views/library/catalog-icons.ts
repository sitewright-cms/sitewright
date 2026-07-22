import { PHOSPHOR_NAMES, type PhosphorWeight, renderIconSvg, BRAND_ICON_NAMES, brandIcon, FLAG_CODES, flagIcon } from '@sitewright/blocks';
import type { LibraryItem } from './catalog';

// The icon catalogs — split out from `catalog.ts` so the Library can LAZY-load them
// (dynamic import) the first time the Icons / Brand-icons modals open, keeping the large
// icon set out of the initial editor bundle.

/** Render an icon EXACTLY as the {{sw-icon}} helper does (shared renderer), for the preview. `weight`
 *  selects the Phosphor weight shown in the library (the picker row); default fill. */
export function iconSvg(name: string, cls = 'h-6 w-6', weight: PhosphorWeight = 'fill'): string {
  return renderIconSvg(`${name}:${weight}`, cls);
}

/** Every Phosphor icon, searchable by name. `example` inserts the fill default; add `:weight` for others. */
export const ICON_ITEMS: LibraryItem[] = PHOSPHOR_NAMES.map((name) => ({
  id: `icon-${name}`,
  name,
  keywords: `icon phosphor ${name.replace(/-/g, ' ')}`,
  description: `The “${name}” Phosphor icon — filled by default; add :bold / :duotone / :regular etc. for another weight.`,
  example: `{{sw-icon "${name}" "h-5 w-5"}}`,
  svg: iconSvg(name),
}));

/** The built-in brand/social logos — inserted with the `brand:` prefix (rendered via the shared renderer). */
export const BRAND_ITEMS: LibraryItem[] = BRAND_ICON_NAMES.map((slug) => {
  const b = brandIcon(slug)!;
  return {
    id: `brand-${slug}`,
    name: b.title,
    keywords: `brand logo social ${slug}`,
    description: `The ${b.title} brand logo (inline SVG).`,
    example: `{{sw-icon "brand:${slug}" "h-6 w-6"}}`,
    svg: renderIconSvg(`brand:${slug}`, 'h-6 w-6'),
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
