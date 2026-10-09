import {
  BUTTON_EFFECT_LABELS,
  BUTTON_SHAPE_LABELS,
  DEFAULT_BRAND_COLORS,
  MANDATORY_COLOR_TOKENS,
  NAV_EFFECT_LABELS,
  SLOT_MAX,
  STICKY_HEADER_LABELS,
  securityEmailIssue,
  securityLinkIssue,
  securityPhoneIssue,
  siteUrlIssue,
} from '@sitewright/schema';
import { DEFAULT_BODY, DEFAULT_HEADING, type FontSlotForm, type SettingsForm } from '../model';
import { cssTokenError } from '../css-token-error';

/**
 * What a settings TILE says about its section, derived from the form alone.
 *
 * ★ Pure on purpose: the board's honesty is these rules — when a section is Set, when it is merely at
 * its Default (hollow, nothing missing), when an opt-in is Off, and the rare case that needs attention —
 * so they live where a unit test can pin every one of them, not scattered through JSX.
 *
 * The five states:
 *  - `set`       explicitly configured, with the count that matters;
 *  - `default`   never touched, and that is a correct answer;
 *  - `na`        an opt-in that is off (the tile recedes but keeps its place);
 *  - `attention` incomplete in a way the published site (or the next save) will show.
 */
export type TileStateKind = 'set' | 'default' | 'na' | 'attention';
export interface TileStatus {
  kind: TileStateKind;
  label: string;
}

const set = (label: string): TileStatus => ({ kind: 'set', label });
const dflt = (label: string): TileStatus => ({ kind: 'default', label });
const na = (label: string): TileStatus => ({ kind: 'na', label });
const attention = (label: string): TileStatus => ({ kind: 'attention', label });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const filled = (v: string | undefined): boolean => (v ?? '').trim() !== '';

/**
 * The fixed row allowance every list on a tile shares. Up to `n` items show as they are; past that the
 * LAST row becomes "+N more", so a tile holding 2 redirects and one holding 148 are the same height.
 */
export function budget<T>(items: readonly T[], n: number): { shown: T[]; more: number } {
  if (items.length <= n) return { shown: [...items], more: 0 };
  const shown = items.slice(0, Math.max(0, n - 1));
  return { shown, more: items.length - shown.length };
}

/** Lines of non-blank source — the same count the code fields have always shown. */
export function lineCount(source: string): number {
  const t = source.trim();
  return t === '' ? 0 : t.split('\n').length;
}

// ---- Corporate Identity --------------------------------------------------------------------------

export function identityStatus(f: SettingsForm): TileStatus {
  // The display name is the one REQUIRED field — everything that names the site reads it.
  if (!filled(f.name)) return attention('Name missing');
  const n = [f.name, f.legalName, f.shortName, f.slogan, f.description, f.businessType].filter(filled).length;
  return set(`${n} of 6 set`);
}

/**
 * The five brand-image slots. `fieldLabel` is the picker's label — kept identical to the old card's,
 * because it names the input and the "Browse for …" button that tests and muscle memory both find.
 */
export const LOGO_WELLS = [
  { key: 'logo', label: 'Logo', fieldLabel: 'Logo', get: (f: SettingsForm) => f.logo },
  { key: 'icon', label: 'Icon', fieldLabel: 'Icon (favicon, apple-touch & PWA)', get: (f: SettingsForm) => f.icon },
  { key: 'logoLight', label: 'Logo · light bg', fieldLabel: 'Logo (light bg)', get: (f: SettingsForm) => f.logoLight },
  { key: 'logoDark', label: 'Logo · dark bg', fieldLabel: 'Logo (dark bg)', get: (f: SettingsForm) => f.logoDark },
  { key: 'image', label: 'Share image', fieldLabel: 'Share image (OG)', get: (f: SettingsForm) => f.image },
] as const;
export type LogoWellKey = (typeof LOGO_WELLS)[number]['key'];

export function logosStatus(f: SettingsForm): TileStatus {
  const n = LOGO_WELLS.filter((w) => filled(w.get(f))).length;
  return n === 0 ? dflt('None set') : set(`${n} of 5 set`);
}

const MANDATORY = new Set<string>(MANDATORY_COLOR_TOKENS);
const defaultColorOf = (key: string): string | undefined => Object.entries(DEFAULT_BRAND_COLORS).find(([k]) => k === key)?.[1];

/** The six core colours (always present, first) and any custom ones, as the tile shows them. */
export function colorSwatches(f: SettingsForm): { core: Array<{ key: string; value: string }>; custom: Array<{ key: string; value: string }> } {
  return {
    core: f.colors.filter((c) => MANDATORY.has(c.key)).map(({ key, value }) => ({ key, value })),
    custom: f.colors.filter((c) => !MANDATORY.has(c.key) && filled(c.key)).map(({ key, value }) => ({ key, value })),
  };
}

export function colorsStatus(f: SettingsForm): TileStatus {
  const { core, custom } = colorSwatches(f);
  const atDefaults = core.every((c) => c.value.trim().toLowerCase() === (defaultColorOf(c.key) ?? '').toLowerCase());
  if (atDefaults && custom.length === 0) return dflt('Platform palette');
  return set(custom.length ? `6 core · ${custom.length} custom` : '6 core');
}

const sameSlot = (a: FontSlotForm, b: FontSlotForm): boolean =>
  a.source === b.source && a.family === b.family && a.weight === b.weight;

export interface TypographyRow {
  slot: string;
  /** The utility class the slot is used through. */
  utility: string;
  family: string;
  weight: number;
  source: 'System' | 'Self-hosted';
}

export function typographyRows(f: SettingsForm): TypographyRow[] {
  const row = (slot: string, s: FontSlotForm): TypographyRow => ({
    slot,
    utility: `font-${slot}`,
    family: s.family,
    weight: s.weight,
    source: s.source === 'asset' ? 'Self-hosted' : 'System',
  });
  return [row('heading', f.heading), row('body', f.body), ...f.named.filter((n) => filled(n.name)).map((n) => row(n.name, n.slot))];
}

export function typographyStatus(f: SettingsForm): TileStatus {
  if (sameSlot(f.heading, DEFAULT_HEADING) && sameSlot(f.body, DEFAULT_BODY) && !f.named.some((n) => filled(n.name))) {
    return dflt('System fonts');
  }
  return set(plural(typographyRows(f).length, 'slot'));
}

export function cssTokensStatus(f: SettingsForm): TileStatus {
  const rows = f.cssTokens.filter((t) => filled(t.key) || filled(t.value));
  if (rows.length === 0) return dflt('None');
  // A value the schema refuses fails the WHOLE save — say so on the tile, before the operator finds out.
  const invalid = rows.filter((t) => cssTokenError(t.value) !== null).length;
  if (invalid) return attention(`${invalid} invalid`);
  return set(`${rows.length} defined`);
}

/** The eleven contact & location fields, read one by one. */
const contactValues = (f: SettingsForm): string[] => [
  f.email, f.telephone, f.street, f.locality, f.region, f.country, f.postalCode, f.latitude, f.longitude, f.mapUrl, f.bookingUrl,
];

export function contactStatus(f: SettingsForm): TileStatus {
  const values = contactValues(f);
  const n = values.filter(filled).length;
  return n === 0 ? dflt('Not set') : set(`${n} of ${values.length} set`);
}

/** The one-line postal address a tile shows. */
export function addressLine(f: SettingsForm): string {
  const cityLine = [f.postalCode, f.locality].filter(filled).join(' ');
  return [f.street, cityLine, f.region, f.country].filter(filled).join(', ');
}

export function socialStatus(f: SettingsForm): TileStatus {
  const n = f.social.filter((s) => filled(s.link)).length;
  return n === 0 ? dflt('None') : set(`${n} linked`);
}

// ---- Website Settings ----------------------------------------------------------------------------

export function siteStatus(f: SettingsForm): TileStatus {
  const url = f.siteUrl.trim();
  // Without it the publish skips sitemap.xml and robots.txt has no Sitemap line — the one gap a fresh
  // project genuinely has, so it is the one thing the board points at.
  if (!url) return attention('No production URL');
  if (siteUrlIssue(url)) return attention('Invalid URL');
  return set('Set');
}

const WIDTH_PRESETS: Record<string, string> = { '': '1200px', '960px': '960px', '1440px': '1440px', none: 'Full width' };

export function contentWidthLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(WIDTH_PRESETS, value) ? (WIDTH_PRESETS[value] as string) : value;
}

export function contentWidthStatus(f: SettingsForm): TileStatus {
  return f.containerWidth.trim() === '' ? dflt('Default') : set('Set');
}

export function imagesStatus(f: SettingsForm): TileStatus {
  return f.imageDelivery === '' && f.imageUploadCap.trim() === '' ? dflt('Default') : set('Set');
}

/** The document's parts in RENDER order: head first, scripts last (after `bottom`). */
export const SKELETON_PARTS = ['criticalCss', 'head', 'mainNav', 'sidebarLeft', 'sidebarRight', 'footer', 'bottom', 'scripts'] as const;
export type SkeletonPart = (typeof SKELETON_PARTS)[number];

/** One part's source. A switch rather than `form[part]`, so every read is a named field. */
export function partSource(f: SettingsForm, part: SkeletonPart): string {
  switch (part) {
    case 'criticalCss': return f.criticalCss;
    case 'head': return f.head;
    case 'mainNav': return f.mainNav;
    case 'sidebarLeft': return f.sidebarLeft;
    case 'sidebarRight': return f.sidebarRight;
    case 'footer': return f.footer;
    case 'bottom': return f.bottom;
    case 'scripts': return f.scripts;
  }
}

/**
 * Critical CSS against its ceiling. The schema caps it at the platform's one authoring ceiling
 * (`SLOT_MAX` — criticalCss shares it, see website.ts), measured in characters.
 */
export function criticalCssUsage(f: SettingsForm): { chars: number; fraction: number; overCap: boolean } {
  const chars = f.criticalCss.length;
  return { chars, fraction: Math.min(1, chars / SLOT_MAX), overCap: chars > SLOT_MAX };
}

export function skeletonStatus(f: SettingsForm): TileStatus {
  if (criticalCssUsage(f).overCap) return attention('Critical CSS too large');
  const n = SKELETON_PARTS.filter((k) => filled(partSource(f, k))).length;
  return n === 0 ? dflt('Empty') : set(`${n} of ${SKELETON_PARTS.length} in use`);
}

export function themesStatus(f: SettingsForm): TileStatus {
  return f.enableThemes ? set('On') : na('Off');
}

/** "logo-pulse" → "Logo pulse" — the preloader options' label. */
export const effectLabel = (s: string): string => {
  const t = s.replace(/-/g, ' ');
  return t.length ? t[0]!.toUpperCase() + t.slice(1) : t;
};

/** A label from a schema label map, or the raw value for one the map does not know yet. */
function pick(labels: Record<string, string>, key: string): string {
  const hit = Object.entries(labels).find(([k]) => k === key);
  return hit ? hit[1] : key;
}

/** Only what DIFFERS from the platform defaults (back-to-top is on by default, so OFF is the news). */
export function effectRows(f: SettingsForm): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (f.navEffect !== 'none') rows.push({ label: 'Nav hover', value: pick(NAV_EFFECT_LABELS, f.navEffect) });
  else if (filled(f.navCode)) rows.push({ label: 'Nav hover', value: 'Custom code' });
  if (f.buttonEffect !== 'none') rows.push({ label: 'Button effect', value: pick(BUTTON_EFFECT_LABELS, f.buttonEffect) });
  else if (filled(f.buttonCode)) rows.push({ label: 'Button effect', value: 'Custom code' });
  if (f.buttonAccent !== '') rows.push({ label: 'Button accent', value: effectLabel(f.buttonAccent) });
  if (f.buttonShape !== '') rows.push({ label: 'Button shape', value: pick(BUTTON_SHAPE_LABELS, f.buttonShape) });
  if (f.preloaderEffect !== 'none') rows.push({ label: 'Preloader', value: effectLabel(f.preloaderEffect) });
  else if (filled(f.preloaderCode)) rows.push({ label: 'Preloader', value: 'Custom code' });
  if (f.stickyHeader !== 'none') rows.push({ label: 'Sticky header', value: pick(STICKY_HEADER_LABELS, f.stickyHeader) });
  if (f.scrollSpy) rows.push({ label: 'Scrollspy', value: 'On' });
  if (!f.backToTop) rows.push({ label: 'Back to top', value: 'Off' });
  return rows;
}

export function effectsStatus(f: SettingsForm): TileStatus {
  const n = effectRows(f).length;
  return n === 0 ? dflt('Plain') : set(`${n} set`);
}

/** Rules that will actually be saved — a row with no `from` is dropped. */
const realRedirects = (f: SettingsForm) => f.redirects.filter((r) => filled(r.from));

export function redirectsStatus(f: SettingsForm): TileStatus {
  const n = realRedirects(f).length;
  return n === 0 ? dflt('None') : set(plural(n, 'rule'));
}

/** The one unusual fact about a long redirect list: how many are not permanent. */
export function redirectsExtra(f: SettingsForm): string {
  const other = realRedirects(f).filter((r) => r.status !== 301);
  if (other.length === 0) return '';
  const codes = [...new Set(other.map((r) => r.status))].sort((a, b) => a - b).join('/');
  return `${other.length} use ${codes}`;
}

/** Whether a phone/email source will actually publish something (custom with nothing typed will not). */
const phoneOn = (f: SettingsForm): boolean => f.securityPhoneMode === 'ci' || (f.securityPhoneMode === 'custom' && filled(f.securityPhone));
const emailOn = (f: SettingsForm): boolean => f.securityEmailMode === 'ci' || (f.securityEmailMode === 'custom' && filled(f.securityEmail));

/** The security.txt contacts, in publish order (page/URL → phone → email), named by where each comes from. */
export function securityContacts(f: SettingsForm): string[] {
  return [
    f.securityContactPageId ? 'Contact page' : filled(f.securityContactUrl) ? 'Contact URL' : '',
    phoneOn(f) ? (f.securityPhoneMode === 'ci' ? 'company phone' : 'own phone') : '',
    emailOn(f) ? (f.securityEmailMode === 'ci' ? 'company email' : 'own email') : '',
  ].filter(Boolean);
}

export function securityStatus(f: SettingsForm): TileStatus {
  if (!f.securityEnabled) return na('Off');
  // The schema refuses a security.txt with no contact, so the publish would fail.
  if (securityContacts(f).length === 0) return attention('No contact');
  // A chosen PAGE (contact, policy or acknowledgments) is published as an absolute URL, which needs the
  // production URL.
  const pageChosen = Boolean(f.securityContactPageId || f.securityPolicyPageId || f.securityAcknowledgmentsPageId);
  if (pageChosen && !f.siteUrl.trim()) return attention('Needs production URL');
  // Only the URLs that will actually be PUBLISHED are judged — a typed URL beside a chosen page is not.
  const typedLinks = [
    f.securityContactPageId ? '' : f.securityContactUrl,
    f.securityPolicyPageId ? '' : f.securityPolicyUrl,
    f.securityAcknowledgmentsPageId ? '' : f.securityAcknowledgmentsUrl,
  ];
  if (typedLinks.some((u) => u.trim() && securityLinkIssue(u.trim()))) return attention('Invalid link');
  const badPhone = f.securityPhoneMode === 'custom' && filled(f.securityPhone) && securityPhoneIssue(f.securityPhone.trim()) !== null;
  const badEmail = f.securityEmailMode === 'custom' && filled(f.securityEmail) && securityEmailIssue(f.securityEmail.trim()) !== null;
  if (badPhone || badEmail) return attention('Invalid contact');
  return set('On');
}

export function searchStatus(f: SettingsForm): TileStatus {
  return f.searchFoldDiacritics ? dflt('Loose matching') : set('Exact accents');
}

export function shopStatus(f: SettingsForm): TileStatus {
  if (!f.shopEnabled) return na('Off');
  const channels = f.shopChannels.length;
  // A cart with no channel has nowhere to send an order.
  if (channels === 0) return attention('No checkout channel');
  // The schema refuses a checkout channel without a settlement currency — the save would fail.
  if (f.shopChannels.some((c) => c.kind === 'checkout') && !f.shopCurrencyCode.trim()) return attention('Currency missing');
  return set(plural(channels, 'channel'));
}

export function consentStatus(f: SettingsForm): TileStatus {
  if (f.consent?.enabled !== true) return na('Off');
  const n = f.consent.integrations?.length ?? 0;
  return set(n ? `${n} gated` : 'On');
}

/** The configured locales, default first, deduplicated — the same list the locale manager edits. */
export function localeCodesOf(f: SettingsForm): string[] {
  return Array.from(new Set([f.defaultLocale, ...f.locales.map((l) => l.value).filter(filled)]));
}

export function languagesStatus(f: SettingsForm): TileStatus {
  const n = localeCodesOf(f).length;
  return n <= 1 ? dflt('1 language') : set(`${n} languages`);
}

/**
 * Per added language, the share of the operator's keys that have text in it — lowest first, so the
 * tile's row budget surfaces the gaps. Only keys with main-language text count: a key that exists only
 * in another language is not something a translation can be "missing" from.
 */
export function translationCoverage(f: SettingsForm): Array<{ locale: string; pct: number }> {
  const others = localeCodesOf(f).filter((l) => l !== f.defaultLocale);
  const basis = f.translations.filter((r) => filled(r.key) && filled(r.cells[f.defaultLocale]));
  return others
    .map((locale) => {
      const done = basis.filter((r) => filled(r.cells[locale])).length;
      return { locale, pct: basis.length === 0 ? 100 : Math.floor((done / basis.length) * 100) };
    })
    .sort((a, b) => a.pct - b.pct || a.locale.localeCompare(b.locale));
}

/**
 * ★ Never "not applicable": with ONE language this section still holds the cart, consent and theme
 * labels a single-language site edits, so it stays a working drill-in at all times.
 */
export function translationsStatus(f: SettingsForm): TileStatus {
  const gaps = translationCoverage(f).filter((c) => c.pct < 100).length;
  if (gaps) return attention(`${gaps} incomplete`);
  const keys = f.translations.filter((r) => filled(r.key)).length;
  return keys === 0 ? dflt('Built-in labels') : set(plural(keys, 'key'));
}
