import { flagIcon, renderIconSvg } from '@sitewright/blocks';

/**
 * Resolve an icon NAME to an inline `<svg>` string.
 *
 * One resolver for the whole Studio, because the same artwork has to appear in three places and
 * agree in all of them: the picker's grid, the hotspot on the canvas, and — stored as `icon_svg` —
 * the hotspot the RUNTIME paints on the published page. A bundled runtime cannot resolve a name
 * against the platform's icon library, so the artwork travels with the config.
 *
 * Names are the platform's own spelling:
 *   `map-pin` / `map-pin:fill` / `map-pin:duotone`   Phosphor, optional weight
 *   `brand:github`                                    a simple-icons logo
 *   `flag:na` / `flag:na-circle`                      a country flag
 *
 * `currentColor` throughout, so the caller colours it by setting `color` — which is how one stored
 * icon serves both the resting and the hover fill without storing the artwork twice.
 */
export function iconSvg(name: string): string {
  if (typeof name !== 'string' || name === '') return '';
  if (name.startsWith(FLAG_PREFIX)) return flagSvg(name.slice(FLAG_PREFIX.length));
  // '' rather than the default h-5/w-5: the caller sizes it, in px, from `icon_size`.
  return renderIconSvg(name, '');
}

export const FLAG_PREFIX = 'flag:';

/**
 * A flag is NOT `currentColor` — it is its own artwork, in its own colours, and recolouring it would
 * be wrong. Rendered from the trusted build-time set; an unknown code yields nothing.
 */
function flagSvg(code: string): string {
  const circle = code.endsWith('-circle');
  const flag = flagIcon(circle ? code.slice(0, -'-circle'.length) : code);
  const shape = flag && (circle ? flag.circle : flag.rect);
  if (!flag || !shape) return '';
  return `<svg viewBox="${shape.viewBox}" role="img" aria-label="${flag.name}">${shape.body}</svg>`;
}

/** Does this icon draw in its own colours (a flag), rather than taking the hotspot's fill? */
export function iconIsSelfColoured(name: string): boolean {
  return typeof name === 'string' && name.startsWith(FLAG_PREFIX);
}
