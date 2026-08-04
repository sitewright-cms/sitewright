import { describe, expect, it } from 'vitest';
import { componentAssets, COMPONENT_TYPES } from '../src/components.js';

/**
 * THE CATALOG PROMISES: "every default is zero-specificity so utility classes still restyle it."
 *
 * This test makes that promise true instead of merely written down. It walks the whole component
 * stylesheet and fails on any rule that sets an author-facing VISUAL property at a weight a plain
 * author class cannot beat — unless the rule is on the allowlist below, with a reason.
 *
 * Why it exists: four separate clones shipped visibly wrong output because a platform default sat at
 * a specificity no author selector could reach, and in every case the author had written exactly the
 * right CSS and simply been overruled with no error. A Ken Burns caption kept a shadow it was told to
 * drop; five brand logos rendered at 73×73 against an original's 180×180; three contact fields
 * carrying the SAME `w-[60%]` came out 656/635/620px wide; a tab strip kept a 16px gap the author had
 * explicitly closed. Reading the stylesheet did not find these — measuring a clone did. So the sheet
 * is measured here on every run.
 */

// Properties an author restyles. Layout/structural ones (display, position, overflow, z-index) are
// out of scope: they are what makes a component work, not how it looks.
const VISUAL = new Set([
  'color', 'background', 'background-color', 'background-image', 'border', 'border-color', 'border-width',
  'border-radius', 'box-shadow', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'padding-inline', 'padding-block', 'margin', 'margin-top', 'margin-bottom', 'margin-inline', 'margin-block',
  'font', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-transform',
  'text-align', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'gap', 'opacity',
  'filter', 'backdrop-filter', 'object-fit', 'flex-wrap', 'text-decoration',
]);

// A rule may legitimately be firm when it expresses a STATE or an a11y guarantee rather than a look.
const STATEFUL =
  /:hover|:focus|:active|:disabled|\[disabled\]|\[open\]|\[aria-selected|\[aria-expanded|\[aria-current|::backdrop|sr-only|\.vc|\[data-vc|::-webkit|:checked|prefers-reduced-motion/;

/**
 * Rules that stay firm ON PURPOSE. Each needs a reason, because "it was already like that" is how
 * the four defects above got in.
 */
const ALLOWED: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\.sw-lightbox-/, 'vendored SmartPhoto CSS + our overrides OF it — zeroing ours would hand the vendor the win'],
  [
    /\.sw-imap-/,
    "the Image Map's own chrome (canvas, tooltips, object list, zoom/fullscreen controls). Same case as " +
      'sw-lightbox: this is vendored widget-internal CSS plus our re-skin OF it, and zeroing ours would ' +
      'hand the vendor sheet the win. Crucially the map is not styled with utilities at all — every ' +
      "colour, size and radius a hotspot or tooltip uses comes from the map's CONFIG, which is the " +
      'documented way to restyle it. The author-facing surface is the root [data-sw-component="image-map"], ' +
      'which sets no visual property.',
  ],
  [/\[data-sw-part="container"\]|\[data-sw-part="track"\]|\[data-sw-part="slide"\]/, 'Embla mechanics: the track is the flex row and a slide must be able to shrink'],
  [/data-kenburns/, 'the Ken Burns layer must fill its slide for the pan to work at all'],
  [/\[data-sw-part="dots"\] button$/, 'the dot BOX (display/cursor/border-reset) — its look is softened separately'],
  [/dialog/, 'the <dialog> is the full-viewport scroller; its box IS the modal mechanism'],
  [/data-sw-modal-scrim/, 'one shared scrim across a modal swap — its opacity is lifecycle state, not decoration'],
  [/\[data-sw-part="tabindicator"\]/, 'the pill starts at zero size so it never flashes at 0,0 before the runtime measures it'],
  [/data-position=/, 'a banner POSITION variant — the geometry is the variant'],
  [/data-sw-banner-shown|banner"\]:not\(\[data-sw-animation\]\)/, 'show/hide state'],
  [/\[data-sw-part="hp"\]/, 'the honeypot must stay invisible — an author "fixing" its size defeats the spam trap'],
  [/input\[type=checkbox\]|input\[type=radio\]/, 'the exception that must keep outranking the general field rule'],
];

const specificity = (selector: string): number => {
  const bare = selector.replace(/:where\([^)]*\)/g, ' ');
  const ids = (bare.match(/#[\w-]+/g) ?? []).length;
  const classish =
    (bare.match(/\.[\w-]+/g) ?? []).length +
    (bare.match(/\[[^\]]+\]/g) ?? []).length +
    (bare.match(/:(?!:)(?!where)[\w-]+/g) ?? []).length;
  return ids * 100 + classish * 10;
};

describe('platform visual defaults stay beatable by author CSS', () => {
  it('sets no author-facing visual property above class weight, outside the documented exceptions', () => {
    const { css } = componentAssets([...COMPONENT_TYPES]);
    const offenders: string[] = [];

    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]!.trim();
      if (selector.startsWith('@') || selector.startsWith('/*')) continue;
      if (selector.trimStart().startsWith(':where(')) continue; // already a default
      if (STATEFUL.test(selector)) continue;
      if (ALLOWED.some(([re]) => re.test(selector))) continue;

      const visual = match[2]!
        .split(';')
        .map((d) => d.split(':')[0]!.trim().toLowerCase())
        .filter((p) => VISUAL.has(p));
      // (0,1,0) or less: an author's own `.thing .part` rule ties or wins, which is fair.
      if (visual.length && specificity(selector) > 10) {
        offenders.push(`${selector.slice(0, 90)} → ${visual.join(', ')}`);
      }
    }

    expect(
      offenders,
      `These set a visual property an author cannot override. Either wrap the selector in :where() or ` +
        `add it to ALLOWED with the reason it must stay firm:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the four defects that motivated this are actually fixed', () => {
    const { css } = componentAssets(['Carousel', 'Form', 'Tabs']);
    // Ken Burns caption shadow, slide image sizing, form field width, tablist gap — each one shipped
    // a wrong clone before it was softened.
    expect(css).toMatch(/:where\([^)]*data-kenburns[^)]*\.sw-caption\)\{[^}]*drop-shadow/);
    expect(css).toMatch(/:where\([^)]*\[data-sw-part="slide"\] img[^)]*\)/);
    expect(css).toMatch(/:where\(\[data-sw-block="Form"\] input[^)]*\)\{width:100%/);
    expect(css).toMatch(/:where\([^)]*\[data-sw-part="tablist"\]\)\{[^}]*margin-bottom/);
  });
});
