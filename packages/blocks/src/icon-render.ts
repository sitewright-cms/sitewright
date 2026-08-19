// The single source of truth for rendering an icon to an inline <svg> string. Used by the {{sw-icon}}
// Handlebars helper (template.ts), the seed's build-time `icon()` helper, and the editor's icon library
// previews — so every surface renders the SAME glyph via the SAME resolution chain.
//
// "name" is a PHOSPHOR icon; an optional ":weight" suffix picks the weight (thin|light|regular|bold|fill|
// duotone), DEFAULT fill — `gear` is a filled gear, `gear:bold` a bold one. `brand:<slug>` is a
// simple-icons filled logo, and `flag:<cc>` a FULL-COLOR country flag (`flag:<cc>-circle` = the round
// variant). RESOLUTION per name: Phosphor(name) → Lucide-name→Phosphor alias → Lucide
// OUTLINE fallback — so a familiar/agent-written Lucide name still renders (its Phosphor twin where mapped,
// else a Lucide outline), never an invisible 0×0 gap. The emitted <svg> carries size-less class HOOKS
// `sw-icon sw-icon-<name> sw-icon-<weight>` (weight is `lucide` for a fallback) for styling; authored + CSS
// sizing still wins. Bodies come ONLY from the trusted build-time icon maps, never tenant markup; the name
// + class are attribute-escaped. viewBox is 256 for Phosphor, 24 for brand + the Lucide fallback, and the
// flag set's own for a flag.
import { iconBody } from './icons.js';
import { phosphorBody, isPhosphorName, PHOSPHOR_WEIGHTS, type PhosphorWeight } from './phosphor-icons.js';
import { aliasToPhosphor } from './icon-aliases.js';
import { brandIcon } from './brand-icons.js';
import { flagIcon } from './flag-icons.js';
import { escapeAttr, escapeHtml } from './escape.js';

const svgTag = (hooks: string, authorCls: string, attrs: string, body: string): string =>
  `<svg class="${escapeAttr(`sw-icon ${hooks} ${authorCls}`.trim())}" ${attrs} aria-hidden="true">${body}</svg>`;

/** The `flag:` prefix that selects a country flag inside an {@link renderIconSvg} name. */
export const FLAG_PREFIX = 'flag:';
/** The suffix on a flag code that selects the ROUND variant (`flag:de-circle`). */
export const FLAG_CIRCLE_SUFFIX = '-circle';

/**
 * Render `flag:<cc>` / `flag:<cc>-circle` — a full-colour country flag.
 *
 * Flags are the one set that does NOT draw in `currentColor`: they carry their own fills (a flag
 * recoloured to the text colour is a blob), so they are also the one set that is not `aria-hidden`.
 * A flag says something — the country — so it gets `role="img"` + an `aria-label`/`<title>` naming it.
 *
 * The two shapes have DIFFERENT natural sizes, so an omitted class defaults per shape: `h-4` for the
 * 4:3 rectangle (width follows the aspect ratio) and `h-5 w-5` for the square circle. Passing `''`
 * still hands sizing to CSS, exactly as it does for every other icon.
 */
function flagSvg(spec: string, cls?: string): string {
  const circle = spec.endsWith(FLAG_CIRCLE_SUFFIX);
  const code = (circle ? spec.slice(0, -FLAG_CIRCLE_SUFFIX.length) : spec).toLowerCase();
  const flag = flagIcon(code);
  const shape = flag && (circle ? flag.circle : flag.rect);
  if (!flag || !shape) return '';
  const authorCls = typeof cls === 'string' ? cls : circle ? 'h-5 w-5' : 'h-4';
  const hooks = `sw-icon-flag-${code} sw-icon-flag-${circle ? 'circle' : 'rect'}`;
  return (
    `<svg class="${escapeAttr(`sw-icon ${hooks} ${authorCls}`.trim())}" viewBox="${escapeAttr(shape.viewBox)}" ` +
    `role="img" aria-label="${escapeAttr(flag.name)}"><title>${escapeHtml(flag.name)}</title>${shape.body}</svg>`
  );
}

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
 * CSS class list added after the name/weight hooks; omit it (or pass undefined) to default to `h-5 w-5`
 * (a flag defaults per shape — see {@link flagSvg}), pass `''` to let base CSS own the size.
 */
export function renderIconSvg(name: string, cls?: string): string {
  if (typeof name !== 'string') return '';

  // flag:<cc> — a full-colour country flag. Checked BEFORE the author-class default is resolved,
  // because the two flag shapes have their own defaults and `h-5 w-5` would squash the 4:3 rectangle.
  if (name.startsWith(FLAG_PREFIX)) return flagSvg(name.slice(FLAG_PREFIX.length), cls);

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
  // NO bare-country-code fallback. One briefly existed so that `{{sw-icon (lookup locale_flags locale)}}`
  // could resolve a stored `{ en: "gb" }` map — at the time a template could not concatenate at all, so it had no way to add
  // the `flag:` prefix itself. It was safe in the sense that it could never SHADOW an icon (it ran last),
  // but it turned 249 of the 251 two-letter codes from an empty render into a WRONG one: `{{sw-icon "id"}}`
  // drew the Indonesian flag, and `me`/`in`/`no`/`so`/`to`/`is`/`it`/`be`/`do` likewise. An empty render is
  // the clearer failure. The need vanished with {{sw-flag}} restored as a first-class helper — a DYNAMIC
  // flag is written `{{sw-flag (lookup …)}}`, which takes the bare code by design.
  return phosphorSvg(base, weight, authorCls) ?? lucideSvg(base, authorCls) ?? '';
}
