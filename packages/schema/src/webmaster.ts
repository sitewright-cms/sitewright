import { z } from 'zod';

/**
 * SEARCH ENGINE ACCOUNTS — the ONE Google service account and the ONE Bing Webmaster Tools account the platform
 * registers its sites with, so no project owner needs a Search Console or Bing account of their own.
 *
 * Instance admins enter them in System Settings; they are kept encrypted in the database (never in env vars or
 * files) and are never sent back to the browser. What the admin view may show is only who the Google key belongs to.
 */

export const WEBMASTER_SERVICES = ['google', 'bing'] as const;
export const WebmasterServiceSchema = z.enum(WEBMASTER_SERVICES);
export type WebmasterService = z.infer<typeof WebmasterServiceSchema>;

/** A Google service-account key file is about 2.4 KB; anything past this is not one. */
export const GOOGLE_KEY_FILE_MAX_BYTES = 16 * 1024;

/** A Bing Webmaster Tools API key: letters and digits (32 hex characters as issued), checked before it is stored. */
export const BING_API_KEY_RE = /^[A-Za-z0-9]{16,128}$/;

/** A save: a field left out keeps what is stored, `null` removes it. */
export const WebmasterAccountsInputSchema = z
  .object({
    /** The downloaded JSON key file, as text. */
    google: z
      .object({ keyFile: z.string().min(1).max(GOOGLE_KEY_FILE_MAX_BYTES) })
      .strict()
      .nullable()
      .optional(),
    bing: z
      .object({ apiKey: z.string().trim().regex(BING_API_KEY_RE, 'a Bing Webmaster API key is 16 to 128 letters and digits') })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type WebmasterAccountsInput = z.infer<typeof WebmasterAccountsInputSchema>;

export interface WebmasterAccountsView {
  google: {
    configured: boolean;
    /** The service account the key belongs to: the identity that will own the platform's verified sites. */
    clientEmail: string | null;
    /** The Google Cloud project the key was made in (where the two APIs must be enabled). */
    projectId: string | null;
    updatedAt: string | null;
  };
  bing: { configured: boolean; updatedAt: string | null };
}

/** The answer of a test: what the account can see, or why the service refused. Never a secret. */
export interface WebmasterTestResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

/**
 * SITE REGISTRATION — every publish and deploy puts the platform accounts' verification tags in each page's
 * `<head>`, then asks the search engine to verify the site and, for Google, adds it to Search Console.
 *
 * - `none`: nothing tried yet (no deploy since the account or the site URL was set).
 * - `pending`: the tag is in the build; the search engine has not confirmed it yet.
 * - `verified`: the platform account owns the site (Google: also in Search Console).
 * - `failed`: the last attempt was refused; `detail` says why, and the next deploy tries again.
 */
export const SITE_REGISTRATION_STATUSES = ['none', 'pending', 'verified', 'failed'] as const;
export type SiteRegistrationStatus = (typeof SITE_REGISTRATION_STATUSES)[number];

export interface SiteRegistrationEntry {
  /** Whether the platform has an account for this search engine at all. */
  configured: boolean;
  status: SiteRegistrationStatus;
  /** Why it failed, or what was done. Never a secret. */
  detail: string | null;
  verifiedAt: string | null;
  /** When the platform last asked the search engine. */
  checkedAt: string | null;
}

/** A project's registration with the platform's search engine accounts (agency staff only). */
export interface SiteRegistrationView {
  /** The URL that is registered: the website's Site URL, when it is an https address. */
  siteUrl: string | null;
  /** Why nothing is registered, when `siteUrl` is null. */
  notice: 'no-site-url' | 'not-https' | null;
  google: SiteRegistrationEntry;
  bing: SiteRegistrationEntry;
}

/**
 * The address a site is registered under: the website's Site URL as an https URL-prefix property (origin and path,
 * ending in `/`, no query or fragment). Null when it is missing or not https: neither search engine verifies a
 * plain-http site for a platform account, and a registration under the wrong scheme is a different property.
 */
export function registrableSiteUrl(siteUrl: string | null | undefined): string | null {
  if (!siteUrl) return null;
  let url: URL;
  try {
    url = new URL(siteUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}
