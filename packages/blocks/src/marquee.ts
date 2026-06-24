// A CSS-ONLY logo marquee: a horizontally auto-scrolling strip of logos/images, with no JavaScript.
// Marked by `data-sw-marquee` on the viewport; the inner `.sw-marquee-track` holds the items TWICE (the
// authoring snippet/widget renders the loop twice) so a `translateX(-50%)` keyframe scrolls seamlessly.
// Like the animation/lazyload runtimes, the CSS only ships when a rendered surface actually uses the marker.
//
// Tunable via CSS custom properties on the viewport (so a widget/nativizer can set them inline):
//   --sw-marquee-duration  scroll period          (default 32s)
//   --sw-marquee-height    logo height             (default 4rem)
//   --sw-marquee-gap       space between logos      (default 3rem)
// Honors prefers-reduced-motion (stops + wraps to a static centered row) and pauses on hover.

export const MARQUEE_MARKER = 'data-sw-marquee';

export const MARQUEE_CSS = [
  // viewport: clip the moving track, fade the two edges so logos enter/leave softly
  '[data-sw-marquee]{overflow:hidden;width:100%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}',
  // track: a single flowing row (items rendered twice); scrolls one full set then repeats
  '[data-sw-marquee] .sw-marquee-track{display:flex;width:max-content;flex-wrap:nowrap;align-items:center;gap:var(--sw-marquee-gap,3rem);animation:sw-marquee var(--sw-marquee-duration,32s) linear infinite;will-change:transform}',
  '[data-sw-marquee]:hover .sw-marquee-track{animation-play-state:paused}',
  // speed presets (widget `speed` select → data-speed); Normal = the default duration above
  '[data-sw-marquee][data-speed="Slow"] .sw-marquee-track{--sw-marquee-duration:52s}',
  '[data-sw-marquee][data-speed="Fast"] .sw-marquee-track{--sw-marquee-duration:18s}',
  // item: a uniform, non-shrinking cell; the logo is height-locked so a tall/short asset can never deform the row
  '[data-sw-marquee] .sw-marquee-item{flex:0 0 auto;display:flex;align-items:center;justify-content:center}',
  '[data-sw-marquee] .sw-marquee-item img{height:var(--sw-marquee-height,4rem);width:auto;max-width:none;object-fit:contain}',
  '@keyframes sw-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
  // reduced motion: no scroll — fall back to a static, centered, wrapping row (and drop the duplicate set)
  '@media (prefers-reduced-motion:reduce){[data-sw-marquee] .sw-marquee-track{animation:none;flex-wrap:wrap;justify-content:center;width:100%}[data-sw-marquee] [data-sw-marquee-dup]{display:none}}',
].join('\n');

/** True when a rendered surface uses the marquee → its CSS should be bundled. */
export function usesMarquee(html: string | null | undefined): boolean {
  return !!html && html.includes(MARQUEE_MARKER);
}
