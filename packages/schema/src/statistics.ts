import { z } from 'zod';

/**
 * BUILT-IN STATISTICS — the platform's own visit counter, shared by the collector (api), the Statistics tab
 * (editor) and the `get_site_stats` agent tool (mcp).
 *
 * The design goal is to be cheap, not exhaustive. Nothing is stored per visit: the collector classifies each
 * pageview as it arrives, adds it to in-memory counters, and writes DAILY TOTALS once a minute. There is no
 * raw-event table, so there is nothing to re-slice later — a breakdown exists only if it was counted on the
 * day. What IS counted:
 *
 *   - every pageview, split into HUMAN and BOT traffic (bots further into categories);
 *   - for humans: the device class (desktop / mobile / tablet) and the country, as one cube, so any
 *     combination of the two can be filtered;
 *   - pages (human and bot views), traffic sources (search / social / AI / referral / campaign / direct),
 *     and goals (form submissions).
 *
 * A VISITOR is a daily identifier: a hash of a salt that rotates at midnight UTC, the site, the IP address and
 * the browser. Neither the IP nor the user agent is stored; the salt is deleted after two days, so a visitor
 * cannot be followed from one day to the next — which is also why visitors over a range are the SUM of daily
 * visitors.
 */

/** How long daily totals are kept: 25 months, the CNIL audience-measurement ceiling. */
export const STATS_RETENTION_MONTHS = 25;

/** The device classes the collector distinguishes. Bots carry no device. */
export const STATS_DEVICES = ['desktop', 'mobile', 'tablet'] as const;
export type StatsDevice = (typeof STATS_DEVICES)[number];

/**
 * Traffic classes. `human` is organic traffic — a real browser that ran the page's script. Everything else is a
 * bot, by what it is for: a search-engine crawler, an AI crawler or assistant, an SEO tool, an uptime monitor,
 * a social-preview fetcher, or `bot` when it is a bot of no known kind (a headless browser, a script).
 */
export const STATS_CLASSES = ['human', 'search', 'ai', 'seo', 'monitor', 'social', 'bot'] as const;
export type StatsClass = (typeof STATS_CLASSES)[number];
export const STATS_BOT_CLASSES = STATS_CLASSES.filter((c) => c !== 'human') as Exclude<StatsClass, 'human'>[];

/** Where a human visit came from — decided on the visitor's FIRST pageview of the day. */
export const STATS_SOURCES = ['direct', 'search', 'social', 'ai', 'referral', 'campaign'] as const;
export type StatsSource = (typeof STATS_SOURCES)[number];

/** The `website.statistics` setting. Off unless switched on: a site never counts visits nobody asked it to. */
export const WebsiteStatisticsSchema = z.object({
  /** Count visits with the built-in statistics. Publishing adds a small cookieless script to every page. */
  enabled: z.boolean().optional(),
});
export type WebsiteStatistics = z.infer<typeof WebsiteStatisticsSchema>;

/** A calendar day in UTC, `YYYY-MM-DD`. */
export const StatsDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day is YYYY-MM-DD');

/** The query the Statistics tab, the CSV export and the agent tool send. */
export const StatsQuerySchema = z.object({
  from: StatsDaySchema,
  to: StatsDaySchema,
  /** Narrow the HUMAN breakdowns to one device class. */
  device: z.enum(STATS_DEVICES).optional(),
  /** Narrow the HUMAN breakdowns to one country (ISO 3166-1 alpha-2, or `ZZ` for unknown). */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'a country is a two-letter ISO code')
    .optional(),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export interface StatsCount {
  views: number;
  visitors: number;
}

/** The answer to a {@link StatsQuery}. Counts are for the whole range, both ends included. */
export interface SiteStats {
  from: string;
  to: string;
  /** Whether the site is counting right now (`website.statistics.enabled`). */
  enabled: boolean;
  /** Human traffic, after the device/country filter. */
  human: StatsCount;
  /** All bot traffic, unfiltered (bots have no device; the country filter does not apply to them). */
  botViews: number;
  /** One entry per day of the range, oldest first, zero-filled. */
  daily: Array<{ day: string; views: number; visitors: number; botViews: number }>;
  /** Human traffic per device class (country filter applied, device filter not). */
  devices: Array<{ device: StatsDevice; views: number; visitors: number }>;
  /** Human traffic per country, busiest first (device filter applied, country filter not). `ZZ` = unknown. */
  countries: Array<{ country: string; views: number; visitors: number }>;
  /** Bot views per class, busiest first. */
  bots: Array<{ class: Exclude<StatsClass, 'human'>; views: number }>;
  /** Pages by human views, busiest first (the device/country filter does not apply to pages). */
  pages: Array<{ path: string; views: number; botViews: number }>;
  /** Where human visitors came from, busiest first. `host` is the referring site, or the campaign name. */
  sources: Array<{ source: StatsSource; host: string; visitors: number }>;
  /** Goal completions (form submissions), busiest first. `goal` is `form:<formId>`. */
  goals: Array<{ goal: string; label: string; count: number }>;
  /**
   * Something the owner should know about how visits are counted:
   *   - `no-public-url` — the site is also deployed to another host, but the instance has no public URL
   *     (`SW_PUBLIC_URL`), so pages there have no address to report visits to and are published without the
   *     counter. Only locally hosted visits are counted.
   */
  notice?: 'no-public-url';
}

/** Today in UTC as `YYYY-MM-DD`. */
export function statsDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** `day` moved by `delta` whole days (UTC). */
export function shiftStatsDay(day: string, delta: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The first day still inside the retention window, counted back from `today`. The day of the month is clamped to
 * the target month's length (31 October minus 25 months is 30 September, not "31 September" = 1 October).
 */
export function statsRetentionStart(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const months = y * 12 + (m - 1) - STATS_RETENTION_MONTHS;
  const year = Math.floor(months / 12);
  const month = months % 12; // 0-based
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}
