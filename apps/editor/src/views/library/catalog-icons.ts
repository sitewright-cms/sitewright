import { BRAND_ICON_NAMES, brandIcon, FLAG_CODES, flagIcon } from '@sitewright/blocks';
import type { LibraryItem } from './catalog';

// Brand + flag catalogs — split out so the Library LAZY-loads them (dynamic import) the first time their
// modal opens. NOTE: the large PHOSPHOR icon set is deliberately NOT bundled here — its previews are
// rendered server-side (GET /authoring/icons/names + /render) by the editor's IconGallery, so the multi-MB
// icon-body data never lands in the editor bundle. This module must therefore NEVER import renderIconSvg /
// the Phosphor data (that was a ~3.9MB main-bundle regression).

/** Wrap a brand (fill) icon path in a current-color <svg> for the preview. */
function brandSvg(path: string, cls = 'h-6 w-6'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}" /></svg>`;
}

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
