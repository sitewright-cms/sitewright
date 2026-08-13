import { FLAG_PREFIX, renderIconSvg } from '@sitewright/blocks';

export { FLAG_PREFIX };

/**
 * Resolve an icon NAME to an inline `<svg>` string.
 *
 * One resolver for the whole Studio, because the same artwork has to appear in three places and
 * agree in all of them: the picker's grid, the hotspot on the canvas, and — stored as `icon_svg` —
 * the hotspot the RUNTIME paints on the published page. A bundled runtime cannot resolve a name
 * against the platform's icon library, so the artwork travels with the config.
 *
 * Names are the platform's own spelling — the SAME names {{sw-icon}} takes, which is the point: the
 * Studio, the picker and a hand-written template all address one library.
 *   `map-pin` / `map-pin:fill` / `map-pin:duotone`   Phosphor, optional weight
 *   `brand:github`                                    a simple-icons logo
 *   `flag:na` / `flag:na-circle`                      a country flag (its own colours, not currentColor)
 *
 * `currentColor` for everything except a flag, so the caller colours it by setting `color` — which is
 * how one stored icon serves both the resting and the hover fill without storing the artwork twice.
 * A flag is its own artwork in its own colours; recolouring it would be wrong, so it ignores that.
 */
export function iconSvg(name: string): string {
  if (typeof name !== 'string' || name === '') return '';
  // '' rather than the default h-5/w-5: the caller sizes it, in px, from `icon_size`.
  return renderIconSvg(name, '');
}

/** Does this icon draw in its own colours (a flag), rather than taking the hotspot's fill? */
export function iconIsSelfColoured(name: string): boolean {
  return typeof name === 'string' && name.startsWith(FLAG_PREFIX);
}
