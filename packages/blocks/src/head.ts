// Platform-managed document head: SEO/Open-Graph meta and schema.org JSON-LD.
// These are data-driven (populated from the project's company/website/page data)
// — there is no per-tenant template code here, so there is no code-exec surface.
import { escapeAttr } from './escape.js';

/** Head metadata for a page (mapped from page SEO + company/website data). */
export interface SeoMeta {
  /** Document title (already resolved: page SEO title or page title). */
  title: string;
  description?: string;
  /** Open Graph type (defaults to `website`). */
  ogType?: string;
  ogImage?: string;
  /** Canonical / og:url — should be an absolute URL when available. */
  url?: string;
  /** `theme-color` meta (company primary color). */
  themeColor?: string;
  /** Favicon URL (company icon). */
  favicon?: string;
  noindex?: boolean;
}

/** Inputs for the auto-generated schema.org Organization block (from company data). */
export interface SchemaOrgInfo {
  /** schema.org `@type` (default `Organization`); `disabled` suppresses output. */
  type?: string;
  name: string;
  url?: string;
  logo?: string;
  image?: string;
  telephone?: string;
  email?: string;
  address?: {
    street?: string;
    locality?: string;
    region?: string;
    country?: string;
    postalCode?: string;
  };
  geo?: { latitude: string; longitude: string };
  /** Social / external profile URLs (`sameAs`). */
  sameAs?: readonly string[];
}

/** Renders the `<head>` SEO + Open Graph + Twitter meta tags (all attribute-escaped). */
export function metaTags(seo: SeoMeta): string {
  const tags: string[] = [];
  const meta = (attr: string, key: string, value: string): void => {
    tags.push(`<meta ${attr}="${escapeAttr(key)}" content="${escapeAttr(value)}" />`);
  };

  if (seo.description) meta('name', 'description', seo.description);
  if (seo.noindex) meta('name', 'robots', 'noindex');
  meta('property', 'og:type', seo.ogType ?? 'website');
  meta('property', 'og:title', seo.title);
  if (seo.description) meta('property', 'og:description', seo.description);
  if (seo.ogImage) meta('property', 'og:image', seo.ogImage);
  if (seo.url) {
    meta('property', 'og:url', seo.url);
    tags.push(`<link rel="canonical" href="${escapeAttr(seo.url)}" />`);
  }
  meta('name', 'twitter:card', seo.ogImage ? 'summary_large_image' : 'summary');
  if (seo.themeColor) meta('name', 'theme-color', seo.themeColor);
  if (seo.favicon) tags.push(`<link rel="icon" href="${escapeAttr(seo.favicon)}" />`);
  return tags.join('\n');
}

// JSON embedded in <script> must not be able to close the tag or open a comment.
// Escaping `<`, `>`, `&` (as valid JSON \uXXXX escapes) neutralises `</script>`,
// `<!--`, and `<script>` breakouts while keeping the JSON parseable.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Renders an auto-generated schema.org JSON-LD `<script>` from company data, or
 * `''` when no organization info is given or its type is `disabled`. Values are
 * safe-serialized so no value can break out of the `<script>` element.
 */
export function schemaOrgJsonLd(org: SchemaOrgInfo | undefined): string {
  if (!org || org.type === 'disabled') return '';

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': org.type ?? 'Organization',
    name: org.name,
  };
  if (org.url) data.url = org.url;
  if (org.logo) data.logo = org.logo;
  if (org.image) data.image = org.image;
  if (org.telephone) data.telephone = org.telephone;
  if (org.email) data.email = org.email;

  const a = org.address;
  if (a) {
    const address: Record<string, string> = { '@type': 'PostalAddress' };
    if (a.street) address.streetAddress = a.street;
    if (a.locality) address.addressLocality = a.locality;
    if (a.region) address.addressRegion = a.region;
    if (a.country) address.addressCountry = a.country;
    if (a.postalCode) address.postalCode = a.postalCode;
    data.address = address;
  }
  if (org.geo) {
    data.geo = { '@type': 'GeoCoordinates', latitude: org.geo.latitude, longitude: org.geo.longitude };
  }
  if (org.sameAs && org.sameAs.length > 0) data.sameAs = [...org.sameAs];

  return `<script type="application/ld+json">${jsonForScript(data)}</script>`;
}
