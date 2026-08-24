// HAND-AUTHORED icons — the one icon module that is NOT generated.
//
// simple-icons removed a set of marks at the brands' request (LinkedIn, Slack, Adobe, Microsoft…), so
// there is no CC0 path to inline for them. Until now the renderer fell back to a Lucide line icon of the
// same name — and Lucide 1.x drops those too, which would leave `{{sw-icon "linkedin"}}` rendering
// nothing at all on client footers where it is a staple. These are drawn here instead, so an upstream
// removal can never silently empty a published page again.
//
// Trademarks belong to their owners; these exist so a site can link to a profile on that network, which
// is what the mark is for. Keep this file free of generated data — `gen-lucide-icons.mjs` and
// `gen-brand-icons.mjs` rewrite their outputs wholesale and would erase anything parked there.

import { BRAND_ICON_NAMES, brandIcon, type BrandIcon } from './brand-icons.js';
import { escapeAttr } from './escape.js';
import { PHOSPHOR_WEIGHTS, type PhosphorWeight } from './phosphor-icons.js';

/**
 * A wordmark has no natural "thin" or "bold" cut the way a pictogram does, so a weighted vendored icon
 * is ONE letterform rendered six ways: outlined at the four Phosphor stroke widths, then filled. The
 * shape is identical across weights — only its treatment changes — so `linkedin:thin` and `linkedin:fill`
 * are unmistakably the same mark.
 *
 * Paths are authored on the brand's own 24-unit grid and scaled into Phosphor's 256 viewBox by the
 * wrapper, so the coordinates below can be compared against the official artwork directly. Stroke widths
 * are therefore given in 24-space too (Phosphor's 8/12/16/24 at 256 ÷ 32/3).
 */
const STROKE_W: Record<Exclude<PhosphorWeight, 'fill' | 'duotone'>, number> = {
  thin: 0.75,
  light: 1.125,
  regular: 1.5,
  bold: 2.25,
};

/** Phosphor's 256 viewBox over a 24-unit drawing. */
const SCALE = 256 / 24;

/** Render one 24-grid path as the six weight bodies Phosphor's map holds. */
function weightedBodies(raw: string): readonly string[] {
  // Escaped for the same reason the brand tile is escaped at its call site: this is the ONE hand-keyed
  // icon module, and a stray quote in a future entry should break loudly at review, not silently produce
  // a malformed attribute.
  const d = escapeAttr(raw);
  const wrap = (inner: string): string => `<g transform="scale(${SCALE.toFixed(6)})">${inner}</g>`;
  return PHOSPHOR_WEIGHTS.map((w) => {
    if (w === 'fill') return wrap(`<path d="${d}"/>`);
    // Duotone's convention is a full-strength shape over a 0.2 secondary. A wordmark has no secondary
    // form, so it doubles its own outline underneath — readable, and never a box the caller didn't ask for.
    if (w === 'duotone') {
      return wrap(`<path d="${d}" opacity="0.2"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="${STROKE_W.regular}" stroke-linejoin="round"/>`);
    }
    return wrap(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="${STROKE_W[w]}" stroke-linejoin="round" stroke-linecap="round"/>`);
  });
}

/** LinkedIn's "in" letterform WITHOUT the enclosing tile — the cut that sits inline with text. */
const LINKEDIN_MARK =
  'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286z' +
  'M5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065z' +
  'm1.782 13.019H3.555V9h3.564v11.452z';

/** The same letterform inside LinkedIn's rounded tile — the form used as a social-link badge. */
const LINKEDIN_TILE =
  `${LINKEDIN_MARK}M22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z`;

/**
 * Vendored WEIGHTED icons, keyed exactly like the Phosphor map so the renderer can consult one then the
 * other. These are the bare marks — no enclosing tile; the tile lives under `brand:` (see below).
 */
export const VENDORED_WEIGHTED: ReadonlyMap<string, readonly string[]> = new Map([
  ['linkedin', weightedBodies(LINKEDIN_MARK)],
]);

/**
 * Vendored BRAND tiles — the boxed, filled form, matching the shape of the simple-icons entries around
 * them (a single 24-viewBox path + the brand's own colour).
 */
export const VENDORED_BRAND: ReadonlyMap<string, BrandIcon> = new Map([
  ['linkedin', { title: 'LinkedIn', hex: '#0A66C2', path: LINKEDIN_TILE }],
]);

/**
 * Renamed and retired brand slugs, so a name already written into a published page keeps rendering.
 * `twitter` and `chrome` are the two the icon sets dropped from under us; both have an exact successor.
 */
export const BRAND_ALIASES: ReadonlyMap<string, string> = new Map([
  ['twitter', 'x'],
  ['chrome', 'googlechrome'],
  ['chromium', 'googlechrome'],
]);

/**
 * Bare NAMES that lost their artwork upstream and have no `<name>-logo` twin to fall back to, mapped to
 * the closest honest Phosphor glyph. Deliberately short: an alias that merely looks plausible ("chrome"
 * → a generic globe) teaches an author the wrong name and hides the breakage, so only entries where the
 * substitute means the SAME thing belong here.
 *   pocket      — the read-later service shut down in 2025 and left no mark; a bookmark is what it did.
 *   rail-symbol — a transit pictogram rather than a brand, so a train reads identically.
 */
export const NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['pocket', 'bookmark-simple'],
  ['rail-symbol', 'train-simple'],
  // ★ Twitter is X now, and this entry is load-bearing rather than cosmetic. Phosphor still ships the
  // retired BIRD as `twitter-logo`, and the bare-name chain tries `<name>-logo` before it ever consults
  // the brand aliases — so without this, `{{sw-icon "twitter"}}` keeps drawing the old bird while
  // `brand:twitter` correctly draws the X, and the two surfaces disagree. Targets `x-logo`, NOT `x`:
  // Phosphor's `x` is the close/times glyph, so aliasing there would silently swap a logo for a cross.
  ['twitter', 'x-logo'],
]);

/** The Phosphor stand-in for a retired bare name, or the name unchanged. */
export function resolveNameAlias(name: string): string {
  return NAME_ALIASES.get(name) ?? name;
}

/** The six weight bodies for a vendored icon, or undefined when it isn't one. */
export function vendoredWeightedBody(name: string, weight: PhosphorWeight): string | undefined {
  const bodies = VENDORED_WEIGHTED.get(name);
  if (!bodies) return undefined;
  const i = PHOSPHOR_WEIGHTS.indexOf(weight);
  return i >= 0 ? bodies[i] : undefined;
}

/** A vendored brand tile, resolving an alias first. */
export function vendoredBrand(slug: string): BrandIcon | undefined {
  return VENDORED_BRAND.get(slug);
}

/** The canonical slug for a renamed brand (`twitter` → `x`), or the slug unchanged. */
export function resolveBrandAlias(slug: string): string {
  return BRAND_ALIASES.get(slug) ?? slug;
}

/** Every vendored name, for the picker + search listings. */
export const VENDORED_WEIGHTED_NAMES: readonly string[] = [...VENDORED_WEIGHTED.keys()];
export const VENDORED_BRAND_NAMES: readonly string[] = [...VENDORED_BRAND.keys()];

/**
 * The brand list the PICKERS should show: the generated simple-icons set plus anything vendored here.
 * Listing only the generated set would leave a vendored mark renderable but unfindable — present in
 * `{{sw-icon}}` and absent from the library, which is how an author concludes it does not exist.
 */
export const BRAND_ICON_NAMES_ALL: readonly string[] = [...new Set([...BRAND_ICON_NAMES, ...VENDORED_BRAND.keys()])].sort();

/** Look up a brand tile from either set, resolving a retired slug first. */
export function anyBrandIcon(slug: string): BrandIcon | undefined {
  const s = resolveBrandAlias(slug);
  return VENDORED_BRAND.get(s) ?? brandIcon(s);
}
