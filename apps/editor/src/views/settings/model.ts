import type { CorporateIdentity, SettingsBundle, WebsiteSettings } from '../../api';
import { DEFAULT_BRAND_COLORS, MANDATORY_COLOR_TOKENS, type JsonValue, type ShopChannel, type ShopCurrency } from '@sitewright/schema';
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

/**
 * A MINI SHOP submission channel as edited in the form — a FLAT row holding every kind's fields; only
 * the ones relevant to `kind` are surfaced + persisted (the rest stay blank). Mirrors the schema's
 * `ShopChannel` discriminated union (whatsapp/mailto/payment/form).
 */
export interface KeyedShopChannel {
  id: string;
  kind: ShopChannel['kind'];
  label: string;
  number: string; // whatsapp
  intro: string; // whatsapp
  email: string; // mailto
  subject: string; // mailto
  urlTemplate: string; // payment
  provider: string; // payment ('' | paypal | stripe | custom)
  formId: string; // form
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
  redirects: KeyedRedirect[];
  // mini shop (website.shop): currency + submission channels (front-end cart)
  shopCurrencyCode: string;
  shopCurrencySymbol: string;
  shopCurrencyPosition: 'before' | 'after';
  shopCurrencyDecimals: string;
  shopAddToCartLabel: string;
  shopTitle: string;
  shopNote: string;
  shopChannels: KeyedShopChannel[];
  // localization
  defaultLocale: string;
  locales: KeyedStr[];
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
    redirects: (w?.redirects ?? []).map((r) => ({ id: rowId(), from: r.from, to: r.to, status: r.status })),
    shopCurrencyCode: w?.shop?.currency?.code ?? '',
    shopCurrencySymbol: w?.shop?.currency?.symbol ?? '',
    shopCurrencyPosition: w?.shop?.currency?.position ?? 'before',
    shopCurrencyDecimals: w?.shop?.currency?.decimals != null ? String(w.shop.currency.decimals) : '2',
    shopAddToCartLabel: w?.shop?.addToCartLabel ?? '',
    shopTitle: w?.shop?.title ?? '',
    shopNote: w?.shop?.note ?? '',
    shopChannels: (w?.shop?.channels ?? []).map((c) => ({
      id: rowId(),
      kind: c.kind,
      label: c.label ?? '',
      number: c.kind === 'whatsapp' ? c.number : '',
      intro: c.kind === 'whatsapp' ? c.intro ?? '' : '',
      email: c.kind === 'mailto' ? c.email : '',
      subject: c.kind === 'mailto' ? c.subject ?? '' : '',
      urlTemplate: c.kind === 'payment' ? c.urlTemplate : '',
      provider: c.kind === 'payment' ? c.provider ?? '' : '',
      formId: c.kind === 'form' ? c.formId : '',
    })),
    defaultLocale: bundle.settings.defaultLocale ?? 'en',
    locales: strsToKeyed(bundle.settings.locales ?? ['en']),
  };
}

/** Currency decimals: empty/non-numeric → 2 (schema default); else a truncated, [0,4]-clamped integer. */
function decimalsOf(raw: string): number {
  const n = Number(raw.trim());
  return raw.trim() && Number.isFinite(n) ? Math.max(0, Math.min(4, Math.trunc(n))) : 2;
}

/** Build a `ShopChannel` from a form row, dropping the row when its required field is blank. */
function formChannelToShop(c: KeyedShopChannel): ShopChannel | null {
  const label = c.label.trim() ? { label: c.label.trim() } : {};
  if (c.kind === 'whatsapp') {
    return c.number.trim()
      ? { kind: 'whatsapp', ...label, number: c.number.trim(), ...(c.intro.trim() ? { intro: c.intro.trim() } : {}) }
      : null;
  }
  if (c.kind === 'mailto') {
    return c.email.trim()
      ? { kind: 'mailto', ...label, email: c.email.trim(), ...(c.subject.trim() ? { subject: c.subject.trim() } : {}) }
      : null;
  }
  if (c.kind === 'payment') {
    // A legacy `stripe` (offered by an earlier UI) folds to `custom` — Stripe Payment Links are fixed-amount.
    const provider = c.provider.trim() === 'stripe' ? 'custom' : c.provider.trim();
    return c.urlTemplate.trim()
      ? {
          kind: 'payment',
          ...label,
          urlTemplate: c.urlTemplate.trim(),
          ...(provider === 'paypal' || provider === 'custom' ? { provider } : {}),
        }
      : null;
  }
  return c.formId.trim() ? { kind: 'form', ...label, formId: c.formId.trim() } : null;
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
  // mini shop: currency (only when code + symbol are both set) + the configured channels.
  const shopCurrency: ShopCurrency | undefined =
    form.shopCurrencyCode.trim() && form.shopCurrencySymbol.trim()
      ? {
          code: form.shopCurrencyCode.trim(),
          symbol: form.shopCurrencySymbol.trim(),
          position: form.shopCurrencyPosition,
          // Empty or non-numeric → the schema default (2); otherwise truncate to an integer and clamp
          // to the schema range [0,4] (a cleared field must NOT silently become 0, and "1.5" must not
          // be sent — the schema is .int().min(0).max(4)).
          decimals: decimalsOf(form.shopCurrencyDecimals),
        }
      : undefined;
  const shopChannels = form.shopChannels
    .map(formChannelToShop)
    .filter((c): c is ShopChannel => c !== null);
  const shop =
    shopCurrency || shopChannels.length || form.shopAddToCartLabel.trim() || form.shopTitle.trim() || form.shopNote.trim()
      ? {
          ...(shopCurrency ? { currency: shopCurrency } : {}),
          ...(shopChannels.length ? { channels: shopChannels } : {}),
          ...(trimmed(form.shopAddToCartLabel) ? { addToCartLabel: form.shopAddToCartLabel.trim() } : {}),
          ...(trimmed(form.shopTitle) ? { title: form.shopTitle.trim() } : {}),
          ...(trimmed(form.shopNote) ? { note: form.shopNote.trim() } : {}),
        }
      : undefined;
  if (w || redirects.length || shop) {
    website = { ...(w ?? {}), ...(redirects.length ? { redirects } : {}), ...(shop ? { shop } : {}) };
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
/** A fresh shop-channel row (defaults to WhatsApp). */
export const newShopChannel = (): KeyedShopChannel => ({
  id: rowId(),
  kind: 'whatsapp',
  label: '',
  number: '',
  intro: '',
  email: '',
  subject: '',
  urlTemplate: '',
  provider: '',
  formId: '',
});

/** Returns the object only if at least one value is defined, else undefined. */
function stripEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}
