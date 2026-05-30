import type { Company } from '@sitewright/schema';
import type { SchemaOrgInfo } from '@sitewright/blocks';

/**
 * Maps a project's corporate identity to the renderer's schema.org input.
 * Returns `undefined` when there's no company data or the author explicitly set
 * `businessType: 'disabled'` (so no JSON-LD is emitted). `name` falls back from
 * legalName → shortName → the project name so a record is always nameable.
 */
export function companyToOrganization(
  company: Company | undefined,
  fallbackName: string,
): SchemaOrgInfo | undefined {
  if (!company || company.businessType?.trim().toLowerCase() === 'disabled') return undefined;
  // fallbackName is the project name (schema-validated min(1)), so this is a
  // defensive guard — `name` is never empty in practice.
  const name = company.legalName || company.shortName || fallbackName;
  if (!name) return undefined;

  const org: SchemaOrgInfo = { name };
  if (company.businessType) org.type = company.businessType;
  if (company.logo) org.logo = company.logo;
  if (company.image) org.image = company.image;
  if (company.telephone) org.telephone = company.telephone;
  if (company.email) org.email = company.email;
  if (company.address) org.address = company.address;
  if (company.geo) org.geo = company.geo;
  if (company.social && company.social.length > 0) org.sameAs = company.social;
  return org;
}
