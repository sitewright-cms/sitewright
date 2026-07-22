// The single source of truth for rendering an icon to an inline <svg> string. Used by the {{sw-icon}}
// Handlebars helper (template.ts), the seed's build-time `icon()` helper, and the editor's icon library
// previews — so every surface renders the SAME glyph via the SAME resolution chain.
//
// "name" is a PHOSPHOR icon; an optional ":weight" suffix picks the weight (thin|light|regular|bold|fill|
// duotone), DEFAULT fill — `gear` is a filled gear, `gear:bold` a bold one. `brand:<slug>` is a
// simple-icons filled logo. RESOLUTION per name: Phosphor(name) → Lucide-name→Phosphor alias → Lucide
// OUTLINE fallback — so a familiar/agent-written Lucide name still renders (its Phosphor twin where mapped,
// else a Lucide outline), never an invisible 0×0 gap. The emitted <svg> carries size-less class HOOKS
// `sw-icon sw-icon-<name> sw-icon-<weight>` (weight is `lucide` for a fallback) for styling; authored + CSS
// sizing still wins. Bodies come ONLY from the trusted build-time icon maps, never tenant markup; the name
// + class are attribute-escaped. viewBox is 256 for Phosphor, 24 for brand + the Lucide fallback.
import { iconBody } from './icons.js';
import { phosphorBody, isPhosphorName, PHOSPHOR_WEIGHTS, type PhosphorWeight } from './phosphor-icons.js';
import { aliasToPhosphor } from './icon-aliases.js';
import { brandIcon } from './brand-icons.js';
import { escapeAttr } from './escape.js';

const svgTag = (hooks: string, authorCls: string, attrs: string, body: string): string =>
  `<svg class="${escapeAttr(`sw-icon ${hooks} ${authorCls}`.trim())}" ${attrs} aria-hidden="true">${body}</svg>`;

function lucideSvg(name: string, authorCls: string): string | undefined {
  const body = iconBody(name);
  return body === undefined
    ? undefined
    : svgTag(
        `sw-icon-${name} sw-icon-lucide`,
        authorCls,
        'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
        body,
      );
}

function phosphorSvg(name: string, weight: PhosphorWeight, authorCls: string): string | undefined {
  const target = isPhosphorName(name) ? name : aliasToPhosphor(name);
  const body = target ? phosphorBody(target, weight) : undefined;
  return body ? svgTag(`sw-icon-${target} sw-icon-${weight}`, authorCls, 'viewBox="0 0 256 256" fill="currentColor"', body) : undefined;
}

/**
 * Render an icon to an inline `<svg>` string (empty string when the name resolves to nothing). `cls` is the
 * CSS class list added after the name/weight hooks; omit it (or pass undefined) to default to `h-5 w-5`,
 * pass `''` to let base CSS own the size.
 */
export function renderIconSvg(name: string, cls?: string): string {
  if (typeof name !== 'string') return '';
  const authorCls = typeof cls === 'string' ? cls : 'h-5 w-5';

  // brand:<slug> — a simple-icons filled logo; where simple-icons lacks the slug (e.g. linkedin, removed at
  // the brand's request) fall back to a Phosphor filled logo (`<slug>` / `<slug>-logo`), then a Lucide glyph.
  if (name.startsWith('brand:')) {
    const slug = name.slice('brand:'.length);
    const brand = brandIcon(slug);
    if (brand) return svgTag(`sw-icon-brand-${slug}`, authorCls, 'viewBox="0 0 24 24" fill="currentColor"', `<path d="${escapeAttr(brand.path)}"/>`);
    return phosphorSvg(slug, 'fill', authorCls) ?? phosphorSvg(`${slug}-logo`, 'fill', authorCls) ?? lucideSvg(slug, authorCls) ?? '';
  }

  // Parse an optional `<name>:<weight>` suffix (only when the trailing token is a real weight).
  let base = name;
  let weight: PhosphorWeight = 'fill';
  const colon = name.lastIndexOf(':');
  if (colon > 0 && (PHOSPHOR_WEIGHTS as readonly string[]).includes(name.slice(colon + 1))) {
    weight = name.slice(colon + 1) as PhosphorWeight;
    base = name.slice(0, colon);
  }
  return phosphorSvg(base, weight, authorCls) ?? lucideSvg(base, authorCls) ?? '';
}
