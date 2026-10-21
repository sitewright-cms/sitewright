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
