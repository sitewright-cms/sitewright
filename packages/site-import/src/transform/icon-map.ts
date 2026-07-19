// Map an imported site's ICON-FONT / SVG-sprite classes to a platform {{sw-icon}} / brand icon. When a
// page is captured its icon stylesheet + webfont are dropped (no foreign CSS, no self-hosted @font-face),
// so a literal `<i class="fa fa-phone">` nativizes to an EMPTY box — the glyph lived in the font that's
// gone. Rather than a hard-coded FA→name table (which always lags), this is CATALOG-AWARE: normalize the
// foreign class and match it against the platform's ACTUAL icon sets — Lucide (`ICON_NAMES`, stroke
// glyphs), brand/social logos (`BRAND_ICON_NAMES`, simple-icons). Most icon names equal the Lucide name
// (phone/star/user/…); only genuine naming differences need an alias entry.
//
// Covers the common icon ecosystems: FontAwesome (`fa-*`/`fab`/`fas`), Bootstrap Icons (`bi-*`), Ionicons
// (`ion-*`, `ion-logo-*`), Feather (`feather-*`), Glyphicons (`glyphicon-*`), and Material Icons (whose
// name is the element's LIGATURE TEXT, resolved via {@link mapMaterialLigature}).
//
// Returns a discriminated `{ icon }` (Lucide) / `{ brand }` (simple-icons slug) result, or null when the
// platform has no equivalent (the caller then keeps the original markup untouched). Pure + dependency-light
// so it runs server-side in the import pipeline and is unit-tested without a browser.
import { ICON_NAMES, BRAND_ICON_NAMES, FLAG_CODES } from '@sitewright/blocks';

const LUCIDE = new Set<string>(ICON_NAMES);
const BRANDS = new Set<string>(BRAND_ICON_NAMES);
const FLAGS = new Set<string>(FLAG_CODES);

/** A resolved platform icon: a bare Lucide name, or a simple-icons brand slug. */
export type IconMapping = { icon: string } | { brand: string };

/**
 * Foreign icon name → Lucide name, ONLY where the names genuinely differ (a direct name match needs no
 * entry). Pooled across ecosystems — the keys are distinct enough that FA/Bootstrap/Material never collide
 * (e.g. `envelope` is FA/Bootstrap, `email`/`call`/`place` are Material) and every value is a real Lucide name.
 */
const ICON_ALIAS: Readonly<Record<string, string>> = {
  // FontAwesome
  suitcase: 'briefcase', envelope: 'mail', 'paper-plane': 'send', 'map-marker': 'map-pin',
  'location-arrow': 'navigation', 'location-dot': 'map-pin', bars: 'menu', times: 'x', close: 'x', xmark: 'x',
  'check-circle': 'circle-check', 'times-circle': 'circle-x', 'pencil-square': 'square-pen', edit: 'square-pen',
  'pen-to-square': 'square-pen', cog: 'settings', gear: 'settings', cogs: 'settings', tachometer: 'gauge',
  'life-ring': 'life-buoy', home: 'house', trash: 'trash-2', 'info-circle': 'info',
  'exclamation-circle': 'circle-alert', 'exclamation-triangle': 'triangle-alert', 'question-circle': 'circle-help',
  comment: 'message-square', comments: 'message-square', mobile: 'smartphone', 'mobile-screen': 'smartphone',
  'eye-slash': 'eye-off', unlock: 'lock-open', 'bar-chart': 'chart-column', 'line-chart': 'chart-line',
  'pie-chart': 'chart-pie', 'quote-left': 'quote', 'quote-right': 'quote', headset: 'headphones',
  'angle-right': 'chevron-right', 'angle-left': 'chevron-left', 'angle-up': 'chevron-up', 'angle-down': 'chevron-down',
  'angle-double-right': 'chevrons-right', 'angle-double-left': 'chevrons-left', 'sign-in': 'log-in',
  'sign-out': 'log-out', 'plus-circle': 'circle-plus', 'minus-circle': 'circle-minus', dollar: 'dollar-sign',
  usd: 'dollar-sign', picture: 'image', photo: 'image', 'paint-brush': 'paintbrush', magic: 'wand-sparkles',
  bolt: 'zap', flash: 'zap', file: 'file-text', 'thumbs-o-up': 'thumbs-up', 'cart-shopping': 'shopping-cart',
  // Bootstrap Icons
  telephone: 'phone', 'geo-alt': 'map-pin', geo: 'map-pin', person: 'user', people: 'users', cart: 'shopping-cart',
  'chat-dots': 'message-square', chat: 'message-square', 'x-circle': 'circle-x',
  'box-arrow-right': 'log-out', 'box-arrow-in-right': 'log-in',
  // Material Icons ligatures (underscores are normalized to hyphens before lookup)
  email: 'mail', call: 'phone', place: 'map-pin', 'location-on': 'map-pin', favorite: 'heart',
  'favorite-border': 'heart', 'account-circle': 'circle-user', 'shopping-cart-checkout': 'shopping-cart',
  'arrow-forward': 'arrow-right', 'arrow-back': 'arrow-left', 'arrow-upward': 'arrow-up', 'arrow-downward': 'arrow-down',
  'expand-more': 'chevron-down', 'expand-less': 'chevron-up', 'keyboard-arrow-right': 'chevron-right',
  'keyboard-arrow-left': 'chevron-left', 'keyboard-arrow-down': 'chevron-down', 'keyboard-arrow-up': 'chevron-up',
  schedule: 'clock', 'access-time': 'clock', 'error-outline': 'circle-alert', 'help-outline': 'circle-help',
};

/** Foreign social name → simple-icons brand slug, only where they differ from the bare name. */
const BRAND_ALIAS: Readonly<Record<string, string>> = {
  twitter: 'x', 'x-twitter': 'x', 'facebook-f': 'facebook', 'facebook-square': 'facebook',
  'facebook-official': 'facebook', 'facebook-messenger': 'messenger',
  'youtube-play': 'youtube', 'youtube-square': 'youtube', 'pinterest-p': 'pinterest',
  'google-plus': 'google', 'whatsapp-square': 'whatsapp', 'linkedin-square': 'linkedin', 'linkedin-in': 'linkedin',
};

// FA sizing/style/animation modifiers (fa-2x, fa-fw, fa-spin, …) — NOT the icon name.
const FA_MODIFIER = /^(\d+x|fw|lg|sm|xs|spin|pulse|border|pull-left|pull-right|inverse|li|stack|stack-1x|stack-2x|rotate-\d+|flip-\w+|fixed-width)$/;
// FA6 FAMILY tokens (`fa-brands`, `fa-solid`, …) sit alongside the icon token — a family, not a name.
const FA_FAMILY = /^(brands|solid|regular|light|thin|duotone|sharp)$/;

/**
 * Resolve a normalized foreign icon name to a platform icon, or null when there's no equivalent. Brand /
 * social names win over Lucide (a `brand:` slug is the real logo), so this checks the brand set first.
 */
function resolveName(raw: string): IconMapping | null {
  if (!raw) return null;
  const name = raw.toLowerCase();
  // Strip FA outline (-o) / -alt and Bootstrap/Material `-fill`/`-outline` variants → the base name.
  const base = name.replace(/-(?:o|alt|fill|outline|outlined|round|sharp|two-tone)$/, '');
  // LinkedIn lives in Lucide (not the simple-icons brand set) — resolve it there before the brand checks.
  if (name === 'linkedin' || name === 'linkedin-in' || base === 'linkedin') return { icon: 'linkedin' };
  /* eslint-disable-next-line security/detect-object-injection -- static alias Record read; the key is a normalized icon token, not attacker-controlled property access */
  const brandAlias = BRAND_ALIAS[name] ?? BRAND_ALIAS[base];
  if (brandAlias && BRANDS.has(brandAlias)) return { brand: brandAlias };
  if (BRANDS.has(name)) return { brand: name };
  if (BRANDS.has(base)) return { brand: base };
  if (LUCIDE.has(name)) return { icon: name };
  if (LUCIDE.has(base)) return { icon: base };
  /* eslint-disable-next-line security/detect-object-injection -- static alias Record read; the key is a normalized icon token, not attacker-controlled property access */
  const iconAlias = ICON_ALIAS[name] ?? ICON_ALIAS[base];
  if (iconAlias && LUCIDE.has(iconAlias)) return { icon: iconAlias };
  if (LUCIDE.has(`${base}s`)) return { icon: `${base}s` }; // fuzzy plural
  if (base.endsWith('s') && LUCIDE.has(base.slice(0, -1))) return { icon: base.slice(0, -1) }; // fuzzy singular
  return null;
}

/** The bare icon token extracted from a foreign class string (`fa-phone` → `phone`), or null. */
function extractToken(classStr: string): string | null {
  for (const t of classStr.toLowerCase().split(/\s+/).filter(Boolean)) {
    // FontAwesome: `fa-<name>` — skip the family (`fa-brands`) and sizing/style modifiers.
    let m = t.match(/^fa-(.+)$/);
    if (m && m[1] && !FA_MODIFIER.test(m[1]) && !FA_FAMILY.test(m[1])) return m[1];
    // Bootstrap Icons: `bi-<name>`.
    m = t.match(/^bi-(.+)$/);
    if (m && m[1]) return m[1];
    // Ionicons: `ion-<name>` / `ion-md-<name>` / `ion-ios-<name>`; `logo-`/`social-` → a brand name.
    m = t.match(/^ion-(?:md-|ios-)?(.+)$/);
    if (m && m[1]) return m[1].replace(/^(?:logo|social)-/, '');
    // Feather: `feather-<name>` (the `feather` base class is skipped).
    m = t.match(/^feather-(.+)$/);
    if (m && m[1]) return m[1];
    // Inline Lucide convention: `lucide lucide-<name>` (a captured `lucide-react`/CDN svg keeps this class).
    m = t.match(/^lucide-(.+)$/);
    if (m && m[1]) return m[1];
    // Glyphicons (Bootstrap 3): `glyphicon-<name>`.
    m = t.match(/^glyphicon-(.+)$/);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Resolve a foreign icon CLASS string to a platform icon, or null when there's no equivalent.
 * @example mapIconClass('fa fa-4x fa-suitcase') // { icon: 'briefcase' }
 * @example mapIconClass('fab fa-twitter')       // { brand: 'x' }
 * @example mapIconClass('bi bi-telephone')      // { icon: 'phone' }
 * @example mapIconClass('btn btn-primary')      // null (not an icon)
 */
export function mapIconClass(classStr: string | null | undefined): IconMapping | null {
  if (!classStr) return null;
  const token = extractToken(classStr);
  return token ? resolveName(token) : null;
}

/**
 * Resolve a Material Icons LIGATURE to a platform icon, or null. Material renders `<i class="material-icons">
 * home</i>` — the icon is the element's TEXT, not a class — so underscores in the ligature are normalized
 * to hyphens before the shared resolver runs.
 * @example mapMaterialLigature('shopping_cart') // { icon: 'shopping-cart' }
 * @example mapMaterialLigature('call')          // { icon: 'phone' }
 */
export function mapMaterialLigature(text: string | null | undefined): IconMapping | null {
  if (!text) return null;
  const name = text.trim().toLowerCase().replace(/_/g, '-');
  if (!name || /\s/.test(name)) return null; // a ligature is a single token; real prose is not an icon
  return resolveName(name);
}

/**
 * Resolve a country-flag icon-font CLASS to a platform flag CODE (for `{{sw-flag}}`, a separate helper from
 * `{{sw-icon}}`), or null. Covers the common flag-font conventions: `flag-icon flag-icon-de` (flag-icon-css),
 * `fi fi-de` (lipis flag-icons), and `flag flag-de` — the code (ISO 3166-1 alpha-2) must exist in FLAG_CODES.
 * @example mapFlagClass('flag-icon flag-icon-de') // { flag: 'de' }
 * @example mapFlagClass('fi fi-us')               // { flag: 'us' }
 */
export function mapFlagClass(classStr: string | null | undefined): { flag: string } | null {
  if (!classStr) return null;
  const tokens = classStr.toLowerCase().split(/\s+/).filter(Boolean);
  const hasFi = tokens.includes('fi'); // lipis flag-icons requires its `fi` base class
  const hasFlag = tokens.includes('flag'); // generic `flag flag-<cc>` requires the bare `flag` base class
  for (const t of tokens) {
    let m = t.match(/^flag-icon-([a-z]{2,4})$/); // flag-icon-css (its prefix is specific — no base-class guard)
    if (m && m[1] && FLAGS.has(m[1])) return { flag: m[1] };
    m = t.match(/^fi-([a-z]{2,4})$/);
    if (m && m[1] && hasFi && FLAGS.has(m[1])) return { flag: m[1] };
    m = t.match(/^flag-([a-z]{2,4})$/);
    if (m && m[1] && hasFlag && FLAGS.has(m[1])) return { flag: m[1] };
  }
  return null;
}
