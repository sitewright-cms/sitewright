// Map an imported site's FontAwesome icon class to a platform {{sw-icon}} name. This is the first
// CATALOG-AWARE piece of the productionized nativizer: instead of a hard-coded FA→name table (which
// always lags), normalize the FA class and match it against the platform's ACTUAL icon sets — Lucide
// (`ICON_NAMES`, stroke glyphs) and brand/social logos (`BRAND_ICON_NAMES`, simple-icons). Most FA names
// equal the Lucide name (phone/star/user/…); only genuine naming differences need an alias entry.
//
// Returns a bare Lucide name (`"briefcase"`), a `brand:<slug>` social name, or null when there is no
// equivalent (the caller keeps the original markup). Pure + dependency-light so it can run server-side in
// the import pipeline and be unit-tested without a browser.
import { ICON_NAMES, BRAND_ICON_NAMES } from '@sitewright/blocks';

const LUCIDE = new Set<string>(ICON_NAMES);
const BRANDS = new Set<string>(BRAND_ICON_NAMES);

/** FA → Lucide aliases ONLY where the names genuinely differ (a direct name match needs no entry). */
const ICON_ALIAS: Readonly<Record<string, string>> = {
  suitcase: 'briefcase', envelope: 'mail', 'paper-plane': 'send', 'map-marker': 'map-pin',
  'location-arrow': 'navigation', 'location-dot': 'map-pin', bars: 'menu', times: 'x', close: 'x', xmark: 'x',
  'check-circle': 'circle-check', 'times-circle': 'circle-x', 'pencil-square': 'square-pen', edit: 'square-pen',
  'pen-to-square': 'square-pen', cog: 'settings', gear: 'settings', cogs: 'settings', tachometer: 'gauge',
  'life-ring': 'life-buoy', home: 'house', trash: 'trash-2', 'info-circle': 'info',
  'exclamation-circle': 'circle-alert', 'exclamation-triangle': 'triangle-alert', 'question-circle': 'circle-help',
  comment: 'message-square', comments: 'message-square', mobile: 'smartphone', 'eye-slash': 'eye-off',
  unlock: 'lock-open', 'bar-chart': 'chart-column', 'line-chart': 'chart-line', 'pie-chart': 'chart-pie',
  'quote-left': 'quote', 'quote-right': 'quote', headset: 'headphones', 'angle-right': 'chevron-right',
  'angle-left': 'chevron-left', 'angle-up': 'chevron-up', 'angle-down': 'chevron-down',
  'angle-double-right': 'chevrons-right', 'angle-double-left': 'chevrons-left', 'sign-in': 'log-in',
  'sign-out': 'log-out', 'plus-circle': 'circle-plus', 'minus-circle': 'circle-minus', dollar: 'dollar-sign',
  usd: 'dollar-sign', picture: 'image', photo: 'image', 'paint-brush': 'paintbrush', magic: 'wand-sparkles',
  bolt: 'zap', flash: 'zap', file: 'file-text', 'thumbs-o-up': 'thumbs-up',
};

/** FA social → simple-icons brand slug, only where they differ from the bare name. */
const BRAND_ALIAS: Readonly<Record<string, string>> = {
  twitter: 'x', 'x-twitter': 'x', 'facebook-f': 'facebook', 'facebook-square': 'facebook',
  'facebook-official': 'facebook', 'youtube-play': 'youtube', 'youtube-square': 'youtube', 'pinterest-p': 'pinterest',
};

// FA sizing/style/animation modifiers (fa-2x, fa-fw, fa-spin, …) — NOT the icon name.
const FA_MODIFIER = /^(\d+x|fw|lg|sm|xs|spin|pulse|border|pull-left|pull-right|inverse|li|stack|stack-1x|stack-2x|rotate-\d+|flip-\w+|fixed-width)$/;

/**
 * Resolve a FontAwesome class string to a platform `{{sw-icon}}` name, or null if there's no equivalent.
 * @example mapFaIcon('fa fa-4x fa-suitcase') === 'briefcase'
 * @example mapFaIcon('fab fa-twitter') === 'brand:x'
 * @example mapFaIcon('fa fa-phone') === 'phone'   // direct Lucide match, no alias needed
 */
export function mapFaIcon(classStr: string | null | undefined): string | null {
  if (!classStr) return null;
  let raw = '';
  for (const t of classStr.split(/\s+/)) {
    const m = t.match(/^fa-(.+)$/);
    const name = m?.[1];
    if (name && !FA_MODIFIER.test(name)) { raw = name; break; }
  }
  if (!raw) return null;
  const base = raw.replace(/-o$/, '').replace(/-alt$/, ''); // FA's outline/-alt variants → the base name
  if (raw === 'linkedin' || raw === 'linkedin-in' || base === 'linkedin') return 'linkedin'; // LinkedIn is Lucide, not brand
  const brandAlias = BRAND_ALIAS[raw];
  if (brandAlias) return `brand:${brandAlias}`;
  if (BRANDS.has(raw)) return `brand:${raw}`;
  if (BRANDS.has(base)) return `brand:${base}`;
  if (LUCIDE.has(raw)) return raw;
  if (LUCIDE.has(base)) return base;
  const aliasRaw = ICON_ALIAS[raw];
  if (aliasRaw && LUCIDE.has(aliasRaw)) return aliasRaw;
  const aliasBase = ICON_ALIAS[base];
  if (aliasBase && LUCIDE.has(aliasBase)) return aliasBase;
  if (LUCIDE.has(`${base}s`)) return `${base}s`; // fuzzy plural
  if (base.endsWith('s') && LUCIDE.has(base.slice(0, -1))) return base.slice(0, -1); // fuzzy singular
  return null;
}
