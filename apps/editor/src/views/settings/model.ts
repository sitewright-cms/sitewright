import type { CorporateIdentity, SettingsBundle, WebsiteSettings } from '../../api';
import { DEFAULT_BRAND_COLORS, MANDATORY_COLOR_TOKENS, type JsonValue, type NavEffect, type ButtonEffect, type ButtonAccent, type ButtonDefaultShape, type PreloaderEffect, type ShopChannel, type ShopChannelField, type ShopCurrency, type ShopFieldType } from '@sitewright/schema';
import { pageDataObject } from '../../lib/page-data';

const MANDATORY_COLOR_SET = new Set<string>(MANDATORY_COLOR_TOKENS);

/** Updater passed to the section components. */
export type Patch = (p: Partial<SettingsForm>) => void;

// Rows carry a stable `id` so list editors can key on identity (not index) — index
// keys mis-animate and can show a stale value when a middle row is removed.
export interface KeyedPair {
  id: string;
  key: string;
  value: string;
}
export interface KeyedStr {
  id: string;
  value: string;
}
/** A social profile row: link + display name + icon (Lucide name or `brand:<slug>`). */
export interface KeyedSocial {
  id: string;
  link: string;
  name: string;
  icon: string;
}
export interface KeyedRedirect {
  id: string;
  from: string;
  to: string;
  status: number;
}

/** One project-translation row: an identifier `key` + its per-locale cells (`{ en: "…", de: "…" }`). */
export interface TranslationRow {
  id: string;
  key: string;
  cells: Record<string, string>;
}

/**
 * A MINI SHOP submission channel as edited in the form — a FLAT row holding every kind's fields; only
 * the ones relevant to `kind` are surfaced + persisted (the rest stay blank). Mirrors the schema's
 * `ShopChannel` discriminated union (whatsapp/mailto/payment/form).
 */
export interface KeyedShopChannel {
  id: string;
  kind: ShopChannel['kind'];
  /** Stable key — the channel's display LABEL is translatable, edited in Translations & Labels under `shop.<key>`. */
  key: string;
  number: string; // whatsapp
  intro: string; // whatsapp
  email: string; // mailto
  subject: string; // mailto
  urlTemplate: string; // payment
  provider: string; // payment ('' | paypal | stripe | custom)
  formId: string; // form
  /** whatsapp + mailto: buyer-input fields collected in the cart before the deep link opens. */
  fields: KeyedShopField[];
}

/** A buyer-input order field as edited in the form — mirrors schema `ShopChannelField`, with a stable row id. */
export interface KeyedShopField {
  id: string;
  /** Stable key — the field's display LABEL is translatable, edited in Translations & Labels under `shop.<key>`. */
  key: string;
  type: ShopFieldType;
  required: boolean;
}

/** A typography slot (heading/body/custom) as edited in the form — mirrors schema `FontSlot`. */
export interface FontSlotForm {
  source: 'system' | 'asset';
  family: string;
  weight: number;
  /** For `source: 'asset'`: the `kind:'font'` media asset id. */
  assetId?: string;
}
/** A custom named slot row → a `font-<name>` utility. `name` is a CSS-ident slug. */
export interface NamedSlotForm {
  id: string;
  name: string;
  slot: FontSlotForm;
}
/** Platform defaults applied when a project has no typography configured yet. */
export const DEFAULT_HEADING: FontSlotForm = { source: 'system', family: 'serif', weight: 700 };
export const DEFAULT_BODY: FontSlotForm = { source: 'system', family: 'sans-serif', weight: 400 };

// A monotonic counter — unique-per-session ids for React keys. (Not crypto.randomUUID:
// that's only defined in a secure context, so it's absent over plain-HTTP previews.)
let rowSeq = 0;
const rowId = (): string => `row-${rowSeq++}`;

/** Flat, fully-controlled editable form model for the Settings surface. */
export interface SettingsForm {
  // identity — basics
  name: string;
  legalName: string;
  shortName: string;
  slogan: string;
  description: string;
  businessType: string;
  // identity — assets
  logo: string;
  logoLight: string;
  logoDark: string;
  favicon: string;
  icon: string;
  image: string;
  // identity — contact + location
  email: string;
  telephone: string;
  street: string;
  locality: string;
  region: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  mapUrl: string;
  bookingUrl: string;
  social: KeyedSocial[];
  // identity — brand tokens
  colors: KeyedPair[];
  fonts: KeyedPair[];
  // identity — typography slots (heading + body font + weight), custom named slots, + self-hosted fonts
  heading: FontSlotForm;
  body: FontSlotForm;
  named: NamedSlotForm[];
  // website
  siteUrl: string;
  jsonDataUrl: string;
  /** Editable JSON object → {{ website.data.* }}. */
  data: JsonValue;
  criticalCss: string;
  head: string;
  scripts: string;
  // validated skeleton slots (Handlebars partials)
  topNav: string;
  mobileNav: string;
  sidebarLeft: string;
  sidebarRight: string;
  footer: string;
  bottom: string;
  // nav/button/preloader effect schemes ('none' = off / custom code) → website.effects
  navEffect: 'none' | NavEffect;
  buttonEffect: 'none' | ButtonEffect;
  // site-wide DEFAULT button accent + shape ('' = baseline: secondary accent / rounded shape) → website.effects
  buttonAccent: '' | ButtonAccent;
  buttonShape: '' | ButtonDefaultShape;
  preloaderEffect: 'none' | PreloaderEffect;
  backToTop: boolean;
  // custom effect code (the "None / Custom Code" slots) → website.effects.*Code
  navCode: string;
  buttonCode: string;
  preloaderCode: string;
  // opt-in light/dark themes (website.enableThemes / defaultTheme)
  enableThemes: boolean;
  defaultTheme: 'auto' | 'light' | 'dark';
  // site-wide content width (website.containerWidth); '' = platform default (1200px)
  containerWidth: string;
  redirects: KeyedRedirect[];
  // mini shop (website.shop): master switch + currency FORMATTING + submission channels. The cart's
  // display TEXT (labels, currency symbol/code, channel/field labels) is translatable → Translations & Labels.
  shopEnabled: boolean;
  shopCurrencyPosition: 'before' | 'after';
  shopCurrencyDecimals: string;
  shopChannels: KeyedShopChannel[];
  // localization
  defaultLocale: string;
  locales: KeyedStr[];
  /** Project i18n message catalog (website.translations) → editable key × locale rows. */
  translations: TranslationRow[];
}

const recordToPairs = (r: Record<string, string> | undefined): KeyedPair[] =>
  Object.entries(r ?? {}).map(([k, v]) => ({ id: rowId(), key: k, value: String(v) }));

/**
 * Brand colors → editable rows with the MANDATORY tokens ALWAYS present and FIRST (filled from
 * {@link DEFAULT_BRAND_COLORS} when a project hasn't set one yet), followed by any custom colors.
 * Keeps the settings page's fixed color rows populated regardless of the stored value.
 */
const colorsToPairs = (r: Record<string, string> | undefined): KeyedPair[] => {
  const rec = r ?? {};
  const valueOf = (k: string): string | undefined => Object.entries(rec).find(([rk]) => rk === k)?.[1];
  const mandatory = Object.entries(DEFAULT_BRAND_COLORS).map(([key, def]) => ({ id: rowId(), key, value: valueOf(key) ?? def }));
  const custom = Object.entries(rec)
    .filter(([k]) => !MANDATORY_COLOR_SET.has(k))
    .map(([k, v]) => ({ id: rowId(), key: k, value: String(v) }));
  return [...mandatory, ...custom];
};

const strsToKeyed = (items: string[] | undefined): KeyedStr[] => (items ?? []).map((value) => ({ id: rowId(), value }));

/** website.translations (`key → { locale → string }`) → editable rows (insertion order preserved). */
const translationsToRows = (t: Record<string, Record<string, string>> | undefined): TranslationRow[] =>
  Object.entries(t ?? {}).map(([key, cells]) => ({ id: rowId(), key, cells: { ...cells } }));

/**
 * Editable rows → website.translations, dropping blank/dangerous keys, blank/whitespace-only cells, and
 * cells for any locale NOT in `localeSet` (self-heals after a locale removal). A key left with no cell
 * is omitted entirely. Mirrors the server-side {@link setTranslationCell}/{@link pruneTranslationsLocale}.
 */
const rowsToTranslations = (
  rows: TranslationRow[],
  localeSet: ReadonlySet<string>,
): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  for (const { key, cells } of rows) {
    const k = key.trim();
    if (!k || DANGEROUS_KEYS.has(k)) continue;
    const cellOut: Record<string, string> = {};
    for (const [loc, val] of Object.entries(cells)) {
      if (!loc || DANGEROUS_KEYS.has(loc) || !localeSet.has(loc) || val.trim() === '') continue;
      // eslint-disable-next-line security/detect-object-injection -- loc guarded (non-dangerous, in localeSet); fresh local object
      cellOut[loc] = val;
    }
    // eslint-disable-next-line security/detect-object-injection -- k guarded above; written to a fresh local object
    if (Object.keys(cellOut).length) out[k] = cellOut;
  }
  return out;
};

// Prototype-pollution keys are rejected server-side (safeRecord); mirror the guard
// client-side so they're dropped before the PUT (defense-in-depth).
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const pairsToRecord = (pairs: KeyedPair[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    // Skip blank values: an emptied token is "unset", not a (schema-invalid) empty color/font.
    // For a cleared MANDATORY color this means the server's fill-missing restores its default.
    if (!k || DANGEROUS_KEYS.has(k) || !value.trim()) continue;
    // eslint-disable-next-line security/detect-object-injection -- k is a user token name, guarded above, written to a fresh local object only
    out[k] = value;
  }
  return out;
};

/** Normalizes a font slot for persistence — non-empty family, `assetId` only for `asset` slots. */
const cleanSlot = (s: FontSlotForm): FontSlotForm => ({
  source: s.source,
  family: s.family.trim() || 'sans-serif',
  weight: s.weight,
  ...(s.source === 'asset' && s.assetId ? { assetId: s.assetId } : {}),
});

/**
 * Whether a FORM slot (`a`) equals a DEFAULT constant (`b`) — so unchanged defaults aren't
 * persisted. Directional: `a` is the (possibly whitespace-padded) form value, `b` the trimmed,
 * fontId-less default constant. Always call as `slotEqual(form.slot, DEFAULT_x)`.
 */
const slotEqual = (a: FontSlotForm, b: FontSlotForm): boolean =>
  a.source === b.source && a.family.trim() === b.family && a.weight === b.weight && !a.assetId;

/** Hydrate the editable form from a settings bundle (empties for absent optionals). */
export function toForm(bundle: SettingsBundle): SettingsForm {
  const id = bundle.identity;
  const w = bundle.website;
  return {
    name: id.name ?? '',
    legalName: id.legalName ?? '',
    shortName: id.shortName ?? '',
    slogan: id.slogan ?? '',
    description: id.description ?? '',
    businessType: id.businessType ?? '',
    logo: id.logo ?? '',
    logoLight: id.logoLight ?? '',
    logoDark: id.logoDark ?? '',
    favicon: id.favicon ?? '',
    icon: id.icon ?? '',
    image: id.image ?? '',
    email: id.email ?? '',
    telephone: id.telephone ?? '',
    street: id.address?.street ?? '',
    locality: id.address?.locality ?? '',
    region: id.address?.region ?? '',
    country: id.address?.country ?? '',
    postalCode: id.address?.postalCode ?? '',
    latitude: id.geo?.latitude ?? '',
    longitude: id.geo?.longitude ?? '',
    mapUrl: id.mapUrl ?? '',
    bookingUrl: id.bookingUrl ?? '',
    social: (id.social ?? []).map((s) => ({ id: rowId(), link: s.link, name: s.name ?? '', icon: s.icon ?? '' })),
    colors: colorsToPairs(id.colors),
    fonts: recordToPairs(id.typography?.fontFamilies),
    heading: { ...DEFAULT_HEADING, ...id.typography?.heading },
    body: { ...DEFAULT_BODY, ...id.typography?.body },
    named: Object.entries(id.typography?.named ?? {}).map(([name, slot]) => ({ id: rowId(), name, slot: { ...slot } })),
    siteUrl: w?.siteUrl ?? '',
    jsonDataUrl: w?.jsonDataUrl ?? '',
    data: (w?.data as JsonValue | undefined) ?? {},
    criticalCss: w?.criticalCss ?? '',
    head: w?.head ?? '',
    scripts: w?.scripts ?? '',
    topNav: w?.topNav ?? '',
    mobileNav: w?.mobileNav ?? '',
    sidebarLeft: w?.sidebarLeft ?? '',
    sidebarRight: w?.sidebarRight ?? '',
    footer: w?.footer ?? '',
    bottom: w?.bottom ?? '',
    navEffect: w?.effects?.navEffect ?? 'none',
    buttonEffect: w?.effects?.buttonEffect ?? 'none',
    buttonAccent: w?.effects?.buttonAccent ?? '',
    buttonShape: w?.effects?.buttonShape ?? '',
    preloaderEffect: w?.effects?.preloaderEffect ?? 'none',
    backToTop: w?.effects?.backToTop !== false, // ON by default; only an explicit `false` disables it
    navCode: w?.effects?.navCode ?? '',
    buttonCode: w?.effects?.buttonCode ?? '',
    preloaderCode: w?.effects?.preloaderCode ?? '',
    enableThemes: w?.enableThemes === true,
    defaultTheme: w?.defaultTheme ?? 'auto',
    containerWidth: w?.containerWidth ?? '',
    redirects: (w?.redirects ?? []).map((r) => ({ id: rowId(), from: r.from, to: r.to, status: r.status })),
    shopEnabled: w?.shop?.enabled === true,
    shopCurrencyPosition: w?.shop?.currency?.position ?? 'before',
    shopCurrencyDecimals: w?.shop?.currency?.decimals != null ? String(w.shop.currency.decimals) : '2',
    shopChannels: (w?.shop?.channels ?? []).map((c) => ({
      id: rowId(),
      kind: c.kind,
      key: c.key ?? '',
      number: c.kind === 'whatsapp' ? c.number : '',
      intro: c.kind === 'whatsapp' ? c.intro ?? '' : '',
      email: c.kind === 'mailto' ? c.email : '',
      subject: c.kind === 'mailto' ? c.subject ?? '' : '',
      urlTemplate: c.kind === 'payment' ? c.urlTemplate : '',
      provider: c.kind === 'payment' ? c.provider ?? '' : '',
      formId: c.kind === 'form' ? c.formId : '',
      fields: c.kind === 'whatsapp' || c.kind === 'mailto' ? (c.fields ?? []).map(shopFieldToForm) : [],
    })),
    defaultLocale: bundle.settings.defaultLocale ?? 'en',
    locales: strsToKeyed(bundle.settings.locales ?? ['en']),
    translations: translationsToRows(w?.translations),
  };
}

/** Currency decimals: empty/non-numeric → 2 (schema default); else a truncated, [0,4]-clamped integer. */
function decimalsOf(raw: string): number {
  const n = Number(raw.trim());
  return raw.trim() && Number.isFinite(n) ? Math.max(0, Math.min(4, Math.trunc(n))) : 2;
}

/** Map a stored order field into an editable row (with a stable id; type defaults applied by the schema). */
function shopFieldToForm(f: ShopChannelField): KeyedShopField {
  return { id: rowId(), key: f.key, type: f.type, required: f.required ?? false };
}

/** Map editable order-field rows to schema `ShopChannelField`s, dropping keyless rows + trimming. */
function formFieldsToShop(fields: KeyedShopField[]): ShopChannelField[] {
  return fields
    .filter((f) => f.key.trim())
    .map((f) => ({ key: f.key.trim(), type: f.type, ...(f.required ? { required: true } : {}) }));
}

/** Build a `ShopChannel` from a form row, dropping the row when its `key` or required config field is blank. */
function formChannelToShop(c: KeyedShopChannel): ShopChannel | null {
  const key = c.key.trim();
  if (!key) return null; // a channel needs a stable key (its label lives in the catalog under shop.<key>)
  if (c.kind === 'whatsapp') {
    const fields = formFieldsToShop(c.fields);
    return c.number.trim()
      ? { kind: 'whatsapp', key, number: c.number.trim(), ...(c.intro.trim() ? { intro: c.intro.trim() } : {}), ...(fields.length ? { fields } : {}) }
      : null;
  }
  if (c.kind === 'mailto') {
    const fields = formFieldsToShop(c.fields);
    return c.email.trim()
      ? { kind: 'mailto', key, email: c.email.trim(), ...(c.subject.trim() ? { subject: c.subject.trim() } : {}), ...(fields.length ? { fields } : {}) }
      : null;
  }
  if (c.kind === 'payment') {
    // A legacy `stripe` (offered by an earlier UI) folds to `custom` — Stripe Payment Links are fixed-amount.
    const provider = c.provider.trim() === 'stripe' ? 'custom' : c.provider.trim();
    return c.urlTemplate.trim()
      ? {
          kind: 'payment',
          key,
          urlTemplate: c.urlTemplate.trim(),
          ...(provider === 'paypal' || provider === 'custom' ? { provider } : {}),
        }
      : null;
  }
  return c.formId.trim() ? { kind: 'form', key, formId: c.formId.trim() } : null;
}

const trimmed = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);
const put = <T extends object, K extends string, V>(obj: T, key: K, value: V | undefined): T =>
  value === undefined ? obj : ({ ...obj, [key]: value } as T);

/**
 * Assemble a settings bundle from the form, omitting empty optionals. `base` is the
 * originally-loaded bundle: fields the form does NOT surface (spacing, radii,
 * typography.scale — e.g. set via the CLI/MCP) are carried through so a GUI save
 * never silently drops them.
 */
export function toBundle(form: SettingsForm, base?: SettingsBundle): SettingsBundle {
  const baseId = base?.identity;
  let identity: CorporateIdentity = { name: form.name.trim() || 'Untitled', colors: pairsToRecord(form.colors) };
  identity = put(identity, 'legalName', trimmed(form.legalName));
  identity = put(identity, 'shortName', trimmed(form.shortName));
  identity = put(identity, 'slogan', trimmed(form.slogan));
  identity = put(identity, 'description', trimmed(form.description));
  identity = put(identity, 'businessType', trimmed(form.businessType));
  identity = put(identity, 'logo', trimmed(form.logo));
  identity = put(identity, 'logoLight', trimmed(form.logoLight));
  identity = put(identity, 'logoDark', trimmed(form.logoDark));
  identity = put(identity, 'favicon', trimmed(form.favicon));
  identity = put(identity, 'icon', trimmed(form.icon));
  identity = put(identity, 'image', trimmed(form.image));
  identity = put(identity, 'email', trimmed(form.email));
  identity = put(identity, 'telephone', trimmed(form.telephone));

  const address = stripEmpty({
    street: trimmed(form.street),
    locality: trimmed(form.locality),
    region: trimmed(form.region),
    country: trimmed(form.country),
    postalCode: trimmed(form.postalCode),
  });
  if (address) identity = put(identity, 'address', address);
  if (form.latitude.trim() && form.longitude.trim()) {
    identity = put(identity, 'geo', { latitude: form.latitude.trim(), longitude: form.longitude.trim() });
  }
  identity = put(identity, 'mapUrl', trimmed(form.mapUrl));
  identity = put(identity, 'bookingUrl', trimmed(form.bookingUrl));
  // Social: keep the author's order; drop rows with no link; omit empty name/icon.
  const social = form.social
    .filter((s) => s.link.trim())
    .map((s) => ({
      link: s.link.trim(),
      ...(s.name.trim() ? { name: s.name.trim() } : {}),
      ...(s.icon.trim() ? { icon: s.icon.trim() } : {}),
    }));
  if (social.length) identity = put(identity, 'social', social);

  // typography: surfaced fontFamilies + preserved scale + heading/body slots + custom named slots.
  // Only NON-default heading/body are written (the renderer applies the serif/700 + sans/400 defaults
  // when absent), so a project that never touched fonts stays minimal.
  const fonts = pairsToRecord(form.fonts);
  const scale = baseId?.typography?.scale;
  const heading = slotEqual(form.heading, DEFAULT_HEADING) ? undefined : cleanSlot(form.heading);
  const body = slotEqual(form.body, DEFAULT_BODY) ? undefined : cleanSlot(form.body);
  // Custom named slots → a `{ <slug>: FontSlot }` record (drop empty/dangerous names).
  const named: Record<string, FontSlotForm> = {};
  for (const { name, slot } of form.named) {
    // Strip a transient trailing hyphen left from typing (the schema rejects it) → a clean CSS ident.
    const k = name.trim().replace(/-+$/, '');
    if (!k || DANGEROUS_KEYS.has(k)) continue;
    // eslint-disable-next-line security/detect-object-injection -- k is a user slot name, guarded above, written to a fresh local object only
    named[k] = cleanSlot(slot);
  }
  const hasNamed = Object.keys(named).length > 0;
  // Self-hosted fonts are media assets now (referenced by a slot's `assetId`) — nothing to persist
  // here; an `asset` slot whose font was deleted from the library degrades to the family name.
  if (Object.keys(fonts).length || scale || heading || body || hasNamed) {
    identity = put(identity, 'typography', {
      fontFamilies: fonts,
      ...(scale ? { scale } : {}),
      ...(heading ? { heading } : {}),
      ...(body ? { body } : {}),
      ...(hasNamed ? { named } : {}),
    });
  }
  // Carry through token fields the form doesn't expose.
  identity = put(identity, 'spacing', baseId?.spacing);
  identity = put(identity, 'radii', baseId?.radii);

  // website — only include the section when something is set
  let website: WebsiteSettings | undefined;
  const redirects = form.redirects
    .filter((r) => r.from.trim() && r.to.trim())
    .map((r) => ({ from: r.from.trim(), to: r.to.trim(), status: r.status as 301 | 302 | 307 | 308 }));
  const w = stripEmpty({
    siteUrl: trimmed(form.siteUrl),
    jsonDataUrl: trimmed(form.jsonDataUrl),
    data: pageDataObject(form.data),
    criticalCss: trimmed(form.criticalCss),
    head: trimmed(form.head),
    scripts: trimmed(form.scripts),
    topNav: trimmed(form.topNav),
    mobileNav: trimmed(form.mobileNav),
    sidebarLeft: trimmed(form.sidebarLeft),
    sidebarRight: trimmed(form.sidebarRight),
    footer: trimmed(form.footer),
    bottom: trimmed(form.bottom),
  });
  // mini shop: currency FORMATTING (symbol/code are translatable → catalog, not here) + channels. Emit
  // `currency` only when it deviates from the schema defaults (position 'before', decimals 2) to stay minimal.
  const shopDecimals = decimalsOf(form.shopCurrencyDecimals);
  const shopCurrency: ShopCurrency | undefined =
    form.shopCurrencyPosition !== 'before' || shopDecimals !== 2 ? { position: form.shopCurrencyPosition, decimals: shopDecimals } : undefined;
  const shopChannels = form.shopChannels
    .map(formChannelToShop)
    .filter((c): c is ShopChannel => c !== null);
  // The master switch is part of the shop object; `enabled` is emitted only when ON (omitted = off, the
  // schema default), so a fresh/disabled shop stays minimal. The object is built when enabled OR any
  // config is present (so toggling off keeps the config but drops `enabled` → the cart is gated off).
  const shop =
    form.shopEnabled || shopCurrency || shopChannels.length
      ? {
          ...(form.shopEnabled ? { enabled: true } : {}),
          ...(shopCurrency ? { currency: shopCurrency } : {}),
          ...(shopChannels.length ? { channels: shopChannels } : {}),
        }
      : undefined;
  // nav/button effect schemes ('none' = off, so omit them).
  const nav = form.navEffect !== 'none' ? { navEffect: form.navEffect } : {};
  const btn = form.buttonEffect !== 'none' ? { buttonEffect: form.buttonEffect } : {};
  // button accent/shape: '' = the baseline default (secondary / rounded), so omit them.
  const btnA = form.buttonAccent ? { buttonAccent: form.buttonAccent } : {};
  const btnSh = form.buttonShape ? { buttonShape: form.buttonShape } : {};
  const pre = form.preloaderEffect !== 'none' ? { preloaderEffect: form.preloaderEffect } : {};
  // back-to-top button: ON by default, so emit only the explicit OFF state (omitted = on).
  const bk = form.backToTop ? {} : { backToTop: false as const };
  // Custom-code slots are PRESERVED even when a built-in effect is chosen (so toggling between a
  // preset and "None / Custom Code" doesn't lose the draft); render applies a code only when its
  // effect is 'none' (see websiteEffectsCustomCode). Omitted when empty.
  const navC = form.navCode.trim() ? { navCode: form.navCode } : {};
  const btnC = form.buttonCode.trim() ? { buttonCode: form.buttonCode } : {};
  const preC = form.preloaderCode.trim() ? { preloaderCode: form.preloaderCode } : {};
  const mergedEffects = { ...nav, ...btn, ...btnA, ...btnSh, ...pre, ...bk, ...navC, ...btnC, ...preC };
  const effects = Object.keys(mergedEffects).length > 0 ? mergedEffects : undefined;
  // Opt-in light/dark themes. `enableThemes` is emitted only when ON (omitted = off, the
  // schema default); `defaultTheme` only when it deviates from 'auto' (the default) AND the
  // feature is on — so a single-theme site stays byte-identical and toggling off drops both keys.
  const themes = form.enableThemes
    ? {
        enableThemes: true as const,
        ...(form.defaultTheme !== 'auto' ? { defaultTheme: form.defaultTheme } : {}),
      }
    : undefined;
  // i18n catalog — cells are kept only for CONFIGURED locales (defaultLocale + locales), so a settings
  // save self-heals stale columns and never clobbers the catalog (it always round-trips through the form).
  const localeSet = new Set<string>([
    form.defaultLocale.trim() || 'en',
    ...form.locales.map((l) => l.value.trim()).filter(Boolean),
  ]);
  const translations = rowsToTranslations(form.translations, localeSet);
  const hasTranslations = Object.keys(translations).length > 0;
  if (w || redirects.length || shop || effects || themes || hasTranslations || form.containerWidth.trim()) {
    website = {
      ...(w ?? {}),
      ...(redirects.length ? { redirects } : {}),
      ...(shop ? { shop } : {}),
      ...(effects ? { effects } : {}),
      ...(themes ?? {}),
      ...(hasTranslations ? { translations } : {}),
      // '' clears it (→ platform default); a value pins the site-wide content width.
      containerWidth: form.containerWidth.trim() || undefined,
    };
  }

  const locales = form.locales.map((l) => l.value.trim()).filter(Boolean);
  const bundle: SettingsBundle = {
    identity,
    settings: {
      defaultLocale: form.defaultLocale.trim() || 'en',
      locales: locales.length ? locales : ['en'],
    },
  };
  return website ? { ...bundle, website } : bundle;
}

/** A fresh custom named-slot row (defaults to a system serif). */
export const newNamedSlot = (): NamedSlotForm => ({ id: rowId(), name: '', slot: { source: 'system', family: 'serif', weight: 400 } });

/** A fresh keyed row for the list editors. */
export const newPair = (): KeyedPair => ({ id: rowId(), key: '', value: '' });
export const newStr = (): KeyedStr => ({ id: rowId(), value: '' });
export const newSocial = (): KeyedSocial => ({ id: rowId(), link: '', name: '', icon: '' });
export const newRedirect = (): KeyedRedirect => ({ id: rowId(), from: '', to: '', status: 301 });
/** A fresh, empty translation row (no cells yet — the editor fills one per configured locale). */
export const newTranslationRow = (): TranslationRow => ({ id: rowId(), key: '', cells: {} });
/** A fresh shop-channel row (defaults to WhatsApp). */
export const newShopChannel = (): KeyedShopChannel => ({
  id: rowId(),
  kind: 'whatsapp',
  key: '',
  number: '',
  intro: '',
  email: '',
  subject: '',
  urlTemplate: '',
  provider: '',
  formId: '',
  fields: [],
});

/** A fresh order-field row (defaults to a required single-line text input). */
export const newShopField = (): KeyedShopField => ({ id: rowId(), key: '', type: 'text', required: true });

const SHOP_KIND_LABEL: Record<KeyedShopChannel['kind'], string> = {
  whatsapp: 'WhatsApp button',
  mailto: 'Email button',
  payment: 'Payment button',
  form: 'Order-form button',
};

/**
 * The translatable LABEL keys a shop config implies — one `shop.<key>` per configured channel and order
 * field. The editor surfaces these as ghost rows in Translations & Labels so the operator can fill the
 * label text (per locale) without hand-typing the keys. Deduped by key (a field key reused across channels
 * — e.g. `name` — is one row); blank keys skipped. The cart resolves these at render via `shop.<key>`.
 */
export function shopLabelKeys(channels: KeyedShopChannel[]): Array<{ key: string; label: string; default: string }> {
  const byKey = new Map<string, { key: string; label: string; default: string }>();
  for (const c of channels) {
    const ck = c.key.trim();
    if (ck && !byKey.has(`shop.${ck}`)) byKey.set(`shop.${ck}`, { key: `shop.${ck}`, label: SHOP_KIND_LABEL[c.kind], default: '' });
    for (const f of c.fields) {
      const fk = f.key.trim();
      if (fk && !byKey.has(`shop.${fk}`)) byKey.set(`shop.${fk}`, { key: `shop.${fk}`, label: 'Order field', default: '' });
    }
  }
  return [...byKey.values()];
}

/** Returns the object only if at least one value is defined, else undefined. */
function stripEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}
