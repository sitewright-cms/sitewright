import { BrandSchema, type Brand } from './brand.js';
import { CompanySchema, type Company } from './company.js';
import { CorporateIdentitySchema, type CorporateIdentity } from './corporate-identity.js';

// Keys we never copy from an untrusted record into a spread (prototype-pollution
// defense-in-depth; Zod also strips them downstream, but don't carry them at all).
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Map a legacy `{ brand, company }` pair to the unified {@link CorporateIdentity}.
 * Every field of both old schemas lands in exactly one identity field (asserted by
 * the exhaustive field-map test) — a miss would silently drop brand/company data
 * on publish. The logo collision (old `brand.logo` was an object `{light,dark,
 * favicon}`; old `company.logo` was a single ref) splits cleanly into
 * `logo`/`logoLight`/`logoDark`/`favicon`.
 */
export function legacyToIdentity(brand: Brand, company?: Company): CorporateIdentity {
  return CorporateIdentitySchema.parse({
    // identity / naming — name comes from the (required) brand name
    name: brand.name,
    legalName: company?.legalName,
    shortName: company?.shortName,
    slogan: company?.slogan,
    description: company?.description,
    businessType: company?.businessType,
    // visual assets
    logo: company?.logo,
    logoLight: brand.logo?.light,
    logoDark: brand.logo?.dark,
    icon: company?.icon,
    favicon: brand.logo?.favicon,
    image: company?.image,
    // contact / structured data
    email: company?.email,
    telephone: company?.telephone,
    address: company?.address,
    geo: company?.geo,
    social: company?.social,
    // design tokens
    colors: brand.colors,
    typography: brand.typography,
    spacing: brand.spacing,
    radii: brand.radii,
  });
}

/**
 * Normalize any record that carries identity at its top level (a project manifest,
 * a `settings` row, or a bundle's `project`) to the unified shape: if it already
 * has `identity`, it's returned unchanged; if it has the legacy `brand` (+optional
 * `company`), those are folded into `identity` and removed. Applied at every read
 * boundary (DB settings row, bundle import, on-disk loader) so old data upgrades
 * transparently. Returns a shallow copy; the caller's schema does the final parse.
 */
export function mergeLegacyIdentity(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.identity !== undefined) return obj; // already unified
  if (obj.brand === undefined) return obj; // nothing to migrate (defensive)
  const brand = BrandSchema.parse(obj.brand);
  const company = obj.company !== undefined ? CompanySchema.parse(obj.company) : undefined;
  const rest = Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== 'brand' && k !== 'company' && !DANGEROUS_KEYS.has(k)),
  );
  return { ...rest, identity: legacyToIdentity(brand, company) };
}
