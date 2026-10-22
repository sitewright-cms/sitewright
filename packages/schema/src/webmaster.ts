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
 * SITE REGISTRATION — a project's site registered with the platform's Google and Bing accounts. Agency staff switch
 * each search engine on per project and start the verification themselves (the Search engines tile); nothing is
 * registered on its own. Verifying gets the account's tag, deploys the site carrying it, then asks the search engine
 * to confirm. From then on every build keeps the tag, or the search engine would drop the site again.
 *
 * - `off`: this search engine is switched off for the project (or the platform has no account for it).
 * - `none`: switched on, never verified for the current Production URL.
 * - `pending`: the tag is ready; the site has not been verified with it yet.
 * - `verified`: the platform account owns the site (Google: also in Search Console).
 * - `failed`: the last step was refused; `detail` says why.
 */
export const SITE_REGISTRATION_STATUSES = ['off', 'none', 'pending', 'verified', 'failed'] as const;
export type SiteRegistrationStatus = (typeof SITE_REGISTRATION_STATUSES)[number];

/** The last time the site's sitemap was handed to a search engine. */
export interface SitemapSubmission {
  /** Whether the search engine took it (it reads the sitemap itself later, on its own schedule). */
  ok: boolean;
  /** What it said. Never a secret. */
  detail: string;
  at: string;
}

export interface SiteRegistrationEntry {
  /** Whether the platform has an account for this search engine at all (System Settings). */
  configured: boolean;
  /** Switched on for this project. */
  enabled: boolean;
  status: SiteRegistrationStatus;
  /** Why it failed, or what was done. Never a secret. */
  detail: string | null;
  verifiedAt: string | null;
  /** When the platform last asked the search engine. */
  checkedAt: string | null;
  /** The last sitemap submission for the current registration; null when there was none. */
  sitemap: SitemapSubmission | null;
  /**
   * Google only (always empty for Bing): the Google accounts staff made owners of the site in Search Console, so
   * they can open its reports themselves. The platform's service account owns it too and is not listed.
   */
  owners: string[];
  /** Google only: why `owners` did not get access at the last verification (a retry is offered); null when they did. */
  ownersIssue: string | null;
}

/** A project's registration with the platform's search engine accounts (agency staff only). */
export interface SiteRegistrationView {
  /** The URL that is registered: the website's Production URL, when it is an https address. */
  siteUrl: string | null;
  /** The sitemap the search engines are given: `sitemap.xml` at the root of `siteUrl` (every build writes it there). */
  sitemapUrl: string | null;
  /** Why nothing can be registered, when `siteUrl` is null. */
  notice: 'no-site-url' | 'not-https' | null;
  google: SiteRegistrationEntry;
  bing: SiteRegistrationEntry;
}

/** Switch search engines on or off for a project. Off removes the site from that search engine's account. */
export const SiteRegistrationToggleSchema = z
  .object({ google: z.boolean().optional(), bing: z.boolean().optional() })
  .strict()
  .refine((v) => v.google !== undefined || v.bing !== undefined, { message: 'name google or bing' });
export type SiteRegistrationToggle = z.infer<typeof SiteRegistrationToggleSchema>;

/** One step of a verification, for one search engine: done, or why not. */
export interface SiteRegistrationStepResult {
  ok: boolean;
  detail: string;
}

/** The answer to getting the tags (before the deploy): per switched-on search engine, then the new state. */
export interface SiteRegistrationPrepareResult {
  results: Partial<Record<WebmasterService, SiteRegistrationStepResult>>;
  view: SiteRegistrationView;
}

/** The answer to asking one search engine to verify (after the deploy). */
export interface SiteRegistrationVerifyResult {
  result: SiteRegistrationStepResult;
  view: SiteRegistrationView;
}

/** The answer to one action on one search engine (verify, submit the sitemap, set the owners): done or why not. */
export type SiteRegistrationActionResult = SiteRegistrationVerifyResult;

/** How many people staff may make owners of one site in Search Console. */
export const SEARCH_CONSOLE_OWNERS_MAX = 10;

/**
 * The Google accounts that should own the site in Search Console (beside the service account), as a whole list:
 * whoever is left out is removed. Addresses are compared without case; duplicates collapse to one.
 */
export const SiteOwnersInputSchema = z
  .object({
    owners: z
      .array(z.string().trim().toLowerCase().max(254).email('each owner is an email address of a Google account'))
      .max(SEARCH_CONSOLE_OWNERS_MAX, `at most ${SEARCH_CONSOLE_OWNERS_MAX} owners`),
  })
  .strict()
  .transform((v) => ({ owners: [...new Set(v.owners)] }));
export type SiteOwnersInput = z.infer<typeof SiteOwnersInputSchema>;

/** The answer to a switch: the new state, and what removing the site from a search engine said. */
export interface SiteRegistrationToggleResult {
  removed: Partial<Record<WebmasterService, SiteRegistrationStepResult>>;
  view: SiteRegistrationView;
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

/** The sitemap of a registered site: `sitemap.xml` under it, where every build with a Production URL writes one. */
export function sitemapUrlOf(registeredSiteUrl: string | null): string | null {
  return registeredSiteUrl ? `${registeredSiteUrl}sitemap.xml` : null;
}
