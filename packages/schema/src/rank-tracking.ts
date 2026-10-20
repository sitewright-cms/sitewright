import { z } from 'zod';

/**
 * KEYWORD RANK TRACKING — where a project's site appears in search results for keywords the agency chose, checked
 * on a schedule and kept as a history.
 *
 * Who does what:
 *   - an INSTANCE ADMIN picks the provider that runs the searches, enters its credentials and sets a monthly
 *     budget (System Settings);
 *   - AGENCY STAFF (admins, and developers on their own projects) choose each project's domain and keywords;
 *   - everyone with access to the project — the client included — can only READ the results.
 *
 * Providers are EXCHANGEABLE. A provider runs a search and returns the results page; deciding where the site
 * appears on it happens in the platform, the same way for every provider, so a history keeps its meaning when
 * the provider changes. Each check records which provider ran it.
 */

/** Providers the platform has a client for. Adding one: an id here plus a client in the api's `rank/providers`. */
export const RANK_PROVIDER_IDS = ['dataforseo'] as const;
export const RankProviderIdSchema = z.enum(RANK_PROVIDER_IDS);
export type RankProviderId = z.infer<typeof RankProviderIdSchema>;

/** Search engines a keyword can be tracked on. */
export const RANK_ENGINES = ['google'] as const;
export const RankEngineSchema = z.enum(RANK_ENGINES);
export type RankEngine = z.infer<typeof RankEngineSchema>;

/** The device the search is made from: results differ between the two. */
export const RANK_DEVICES = ['desktop', 'mobile'] as const;
export const RankDeviceSchema = z.enum(RANK_DEVICES);
export type RankDevice = z.infer<typeof RankDeviceSchema>;

/** How often a project's keywords are checked. Each check costs money. */
export const RANK_SCHEDULES = ['daily', 'weekly'] as const;
export const RankScheduleSchema = z.enum(RANK_SCHEDULES);
export type RankSchedule = z.infer<typeof RankScheduleSchema>;

/**
 * How many results a check reads. A site further down counts as "not in the top N". Providers charge per page
 * of ten results, so the depth multiplies the cost of every check.
 */
export const RANK_DEPTHS = [10, 20, 30, 50, 100] as const;
export type RankDepth = (typeof RANK_DEPTHS)[number];
export const RankDepthSchema = z
  .number()
  .int()
  .refine((n): n is RankDepth => (RANK_DEPTHS as readonly number[]).includes(n), { message: `depth must be one of ${RANK_DEPTHS.join(', ')}` });

/**
 * Where a search is made from. `name` is a Google Ads geo-target CANONICAL name — `Windhoek,Khomas Region,Namibia`
 * for a city, just `Namibia` for a country — which is the form rank-tracking providers accept, so a keyword
 * keeps working when the provider changes. `countryCode` is its ISO 3166-1 alpha-2 country.
 */
export const RankLocationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // eslint-disable-next-line no-control-regex -- deliberately refusing the C0 range
    .regex(/^[^\u0000-\u001f\u007f<>]+$/, 'a location name has no control characters or angle brackets'),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'an ISO 3166-1 alpha-2 country code, e.g. NA'),
});
export type RankLocation = z.infer<typeof RankLocationSchema>;

/** A location a provider offers, for the location picker. */
export interface RankLocationOption extends RankLocation {
  /** The provider's kind of place: Country, State, City, … */
  type: string;
}

/** The search language. A BCP 47 primary tag, optionally with a region (`en`, `pt-BR`, `zh-TW`). */
export const RankLanguageSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/, 'a language code such as en or pt-BR');

/** Common search languages for the picker. A provider may accept others; the code is what is stored. */
export const RANK_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'cs', name: 'Czech' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'sw', name: 'Swahili' },
  { code: 'zu', name: 'Zulu' },
];

/** The longest keyword accepted. Search engines cut queries off well before this. */
export const RANK_KEYWORD_MAX = 120;
/** Keywords one project may track — a guard on cost and on the size of the view, not a plan limit. */
export const RANK_KEYWORDS_PER_PROJECT_MAX = 500;

/** A keyword as it is stored: lowercased, inner whitespace collapsed (search engines ignore both). */
export function normalizeRankKeyword(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The host a project's rankings are matched against: lowercased, without a scheme, path, port or leading `www.`.
 * Accepts a bare host or a URL. Returns undefined for anything that is not a plausible public hostname.
 */
export function normalizeRankDomain(raw: string): string | undefined {
  let host = raw.trim().toLowerCase();
  if (!host) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return undefined;
    }
  } else {
    host = host.split(/[/?#]/, 1)[0] ?? '';
    host = host.replace(/:\d+$/, '');
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (host.length > 253) return undefined;
  const labels = host.split('.');
  if (labels.length < 2) return undefined;
  return labels.every((l) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(l)) ? host : undefined;
}

const RankKeywordTextSchema = z
  .string()
  .transform(normalizeRankKeyword)
  .pipe(z.string().min(1, 'a keyword cannot be empty').max(RANK_KEYWORD_MAX, `a keyword is at most ${RANK_KEYWORD_MAX} characters`))
  // eslint-disable-next-line no-control-regex -- deliberately refusing the C0 range
  .refine((k) => !/[\u0000-\u001f\u007f]/.test(k), 'a keyword has no control characters');

/** Adds keywords to a project (staff only). Every keyword gets the same engine, device, location and language. */
export const RankKeywordsInputSchema = z.object({
  keywords: z.array(RankKeywordTextSchema).min(1).max(100),
  engine: RankEngineSchema.default('google'),
  device: RankDeviceSchema.default('desktop'),
  location: RankLocationSchema,
  languageCode: RankLanguageSchema,
});
export type RankKeywordsInput = z.input<typeof RankKeywordsInputSchema>;

/** Pauses or resumes one keyword (staff only). A paused keyword keeps its history and costs nothing. */
export const RankKeywordPatchSchema = z.object({ paused: z.boolean() });

/** A project's tracking setup (staff only). */
export const RankProjectSettingsInputSchema = z.object({
  /** The site's domain, as a host or a URL. `www.` is ignored: `www.example.com` and `example.com` are one site. */
  domain: z.string().max(300).transform((d, ctx) => {
    const host = normalizeRankDomain(d);
    if (!host) {
      ctx.addIssue({ code: 'custom', message: 'enter the domain the site is published at, e.g. example.com' });
      return z.NEVER;
    }
    return host;
  }),
  /** Count a result on a subdomain (`shop.example.com`) as the site's own. */
  includeSubdomains: z.boolean().default(true),
  schedule: RankScheduleSchema.default('weekly'),
  depth: RankDepthSchema.default(100),
});
export type RankProjectSettingsInput = z.input<typeof RankProjectSettingsInputSchema>;
export type RankProjectSettings = z.output<typeof RankProjectSettingsInputSchema>;

/** The date range of a rankings read, as UTC days. Defaults to the last 90 days. */
export const RankingsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RankingsQuery = z.infer<typeof RankingsQuerySchema>;

/** One check of one keyword. `position` is null when the site was not in the results read (see `depth`). */
export interface RankPoint {
  day: string;
  position: number | null;
}

export interface RankKeywordView {
  id: string;
  keyword: string;
  engine: RankEngine;
  device: RankDevice;
  location: RankLocation;
  languageCode: string;
  paused: boolean;
  /** The newest finished check, whatever the range. */
  latest: {
    day: string;
    checkedAt: string;
    /** The organic position, 1 = the first ordinary result. Null = not in the top `depth`. */
    position: number | null;
    /** The site's page that ranked. */
    url: string | null;
    depth: number;
  } | null;
  /** Positions gained since the check before the latest (positive = moved up). Null when either is missing. */
  change: number | null;
  /** The best position in the range. */
  best: number | null;
  /** Finished checks in the range, oldest first. */
  series: RankPoint[];
  /** A check is running for this keyword. */
  pending: boolean;
}

/**
 * Why checks are not running, for staff. Clients see the results only.
 *   - `no-provider`: no provider is chosen, or it has no credentials;
 *   - `budget-reached`: this month's budget is spent; checks resume next month;
 *   - `provider-error`: the provider refused the last attempt (see the admin settings).
 */
export const RANK_STATUSES = ['ok', 'no-provider', 'budget-reached', 'provider-error'] as const;
export type RankStatus = (typeof RANK_STATUSES)[number];

/** `GET /projects/:id/rankings` */
export interface ProjectRankings {
  from: string;
  to: string;
  /** The project's setup, or null when nothing is tracked for it. */
  tracking: RankProjectSettings | null;
  keywords: RankKeywordView[];
  /** The caller may change the setup and the keywords (agency staff on this project). */
  canManage: boolean;
  /** Present for staff only. */
  status?: RankStatus;
}

/** A credential field a provider needs. `secret` fields are never sent back, only whether they are set. */
export interface RankProviderField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'select';
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** A short line under the field. */
  help?: string;
  required: boolean;
}

/** `GET /admin/rank-tracking` — one provider. */
export interface RankProviderView {
  id: RankProviderId;
  label: string;
  /** Where an admin signs up and finds the credentials. */
  signupUrl: string;
  fields: RankProviderField[];
  configured: boolean;
  /** The non-secret fields as stored, and for each secret field whether it is set. */
  values: Record<string, string>;
  secretsSet: Record<string, boolean>;
}

/** `GET /admin/rank-tracking` */
export interface RankTrackingAdminView {
  activeProvider: RankProviderId | null;
  monthlyBudgetUsd: number;
  spentThisMonthUsd: number;
  providers: RankProviderView[];
  projectsTracked: number;
  keywordsTracked: number;
  /** The provider's last refusal, if the most recent attempt failed. */
  lastError: { message: string; at: string } | null;
}

/** The ceiling on the monthly budget an admin can set, as a guard against a typo. */
export const RANK_BUDGET_MAX_USD = 10_000;

/** `PUT /admin/rank-tracking` — every part optional; an absent part is left unchanged. */
export const RankTrackingAdminInputSchema = z.object({
  activeProvider: RankProviderIdSchema.nullable().optional(),
  monthlyBudgetUsd: z.number().min(0).max(RANK_BUDGET_MAX_USD).optional(),
  /**
   * Per provider: the fields to store, or null to delete that provider's credentials. A secret field left out
   * keeps its stored value, so the form need not ask for it again.
   */
  credentials: z
    .record(RankProviderIdSchema, z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), z.string().max(500)).nullable())
    .optional(),
});
export type RankTrackingAdminInput = z.input<typeof RankTrackingAdminInputSchema>;
