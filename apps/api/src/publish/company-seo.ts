import type { CorporateIdentity } from '@sitewright/schema';
import type { SchemaOrgInfo } from '@sitewright/blocks';

// The company-derived fields of a Corporate Identity (i.e. NOT the brand tokens or
// the brand-derived logo/favicon assets). schema.org JSON-LD is emitted only when
// at least one of these is set — so a project with only a name + brand tokens (the
// migrated brand-only case) emits no structured data, preserving pre-merge output.
const COMPANY_FIELDS = [
  'legalName',
  'shortName',
  'slogan',
  'description',
  'businessType',
  'logo',
  'icon',
  'image',
  'telephone',
  'email',
  'address',
  'geo',
  'social',
] as const;

function hasCompanyData(id: CorporateIdentity): boolean {
  return COMPANY_FIELDS.some((f) => {
    // eslint-disable-next-line security/detect-object-injection -- f is a typed literal from COMPANY_FIELDS
    const v = id[f];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== '';
  });
}

/**
 * Maps a project's Corporate Identity to the renderer's schema.org input. Returns
 * `undefined` when the identity carries no company data (just a name/brand tokens)
 * or the author set `businessType: 'disabled'` — so no JSON-LD is emitted. `name`
 * falls back legalName → shortName → the project name so a record is always nameable.
 */
export function companyToOrganization(
  identity: CorporateIdentity | undefined,
  fallbackName: string,
): SchemaOrgInfo | undefined {
  if (!identity || !hasCompanyData(identity)) return undefined;
  if (identity.businessType?.trim().toLowerCase() === 'disabled') return undefined;
  const name = identity.legalName || identity.shortName || fallbackName;
  if (!name) return undefined;

  const org: SchemaOrgInfo = { name };
  if (identity.businessType) org.type = identity.businessType;
  if (identity.logo) org.logo = identity.logo;
  if (identity.image) org.image = identity.image;
  if (identity.telephone) org.telephone = identity.telephone;
  if (identity.email) org.email = identity.email;
  if (identity.address) org.address = identity.address;
  if (identity.geo) org.geo = identity.geo;
  if (identity.social && identity.social.length > 0) org.sameAs = identity.social.map((s) => s.link);
  return org;
}
