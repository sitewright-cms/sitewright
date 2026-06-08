import type { CorporateIdentity, SettingsBundle, WebsiteSettings } from '../../api';
import type { JsonValue } from '@sitewright/schema';

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
export interface KeyedRedirect {
  id: string;
  from: string;
  to: string;
  status: number;
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
  social: KeyedStr[];
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
  // localization
  defaultLocale: string;
  locales: KeyedStr[];
}

const recordToPairs = (r: Record<string, string> | undefined): KeyedPair[] =>
  Object.entries(r ?? {}).map(([k, v]) => ({ id: rowId(), key: k, value: String(v) }));

const strsToKeyed = (items: string[] | undefined): KeyedStr[] => (items ?? []).map((value) => ({ id: rowId(), value }));

// Prototype-pollution keys are rejected server-side (safeRecord); mirror the guard
// client-side so they're dropped before the PUT (defense-in-depth).
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const pairsToRecord = (pairs: KeyedPair[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    if (!k || DANGEROUS_KEYS.has(k)) continue;
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
    social: strsToKeyed(id.social),
    colors: recordToPairs(id.colors),
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
    defaultLocale: bundle.settings.defaultLocale ?? 'en',
    locales: strsToKeyed(bundle.settings.locales ?? ['en']),
  };
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
  const social = form.social.map((s) => s.value.trim()).filter(Boolean);
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
    data: isEmptyData(form.data) ? undefined : form.data,
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
  if (w || redirects.length) website = { ...(w ?? {}), ...(redirects.length ? { redirects } : {}) };

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
export const newRedirect = (): KeyedRedirect => ({ id: rowId(), from: '', to: '', status: 301 });

/** An "empty" website.data (absent/null, or an empty object/array) → omitted from the saved payload. */
function isEmptyData(v: JsonValue): boolean {
  if (v == null) return true; // a null root is meaningless to address — treat as empty
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false; // a bare string/number/boolean is a real value
}

/** Returns the object only if at least one value is defined, else undefined. */
function stripEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}
