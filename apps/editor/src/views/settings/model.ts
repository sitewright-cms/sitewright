import type { CorporateIdentity, SettingsBundle, WebsiteSettings } from '../../api';

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
  // website
  siteUrl: string;
  criticalCss: string;
  head: string;
  scripts: string;
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
    siteUrl: w?.siteUrl ?? '',
    criticalCss: w?.criticalCss ?? '',
    head: w?.head ?? '',
    scripts: w?.scripts ?? '',
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
 * originally-loaded bundle: fields the form does NOT surface (logoLight/logoDark,
 * spacing, radii, typography.scale — e.g. set via the CLI/MCP) are carried through
 * so a GUI save never silently drops them.
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

  // typography: surfaced fontFamilies + preserved (unsurfaced) scale.
  const fonts = pairsToRecord(form.fonts);
  const scale = baseId?.typography?.scale;
  if (Object.keys(fonts).length || scale) {
    identity = put(identity, 'typography', { fontFamilies: fonts, ...(scale ? { scale } : {}) });
  }
  // Carry through token/asset fields the form doesn't expose.
  identity = put(identity, 'logoLight', baseId?.logoLight);
  identity = put(identity, 'logoDark', baseId?.logoDark);
  identity = put(identity, 'spacing', baseId?.spacing);
  identity = put(identity, 'radii', baseId?.radii);

  // website — only include the section when something is set
  let website: WebsiteSettings | undefined;
  const redirects = form.redirects
    .filter((r) => r.from.trim() && r.to.trim())
    .map((r) => ({ from: r.from.trim(), to: r.to.trim(), status: r.status as 301 | 302 | 307 | 308 }));
  const w = stripEmpty({
    siteUrl: trimmed(form.siteUrl),
    criticalCss: trimmed(form.criticalCss),
    head: trimmed(form.head),
    scripts: trimmed(form.scripts),
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

/** A fresh keyed row for the list editors. */
export const newPair = (): KeyedPair => ({ id: rowId(), key: '', value: '' });
export const newStr = (): KeyedStr => ({ id: rowId(), value: '' });
export const newRedirect = (): KeyedRedirect => ({ id: rowId(), from: '', to: '', status: 301 });

/** Returns the object only if at least one value is defined, else undefined. */
function stripEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}
