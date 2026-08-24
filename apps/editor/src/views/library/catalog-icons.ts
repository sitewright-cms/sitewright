import { BRAND_ICON_NAMES_ALL, anyBrandIcon, FLAG_CODES, flagIcon } from '@sitewright/blocks';
import type { LibraryItem } from './catalog';

// Brand + flag catalogs — split out so the Library LAZY-loads them (dynamic import) the first time their
// modal opens. NOTE: the large PHOSPHOR icon set is deliberately NOT bundled here — its previews are
// rendered server-side (GET /authoring/icons/names + /render) by the editor's IconsTab, so the multi-MB
// icon-body data never lands in the editor bundle. This module must therefore NEVER import renderIconSvg /
// the Phosphor data (that was a ~3.9MB main-bundle regression).

/** Wrap a brand (fill) icon path in a current-color <svg> for the preview. The path is trusted, static
 *  simple-icons data (numeric SVG commands, no user input); the `"`-escape is defense-in-depth. */
function brandSvg(path: string, cls = 'h-6 w-6'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path.replace(/"/g, '&quot;')}" /></svg>`;
}

/** The built-in brand/social logos — inserted with the `brand:` prefix. */
export const BRAND_ITEMS: LibraryItem[] = BRAND_ICON_NAMES_ALL.map((slug) => {
  const b = anyBrandIcon(slug)!;
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

/** The two shapes every flag is drawn in. A handful of flags ship only the rectangle. */
export type FlagShapeKey = 'rect' | 'circle';

/** How each shape is labelled + what the snippet spells — one place, so the pills and the copied
 *  snippet can never disagree about which variant is on screen. */
export const FLAG_SHAPES: { id: FlagShapeKey; label: string; suffix: string; cls: string }[] = [
  { id: 'rect', label: 'Rectangular', suffix: '', cls: 'h-4' },
  { id: 'circle', label: 'Round', suffix: '-circle', cls: 'h-5 w-5' },
];

/**
 * The built-in country flags in ONE shape — inserted with `{{sw-icon "flag:<code>"}}`.
 *
 * The circular set is a SUBSET: five flags have no round variant upstream, and listing them under
 * "Round" with their rectangle drawn instead would hand the author a snippet whose preview lies. So
 * the round tab simply omits them, and its count says how many there are.
 */
export function flagItems(shape: FlagShapeKey): LibraryItem[] {
  const def = FLAG_SHAPES.find((s) => s.id === shape)!;
  return FLAG_CODES.flatMap((code) => {
    const f = flagIcon(code)!;
    const art = shape === 'circle' ? f.circle : f.rect;
    if (!art) return [];
    return [
      {
        id: `flag-${shape}-${code}`,
        name: f.name,
        keywords: `flag country nation ${code} ${f.name}`,
        description: `${f.name} (${code.toUpperCase()}) — ${def.label.toLowerCase()}.`,
        example: `{{sw-flag "${code}${def.suffix}" "${def.cls}"}}`,
        svg: flagSvg(art.viewBox, art.body, shape === 'circle' ? 'h-6 w-6' : 'h-6'),
      },
    ];
  });
}

/** A sample glyph per shape for the switcher pills — the EU flag, which ships in both. */
export const FLAG_SHAPE_SAMPLES: Record<FlagShapeKey, string> = {
  rect: sampleFlag('rect'),
  circle: sampleFlag('circle'),
};

function sampleFlag(shape: FlagShapeKey): string {
  const f = flagIcon('eu') ?? flagIcon(FLAG_CODES[0] ?? '');
  const art = f && (shape === 'circle' ? f.circle : f.rect);
  return art ? flagSvg(art.viewBox, art.body, shape === 'circle' ? 'h-5 w-5' : 'h-5') : '';
}
