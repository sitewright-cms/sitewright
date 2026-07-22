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

/** Phosphor weight carried when the FOREIGN icon signals a non-filled style ({{sw-icon}} renders `fill` by
 *  default, so `solid` sources need no weight). Emitted as the `name:weight` suffix. */
export type IconWeight = 'thin' | 'light' | 'regular' | 'duotone';
/** A resolved platform icon: a bare icon name (+ optional non-default weight), or a simple-icons brand slug. */
export type IconMapping = { icon: string; weight?: IconWeight } | { brand: string };

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
// FA family → the Phosphor weight it visually corresponds to. Solid/sharp/brands map to the platform's
// filled DEFAULT (no entry). Both the FA6 long form (`fa-regular`) and the FA5 short form (`far`) count.
const FA_FAMILY_WEIGHT: Readonly<Record<string, IconWeight>> = {
  regular: 'regular', light: 'light', thin: 'thin', duotone: 'duotone',
  far: 'regular', fal: 'light', fat: 'thin', fad: 'duotone',
};

/**
 * Resolve a normalized foreign icon name to a platform icon, or null when there's no equivalent. Brand /
 * social names win over the icon set (a `brand:` slug is the real logo — always filled, weight dropped).
 * The name's own VARIANT suffix refines the weight: `-o`/`-outline(d)` → regular, `-two-tone` → duotone,
 * `-fill` → the filled default (overriding an ecosystem's outline default, e.g. Bootstrap's).
 */
function resolveName(raw: string, weight?: IconWeight): IconMapping | null {
  if (!raw) return null;
  const name = raw.toLowerCase();
  if (/-(?:o|outline|outlined)$/.test(name)) weight = 'regular';
  else if (name.endsWith('-two-tone')) weight = 'duotone';
  else if (name.endsWith('-fill')) weight = undefined;
  // Strip FA outline (-o) / -alt and Bootstrap/Material `-fill`/`-outline` variants → the base name.
  const base = name.replace(/-(?:o|alt|fill|outline|outlined|round|sharp|two-tone)$/, '');
  const icon = (n: string): IconMapping => (weight ? { icon: n, weight } : { icon: n });
  // LinkedIn lives in the icon set (not the simple-icons brand set) — a logo, so keep it filled (no weight).
  if (name === 'linkedin' || name === 'linkedin-in' || base === 'linkedin') return { icon: 'linkedin' };
  /* eslint-disable-next-line security/detect-object-injection -- static alias Record read; the key is a normalized icon token, not attacker-controlled property access */
  const brandAlias = BRAND_ALIAS[name] ?? BRAND_ALIAS[base];
  if (brandAlias && BRANDS.has(brandAlias)) return { brand: brandAlias };
  if (BRANDS.has(name)) return { brand: name };
  if (BRANDS.has(base)) return { brand: base };
  if (LUCIDE.has(name)) return icon(name);
  if (LUCIDE.has(base)) return icon(base);
  /* eslint-disable-next-line security/detect-object-injection -- static alias Record read; the key is a normalized icon token, not attacker-controlled property access */
  const iconAlias = ICON_ALIAS[name] ?? ICON_ALIAS[base];
  if (iconAlias && LUCIDE.has(iconAlias)) return icon(iconAlias);
  if (LUCIDE.has(`${base}s`)) return icon(`${base}s`); // fuzzy plural
  if (base.endsWith('s') && LUCIDE.has(base.slice(0, -1))) return icon(base.slice(0, -1)); // fuzzy singular
  return null;
}

/** The bare icon token + the WEIGHT its ecosystem/family signals (`fa fa-phone` → filled default;
 *  `far fa-clock` / `bi bi-envelope` / `feather-mail` → outline `regular`), or null. */
function extractToken(classStr: string): { name: string; weight?: IconWeight } | null {
  const tokens = classStr.toLowerCase().split(/\s+/).filter(Boolean);
  // FA FAMILY is a sibling token (`far fa-clock`, `fa-regular fa-user`) — find it before the name loop.
  let faWeight: IconWeight | undefined;
  for (const t of tokens) {
    /* eslint-disable-next-line security/detect-object-injection -- static Record read of a class token */
    const w = FA_FAMILY_WEIGHT[t.replace(/^fa-/, '')] ?? FA_FAMILY_WEIGHT[t];
    if (w) { faWeight = w; break; }
  }
  for (const t of tokens) {
    // FontAwesome: `fa-<name>` — skip the family (`fa-brands`) and sizing/style modifiers.
    let m = t.match(/^fa-(.+)$/);
    if (m && m[1] && !FA_MODIFIER.test(m[1]) && !FA_FAMILY.test(m[1])) return { name: m[1], weight: faWeight };
    // Bootstrap Icons: `bi-<name>` — the BARE set is outline; `-fill` names are the filled variants
    // (resolveName's `-fill` handling drops the weight back to the filled default).
    m = t.match(/^bi-(.+)$/);
    if (m && m[1]) return { name: m[1], weight: 'regular' };
    // Ionicons: `ion-<name>` / `ion-md-<name>` / `ion-ios-<name>`; `logo-`/`social-` → a brand name.
    m = t.match(/^ion-(?:md-|ios-)?(.+)$/);
    if (m && m[1]) return { name: m[1].replace(/^(?:logo|social)-/, '') };
    // Feather: `feather-<name>` — a stroke set, so outline weight.
    m = t.match(/^feather-(.+)$/);
    if (m && m[1]) return { name: m[1], weight: 'regular' };
    // Inline Lucide convention: `lucide lucide-<name>` — also a stroke set.
    m = t.match(/^lucide-(.+)$/);
    if (m && m[1]) return { name: m[1], weight: 'regular' };
    // Glyphicons (Bootstrap 3): `glyphicon-<name>` — solid glyphs, filled default.
    m = t.match(/^glyphicon-(.+)$/);
    if (m && m[1]) return { name: m[1] };
  }
  return null;
}

/**
 * Resolve a foreign icon CLASS string to a platform icon, or null when there's no equivalent. The mapping
 * carries a Phosphor WEIGHT when the source is an outline/light variant ({{sw-icon}} is FILLED by default,
 * so solid sources emit no suffix and outline sources emit `name:regular` — the clone keeps the original's
 * visual weight instead of silently swapping outline glyphs for filled ones).
 * @example mapIconClass('fa fa-4x fa-suitcase') // { icon: 'briefcase' }             (solid → filled default)
 * @example mapIconClass('far fa-clock')         // { icon: 'clock', weight: 'regular' }
 * @example mapIconClass('fab fa-twitter')       // { brand: 'x' }
 * @example mapIconClass('bi bi-telephone')      // { icon: 'phone', weight: 'regular' }
 * @example mapIconClass('bi bi-envelope-fill')  // { icon: 'mail' }                  (-fill → filled default)
 * @example mapIconClass('btn btn-primary')      // null (not an icon)
 */
export function mapIconClass(classStr: string | null | undefined): IconMapping | null {
  if (!classStr) return null;
  const token = extractToken(classStr);
  return token ? resolveName(token.name, token.weight) : null;
}

/**
 * Resolve a Material Icons LIGATURE to a platform icon, or null. Material renders `<i class="material-icons">
 * home</i>` — the icon is the element's TEXT, not a class — so underscores in the ligature are normalized
 * to hyphens before the shared resolver runs. The optional CLASS string carries Material's style variant
 * (`material-icons-outlined` → outline `regular`, `…-two-tone` → `duotone`; the base font is filled =
 * platform default).
 * @example mapMaterialLigature('shopping_cart') // { icon: 'shopping-cart' }
 * @example mapMaterialLigature('call')          // { icon: 'phone' }
 * @example mapMaterialLigature('home', 'material-icons-outlined') // { icon: 'house', weight: 'regular' }
 */
export function mapMaterialLigature(text: string | null | undefined, classStr?: string | null): IconMapping | null {
  if (!text) return null;
  const name = text.trim().toLowerCase().replace(/_/g, '-');
  if (!name || /\s/.test(name)) return null; // a ligature is a single token; real prose is not an icon
  const cls = (classStr ?? '').toLowerCase();
  const weight: IconWeight | undefined = /\boutlined\b|-outlined\b/.test(cls) ? 'regular' : /two-tone/.test(cls) ? 'duotone' : undefined;
  return resolveName(name, weight);
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
