import type { WebsiteSettings } from '@sitewright/schema';

type Redirect = NonNullable<WebsiteSettings['redirects']>[number];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Normalized site origin+path with any trailing slash(es) stripped. */
export function siteBase(siteUrl: string): string {
  // Defense-in-depth: drop CR/LF before this value reaches the UNESCAPED sinks it feeds — a newline
  // in `siteUrl` would inject a `robots.txt` directive or break the sitemap `<loc>`. The schema
  // (siteUrlIssue) already rejects all whitespace at the boundary; this guards a non-API DB write.
  return siteUrl.replace(/[\r\n]/g, '').replace(/\/+$/, '');
}

/** Absolute URL for a published route slug (home → `<base>/`, else `<base>/<slug>/`). */
export function siteUrlFor(siteUrl: string, slug: string | undefined): string {
  const base = siteBase(siteUrl);
  return slug ? `${base}/${slug}/` : `${base}/`;
}

/** A sitemap.xml from absolute page URLs (callers exclude noindex pages). */
export function renderSitemap(urls: Array<{ loc: string; lastmod?: string }>): string {
  const entries = urls
    .map(
      (u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${xmlEscape(u.lastmod)}</lastmod>` : ''}</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/** robots.txt — allow-all, with the Sitemap line when a sitemap is published. */
export function renderRobots(sitemapUrl?: string): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (sitemapUrl) lines.push('', `Sitemap: ${sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}

// ---- RFC 9116 security.txt ----------------------------------------------------------------
// Published at `.well-known/security.txt` ONLY. RFC 9116 §3 makes that path a MUST and permits a
// top-level copy purely for legacy compatibility; one file can't drift from itself, and every
// scanner looks under /.well-known first, so we emit exactly one.

/** The relative path of the published file. RFC 9116 §3 — the location is normative, not a choice. */
export const SECURITY_TXT_PATH = '.well-known/security.txt';

/** Strip CR/LF so a stored value can never inject an extra field into the generated file. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

/**
 * The `Expires` value (RFC 9116 §2.5.5): an RFC 3339 UTC timestamp `years` after `from`, to the
 * second. Recomputed on every publish, so a site that is republished keeps rolling its window
 * forward and the field can never be stale relative to the artifact carrying it.
 */
export function securityTxtExpires(from: Date, years: number): string {
  const d = new Date(from.getTime());
  // setUTCFullYear normalizes Feb 29 → Mar 1 in a non-leap target year (no invalid date can escape).
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return rfc3339(d);
}

/**
 * The same value on a DAY window — used by the platform's own security.txt, which is generated per
 * request rather than baked into an artifact and so can afford (and wants) a short, always-fresh one.
 */
export function securityTxtExpiresInDays(from: Date, days: number): string {
  return rfc3339(new Date(from.getTime() + days * 24 * 60 * 60 * 1000));
}

/** RFC 3339 UTC to the second (the sub-second precision `toISOString` adds is noise here). */
function rfc3339(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * A `tel:` URI for a human-typed phone number, or null when it can't be expressed as one.
 *
 * RFC 9116 §2.5.3 requires `Contact` to be a URI, so a bare "030 12345 67" is not publishable. We
 * drop the presentation characters people type and accept the international `00` access prefix as
 * `+`, but we NEVER invent a country code — a national number with no `+` is ambiguous, and a wrong
 * guess would publish a phone number that dials the wrong country.
 */
export function telUri(telephone: string): string | null {
  const compact = telephone
    .trim()
    // "(0)" in e.g. "+49 (0)30 …" is the national trunk prefix, parenthesised precisely because it is
    // OMITTED when dialling internationally — dropping it is what makes the E.164 form correct.
    .replace(/\(0\)/g, '')
    .replace(/[\s().\-/]/g, '')
    // "00" is the international access prefix in most of the world; "+" is its E.164 spelling.
    .replace(/^00/, '+');
  return E164.test(compact) ? `tel:${compact}` : null;
}

/**
 * The author's contact SELECTION, resolved against what the project actually holds.
 * `undefined` = not selected · `null` = selected but the project has no usable value · string = value.
 */
export interface SecurityTxtSelection {
  /** Absolute URL of the chosen contact page (null when that page is not in this publish). */
  readonly contactPageUrl?: string | null;
  readonly telephone?: string | null;
  readonly email?: string | null;
}

/** A selected contact source that yielded no usable URI — named so the publish error can say which. */
export type UnresolvedContact = 'page' | 'phone' | 'email';

/**
 * `Contact` URIs in preference order, plus any SELECTED source that produced nothing.
 *
 * Order is page → phone → email, and RFC 9116 §2.5.3 makes that order meaningful (most-preferred
 * first). The contact PAGE leads because it stays reachable for exactly as long as the site does
 * and its submissions are stored server-side even if email delivery behind it has rotted; the
 * `mailto:` trails because this file is public, machine-read, and harvested.
 */
export function securityTxtContacts(selection: SecurityTxtSelection): {
  contacts: string[];
  unresolved: UnresolvedContact[];
} {
  const contacts: string[] = [];
  const unresolved: UnresolvedContact[] = [];
  const take = (source: UnresolvedContact, selected: string | null | undefined, uri: (v: string) => string | null): void => {
    if (selected === undefined) return; // not selected — nothing to resolve
    const value = selected === null ? null : uri(selected);
    if (value) contacts.push(value);
    else unresolved.push(source);
  };
  take('page', selection.contactPageUrl, (v) => v);
  take('phone', selection.telephone, telUri);
  take('email', selection.email, (v) => `mailto:${v}`);
  return { contacts, unresolved };
}

/** Everything the file states. `contacts` must be non-empty — RFC 9116 §2.5.3 requires one. */
export interface SecurityTxtOptions {
  readonly contacts: readonly string[];
  readonly expires: string;
  readonly canonical?: string;
  readonly policy?: string;
  readonly acknowledgments?: string;
  readonly preferredLanguages?: string;
}

/**
 * Render an RFC 9116 security.txt. Field order follows preference (Contact first); `Expires` is
 * emitted exactly once and `Preferred-Languages` at most once, both as the RFC requires. Values are
 * CR/LF-stripped on the way out — defense-in-depth behind the schema's boundary rejection, mirroring
 * {@link siteBase}, since every line here is written UNESCAPED.
 */
export function renderSecurityTxt(opts: SecurityTxtOptions): string {
  const lines = ['# Security contact information for this site — https://www.rfc-editor.org/info/rfc9116'];
  for (const contact of opts.contacts) lines.push(`Contact: ${oneLine(contact)}`);
  lines.push(`Expires: ${oneLine(opts.expires)}`);
  if (opts.preferredLanguages) lines.push(`Preferred-Languages: ${oneLine(opts.preferredLanguages)}`);
  if (opts.canonical) lines.push(`Canonical: ${oneLine(opts.canonical)}`);
  if (opts.policy) lines.push(`Policy: ${oneLine(opts.policy)}`);
  if (opts.acknowledgments) lines.push(`Acknowledgments: ${oneLine(opts.acknowledgments)}`);
  return `${lines.join('\n')}\n`;
}

/** Apache `.htaccess` redirect rules (mod_alias). */
export function renderHtaccess(redirects: readonly Redirect[], opts: { denyFiles?: readonly string[] } = {}): string {
  const parts: string[] = ['# Generated by Sitewright'];
  // Deny direct access to sensitive generated files (today: the contact.php SMTP credentials).
  // Apache-only and therefore BELT-AND-BRACES, never the primary defence — nginx ignores
  // .htaccess entirely, and the file carries its own PHP-level guard for exactly that reason.
  for (const file of opts.denyFiles ?? []) {
    parts.push(
      `<Files "${file}">`,
      '  <IfModule mod_authz_core.c>',
      '    Require all denied',
      '  </IfModule>',
      '  <IfModule !mod_authz_core.c>',
      '    Order allow,deny',
      '    Deny from all',
      '  </IfModule>',
      '</Files>',
    );
  }
  if (redirects.length > 0) {
    const rules = redirects.map((r) => `  Redirect ${r.status} ${r.from} ${r.to}`).join('\n');
    parts.push('<IfModule mod_alias.c>', rules, '</IfModule>');
  }
  return `${parts.join('\n')}\n`;
}

/** Netlify-style `_redirects` (one rule per line). */
export function renderNetlifyRedirects(redirects: readonly Redirect[]): string {
  return `${redirects.map((r) => `${r.from} ${r.to} ${r.status}`).join('\n')}\n`;
}
