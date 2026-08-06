import { renderSecurityTxt, securityTxtExpiresInDays } from '../publish/seo.js';

/**
 * The PLATFORM's own RFC 9116 security.txt, served at `/.well-known/security.txt`.
 *
 * Distinct from the per-project file the publisher emits into a client's site: this one describes
 * how to report a vulnerability in THIS INSTANCE of Sitewright. Without it the path answers with the
 * editor SPA's index.html (the not-found handler falls back to the shell for any non-API GET), so a
 * scanner asking for security.txt gets a 200 and a page of HTML.
 *
 * Generated per request rather than written to disk, which is what makes the short window below
 * safe: `Expires` is always ~90 days out and can never rot the way a committed file would.
 */

/**
 * Where a vulnerability in the SOFTWARE goes when the operator hasn't named their own channel.
 * A self-hosted instance's most likely finding is a platform bug, and this is a real, monitored
 * private channel (it is what SECURITY.md tells reporters to use), so it beats serving nothing.
 * Operators who trige their own reports set SW_SECURITY_CONTACT and this drops out.
 */
export const UPSTREAM_SECURITY_CONTACT = 'https://github.com/sitewright-cms/sitewright/security/advisories/new';
/** The `Policy` link — the repo's SECURITY.md, which states scope, expectations and disclosure terms. */
export const UPSTREAM_SECURITY_POLICY = 'https://github.com/sitewright-cms/sitewright/blob/main/SECURITY.md';
/** How far out `Expires` sits. Short on purpose — it is recomputed on every request. */
export const PLATFORM_SECURITY_TXT_DAYS = 90;

export interface PlatformSecurityTxtOptions {
  /** Generation time — injected so the output is deterministic under test. */
  readonly now: Date;
  /** `SW_SECURITY_CONTACT`, already split. Empty/absent → the upstream default above. */
  readonly contacts?: readonly string[];
  /** `SW_PUBLIC_URL`, used for `Canonical`. Omitted when the instance has no configured origin. */
  readonly publicUrl?: string;
}

/** Render the instance's security.txt. Pure — the route just sends what this returns. */
export function renderPlatformSecurityTxt(opts: PlatformSecurityTxtOptions): string {
  const configured = (opts.contacts ?? []).filter((c) => c.length > 0);
  // An operator-set contact REPLACES the upstream default rather than joining it: whoever runs the
  // instance decides who fields its reports, and a list is ordered by preference, so silently
  // appending an upstream link would put a third party in their disclosure path.
  const contacts = configured.length > 0 ? configured : [UPSTREAM_SECURITY_CONTACT];
  return renderSecurityTxt({
    contacts,
    expires: securityTxtExpiresInDays(opts.now, PLATFORM_SECURITY_TXT_DAYS),
    canonical: opts.publicUrl ? `${opts.publicUrl.replace(/\/+$/, '')}/.well-known/security.txt` : undefined,
    // The policy describes the SOFTWARE's disclosure process and holds for every instance, so it is
    // emitted even when the operator has redirected the contact to themselves.
    policy: UPSTREAM_SECURITY_POLICY,
    preferredLanguages: 'en',
  });
}

/**
 * Parse `SW_SECURITY_CONTACT`: a comma-separated list of URIs in preference order.
 *
 * RFC 9116 §2.5.3 requires each `Contact` to be a URI, and for a web link specifically an https one;
 * anything else is DROPPED rather than published, because an unparseable contact in a machine-read
 * file is worse than the default. CR/LF and stray whitespace are stripped so a value from the
 * environment cannot inject an extra field.
 */
export function parseSecurityContacts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.replace(/[\r\n]/g, '').trim())
    .filter((v) => /^(https:\/\/\S+|mailto:\S+@\S+|tel:\+[1-9]\d{6,14})$/.test(v))
    .slice(0, 5);
}
