import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  RankProviderIdSchema,
  statsRetentionStart,
  type RankDailyStat,
  type RankDevice,
  type RankEngine,
  type RankKeywordsInput,
  type RankProjectSettings,
  type RankProviderId,
  type RankSchedule,
} from '@sitewright/schema';
import type { Database } from '../db/client.js';
import {
  projects,
  rankCharges,
  rankChecks,
  rankKeywords,
  rankProjects,
  rankProviderCredentials,
  rankTrackingConfig,
  RANK_TRACKING_CONFIG_ID,
} from '../db/schema.js';
import { decryptSecret, encryptSecret } from '../crypto/secret.js';
import { newId } from '../id.js';
import { EncryptionUnavailableError } from '../repo/instance-settings.js';
import type { PageReading } from './match.js';

/** The monthly budget until an admin sets one: small enough that a mistake is cheap. */
export const DEFAULT_RANK_BUDGET_MICROS = 10_000_000;
/** A check still `posting` after this died mid-request (a restart): failed, its estimated cost kept. */
const POSTING_STALE_MS = 60 * 60 * 1000;
/** A queued check whose result never came. A queue answers within the hour; DataForSEO keeps results 30 days. */
const QUEUED_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * A check waiting for its next stage this long after its last one, with its day over, is done with what it read. Not at
 * midnight itself: a stage sent at 23:50 and collected after midnight still goes on to the next.
 */
const NEXT_STALE_MS = 6 * 60 * 60 * 1000;

export interface RankConfig {
  activeProvider: RankProviderId | null;
  monthlyBudgetMicros: number;
  lastError: { message: string; at: Date } | null;
}

export interface RankKeywordRow {
  id: string;
  projectId: string;
  keyword: string;
  engine: RankEngine;
  device: RankDevice;
  locationName: string;
  countryCode: string;
  languageCode: string;
  paused: boolean;
  createdAt: Date;
}

/** A keyword that is due a check, with what the check needs from its project. */
export interface DueKeyword extends RankKeywordRow {
  depth: number;
  domain: string;
  includeSubdomains: boolean;
}

/** A check in flight: where it stands, and the site it was sent for. */
export interface CheckProgress {
  id: string;
  keywordId: string;
  projectId: string;
  provider: string;
  /** The UTC day the check is for. */
  day: string;
  depth: number;
  /** The site the check was sent for (not the project's current setup). */
  domain: string;
  includeSubdomains: boolean;
  /** What the check's earlier stages read (zero for its first): the stage in flight is read on from these. */
  resultsRead: number;
  pagesRead: number;
  /** What the check's earlier stages cost, in micro-dollars: the stage in flight's charge adds to it. */
  settledMicros: number;
  /** Same-day tries after a search the provider could not run. */
  attempts: number;
  /** The check is a second reading confirming a drop to "not found": its result is final. */
  confirming: boolean;
  /**
   * Sent before checks were read in stages, for its whole depth at once: its one result finishes it, however many pages
   * came back (a provider that does not say Google stopped would otherwise send it on for pages it already paid for).
   */
  fullDepth?: boolean;
}

/** A check whose request is with the provider: `ref` collects its result. */
export interface QueuedCheck extends CheckProgress {
  ref: string;
}

/** A check whose earlier stages did not find the site, due to read its next pages — with what sending them needs. */
export interface ContinuingCheck extends CheckProgress {
  keyword: string;
  engine: RankEngine;
  device: RankDevice;
  locationName: string;
  countryCode: string;
  languageCode: string;
}

export interface DoneCheck {
  keywordId: string;
  day: string;
  position: number | null;
  url: string | null;
  depth: number;
  checkedAt: Date;
  featured: boolean;
  /** Null for a check finished before these were recorded (and not re-read since). */
  resultsRead: number | null;
  pagesRead: number | null;
  /** Google's list ended where the check stopped (false: the check stopped short of it); null before this was recorded. */
  listEnded: boolean | null;
}

/** A finished check whose stored result can still be fetched again, to fill in what it did not keep. */
export interface RereadableCheck {
  id: string;
  ref: string;
  depth: number;
  domain: string;
  includeSubdomains: boolean;
}

/** `YYYY-MM-DD` `days` before/after `day`. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** How far back a check still counts as recent enough, per schedule (a weekly keyword is due 7 days on). */
const SCHEDULE_DAYS: Record<RankSchedule, number> = { daily: 1, weekly: 7 };

/**
 * The most one check is ever booked at. No search costs anything near it; a provider figure past it is an error
 * (a unit mix-up, a corrupt reply), and storing it unbounded could break the month's sum.
 */
const MAX_CHECK_COST_USD = 100;
const toMicros = (usd: number): number => (Number.isFinite(usd) ? Math.round(Math.min(MAX_CHECK_COST_USD, Math.max(0, usd)) * 1_000_000) : 0);

/** What a results page says, as the check's columns. */
const readingColumns = (r: PageReading) => ({
  position: r.hit?.position ?? null,
  absolutePosition: r.hit?.absolutePosition ?? null,
  url: r.hit?.url ?? null,
  featured: r.hit?.featured ?? false,
  resultsRead: r.resultsRead,
  pagesRead: r.pagesRead,
  listEnded: r.listEnded,
});

/** Retention deletes this many rows per statement, and at most this many statements per table a day. */
const PRUNE_BATCH = 5000;
const PRUNE_MAX_BATCHES = 40;

/** Runs `step` (one bounded DELETE) until it removes fewer than `batch` rows or `maxBatches` ran; how many it removed. */
async function inBatches(batch: number, maxBatches: number, step: () => Promise<{ rowsAffected: number }>): Promise<number> {
  let removed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { rowsAffected } = await step();
    removed += rowsAffected;
    if (rowsAffected < batch) break;
  }
  return removed;
}

/** The UTC month (`YYYY-MM`) a moment falls in: the budget month a check claimed then counts against. */
export const utcMonth = (at: Date): string => at.toISOString().slice(0, 7);

export class RankRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey?: Buffer,
  ) {}

  // ---- Instance config (admin) ----

  async getConfig(): Promise<RankConfig> {
    const [row] = await this.db.select().from(rankTrackingConfig).where(eq(rankTrackingConfig.id, RANK_TRACKING_CONFIG_ID));
    if (!row) return { activeProvider: null, monthlyBudgetMicros: DEFAULT_RANK_BUDGET_MICROS, lastError: null };
    const active = RankProviderIdSchema.safeParse(row.activeProvider);
    return {
      activeProvider: active.success ? active.data : null,
      monthlyBudgetMicros: row.monthlyBudgetMicros,
      lastError: row.lastError && row.lastErrorAt ? { message: row.lastError, at: row.lastErrorAt } : null,
    };
  }

  async putConfig(patch: { activeProvider?: RankProviderId | null; monthlyBudgetMicros?: number }): Promise<void> {
    const current = await this.getConfig();
    const now = new Date();
    const values = {
      id: RANK_TRACKING_CONFIG_ID,
      activeProvider: patch.activeProvider !== undefined ? patch.activeProvider : current.activeProvider,
      monthlyBudgetMicros: patch.monthlyBudgetMicros ?? current.monthlyBudgetMicros,
      updatedAt: now,
    };
    await this.db
      .insert(rankTrackingConfig)
      .values(values)
      .onConflictDoUpdate({
        target: rankTrackingConfig.id,
        set: { activeProvider: values.activeProvider, monthlyBudgetMicros: values.monthlyBudgetMicros, updatedAt: now },
      });
  }

  /**
   * Records (or, with null, clears) the provider's last refusal for the admin view. Writes ONLY those columns:
   * the tracker calls this mid-pass, and must never write back a provider or budget an admin just changed.
   */
  async setLastError(message: string | null, now = new Date()): Promise<void> {
    const lastErrorAt = message ? now : null;
    await this.db
      .insert(rankTrackingConfig)
      .values({ id: RANK_TRACKING_CONFIG_ID, activeProvider: null, monthlyBudgetMicros: DEFAULT_RANK_BUDGET_MICROS, lastError: message, lastErrorAt, updatedAt: now })
      .onConflictDoUpdate({ target: rankTrackingConfig.id, set: { lastError: message, lastErrorAt } });
  }

  // ---- Provider credentials (admin) ----

  /** The decrypted fields, or null when none are stored. */
  async getCredentials(provider: RankProviderId): Promise<Record<string, string> | null> {
    const [row] = await this.db.select().from(rankProviderCredentials).where(eq(rankProviderCredentials.provider, provider));
    if (!row) return null;
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    const parsed = JSON.parse(decryptSecret(row.secret, this.encryptionKey)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }

  async listConfiguredProviders(): Promise<Set<string>> {
    const rows = await this.db.select({ provider: rankProviderCredentials.provider }).from(rankProviderCredentials);
    return new Set(rows.map((r) => r.provider));
  }

  /** Stores the fields (encrypted), or with null deletes them. */
  async putCredentials(provider: RankProviderId, fields: Record<string, string> | null): Promise<void> {
    if (fields === null) {
      await this.db.delete(rankProviderCredentials).where(eq(rankProviderCredentials.provider, provider));
      return;
    }
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    const secret = encryptSecret(JSON.stringify(fields), this.encryptionKey);
    const now = new Date();
    await this.db
      .insert(rankProviderCredentials)
      .values({ provider, secret, updatedAt: now })
      .onConflictDoUpdate({ target: rankProviderCredentials.provider, set: { secret, updatedAt: now } });
  }

  // ---- Project setup and keywords (staff) ----

  async getProject(projectId: string): Promise<RankProjectSettings | null> {
    const [row] = await this.db.select().from(rankProjects).where(eq(rankProjects.projectId, projectId));
    if (!row) return null;
    return {
      domain: row.domain,
      includeSubdomains: row.includeSubdomains,
      schedule: row.schedule,
      depth: row.depth as RankProjectSettings['depth'],
    };
  }

  async putProject(projectId: string, s: RankProjectSettings): Promise<void> {
    const now = new Date();
    const set = { domain: s.domain, includeSubdomains: s.includeSubdomains, schedule: s.schedule, depth: s.depth, updatedAt: now };
    await this.db
      .insert(rankProjects)
      .values({ projectId, ...set })
      .onConflictDoUpdate({ target: rankProjects.projectId, set });
  }

  async listKeywords(projectId: string): Promise<RankKeywordRow[]> {
    return this.db
      .select()
      .from(rankKeywords)
      .where(eq(rankKeywords.projectId, projectId))
      .orderBy(asc(rankKeywords.keyword), asc(rankKeywords.locationName), asc(rankKeywords.device));
  }

  async countKeywords(projectId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(rankKeywords).where(eq(rankKeywords.projectId, projectId));
    return row?.n ?? 0;
  }

  /** Adds keywords; one already tracked with the same engine, device, location and language is left as it is. */
  async addKeywords(
    projectId: string,
    input: Omit<RankKeywordsInput, 'engine' | 'device'> & { engine: RankEngine; device: RankDevice },
  ): Promise<{ added: number; existing: number }> {
    const unique = [...new Set(input.keywords)];
    const now = new Date();
    const rows = unique.map((keyword) => ({
      id: newId(),
      projectId,
      keyword,
      engine: input.engine,
      device: input.device,
      locationName: input.location.name,
      countryCode: input.location.countryCode,
      languageCode: input.languageCode,
      paused: false,
      createdAt: now,
    }));
    if (rows.length === 0) return { added: 0, existing: 0 };
    const inserted = await this.db.insert(rankKeywords).values(rows).onConflictDoNothing().returning({ id: rankKeywords.id });
    return { added: inserted.length, existing: rows.length - inserted.length };
  }

  async setPaused(projectId: string, keywordId: string, paused: boolean): Promise<boolean> {
    const res = await this.db
      .update(rankKeywords)
      .set({ paused })
      .where(and(eq(rankKeywords.id, keywordId), eq(rankKeywords.projectId, projectId)))
      .returning({ id: rankKeywords.id });
    return res.length > 0;
  }

  /** Removes a keyword AND its history. What its checks cost stays spent (`rank_charges` is not touched). */
  async removeKeyword(projectId: string, keywordId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: rankKeywords.id })
        .from(rankKeywords)
        .where(and(eq(rankKeywords.id, keywordId), eq(rankKeywords.projectId, projectId)));
      if (!row) return false;
      await tx.delete(rankChecks).where(eq(rankChecks.keywordId, keywordId));
      await tx.delete(rankKeywords).where(eq(rankKeywords.id, keywordId));
      return true;
    });
  }

  // ---- Checks (the tracker) ----

  /**
   * Keywords due a check on `today`: not paused, in a live project with a setup, not checked today, and with no
   * finished or running check recent enough for the project's schedule (a FAILED check does not count, so a
   * weekly keyword whose check failed is tried again the next day rather than the next week).
   * Longest-unchecked first, so a tight budget rotates through every project instead of always serving the same.
   * `projectId` limits it to one project; `force` treats every keyword as daily (a "check now").
   */
  async dueKeywords(today: string, limit: number, opts: { projectId?: string; force?: boolean } = {}): Promise<DueKeyword[]> {
    const weeklyCutoff = shiftDay(today, -(SCHEDULE_DAYS.weekly - 1));
    const cutoff = opts.force ? sql`${today}` : sql`CASE ${rankProjects.schedule} WHEN 'daily' THEN ${today} ELSE ${weeklyCutoff} END`;
    const recent = sql`EXISTS (SELECT 1 FROM ${rankChecks} c WHERE c.keyword_id = ${rankKeywords.id}
      AND (c.day = ${today} OR (c.day >= ${cutoff} AND c.status <> 'failed')))`;
    const lastChecked = sql`(SELECT MAX(c.day) FROM ${rankChecks} c WHERE c.keyword_id = ${rankKeywords.id})`;
    const rows = await this.db
      .select({ k: rankKeywords, depth: rankProjects.depth, domain: rankProjects.domain, includeSubdomains: rankProjects.includeSubdomains })
      .from(rankKeywords)
      .innerJoin(rankProjects, eq(rankProjects.projectId, rankKeywords.projectId))
      .innerJoin(projects, eq(projects.id, rankKeywords.projectId))
      .where(
        and(
          isNull(projects.deletedAt),
          eq(rankKeywords.paused, false),
          opts.projectId ? eq(rankKeywords.projectId, opts.projectId) : undefined,
          sql`NOT ${recent}`,
        ),
      )
      // NULL (never checked) sorts first in SQLite's ascending order. Among keywords as long unchecked, identical
      // searches side by side: a provider that reads them once (two projects tracking one keyword in one place) finds
      // them in the same pass, however far apart they were added.
      .orderBy(
        sql`${lastChecked} ASC`,
        asc(rankKeywords.engine),
        sql`lower(trim(${rankKeywords.keyword}))`,
        asc(rankKeywords.locationName),
        asc(rankKeywords.countryCode),
        asc(rankKeywords.languageCode),
        asc(rankKeywords.device),
        asc(rankKeywords.createdAt),
      )
      .limit(limit);
    return rows.map((r) => ({ ...r.k, depth: r.depth, domain: r.domain, includeSubdomains: r.includeSubdomains }));
  }

  /**
   * ★ CLAIMS the day's check for a keyword BEFORE the provider is called, booking its estimated cost. Returns the
   * check id, or null when the keyword already has a check that day — so two passes (or a pass and a "check now")
   * can never send the same keyword twice in a day.
   */
  async claim(k: DueKeyword, day: string, provider: RankProviderId, estimateUsd: number, now: Date): Promise<string | null> {
    const id = newId();
    // ONE batch — one transaction, run without a break on one connection: the check and its charge land together or
    // not at all, so no crash between the two can leave a claim whose cost the budget does not see.
    const [rows] = await this.db.batch([
      this.db
        .insert(rankChecks)
        .values({
          id,
          keywordId: k.id,
          projectId: k.projectId,
          day,
          provider,
          status: 'posting',
          domain: k.domain,
          includeSubdomains: k.includeSubdomains,
          depth: k.depth,
          // Read in stages from its first page (a check sent before stages has no count here at all: `fullDepth`).
          pagesRead: 0,
          costMicros: toMicros(estimateUsd),
          postedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: rankChecks.id }),
      // Only when the check above went in: a claim that lost to another the same day books nothing.
      this.db
        .insert(rankCharges)
        .select(
          this.db
            .select({ checkId: rankChecks.id, month: sql<string>`${utcMonth(now)}`.as('month'), costMicros: rankChecks.costMicros })
            .from(rankChecks)
            .where(eq(rankChecks.id, id)),
        ),
    ]);
    return rows[0]?.id ?? null;
  }

  /**
   * Takes back a claim the provider certainly did not act on (it refused the request as a whole), and its charge. The
   * charge goes too when the check is already gone (its project was purged meanwhile) — nothing was sent for it either
   * way — but never while the check is still there in another state: that one went out and may have been charged.
   *
   * A claim for a LATER stage gives back that stage only: the check returns to `next`, booked at what its earlier
   * stages cost — those went out and were paid for. `settledMicros` is that cost, passed in rather than read: when the
   * check went meanwhile (its keyword removed), its charge keeps what the earlier stages cost instead of going.
   */
  async release(id: string, settledMicros = 0): Promise<void> {
    // A check's first claim, never tried before: nothing about it is worth keeping. Anything else goes back to waiting,
    // its earlier tries kept: a later stage as `next` (what it read stands), a retry or a confirmation that has read
    // nothing yet as `retry`, due at once — never `next`, which would end its day as a "not found" it never read.
    const fresh = sql`COALESCE(${rankChecks.pagesRead}, 0) = 0 AND ${rankChecks.attempts} = 0 AND ${rankChecks.confirming} = 0`;
    const firstStage = and(eq(rankChecks.id, id), eq(rankChecks.status, 'posting'), fresh);
    const waiting = and(eq(rankChecks.id, id), eq(rankChecks.status, 'posting'), sql`NOT (${fresh})`);
    const gone = and(eq(rankCharges.checkId, id), sql`NOT EXISTS (SELECT 1 FROM ${rankChecks} WHERE ${rankChecks.id} = ${id})`);
    await this.db.batch([
      this.db.delete(rankChecks).where(firstStage),
      this.db
        .update(rankChecks)
        .set({ status: sql`CASE WHEN COALESCE(${rankChecks.pagesRead}, 0) = 0 THEN 'retry' ELSE 'next' END`, costMicros: sql`${rankChecks.costSettledMicros}` })
        .where(waiting),
      settledMicros > 0 ? this.db.update(rankCharges).set({ costMicros: settledMicros }).where(gone) : this.db.delete(rankCharges).where(gone),
      this.db
        .update(rankCharges)
        .set({ costMicros: sql`(SELECT ${rankChecks.costMicros} FROM ${rankChecks} WHERE ${rankChecks.id} = ${id})` })
        .where(and(eq(rankCharges.checkId, id), sql`EXISTS (SELECT 1 FROM ${rankChecks} WHERE ${rankChecks.id} = ${id} AND ${rankChecks.status} IN ('next', 'retry'))`)),
    ]);
  }

  /**
   * A stage that did not find the site, with more to read: the check waits for its next stage (`next`) with what it has
   * read so far. What the stage cost is settled — the provider's figure when it stated one with the result, otherwise
   * the stage's booked cost — so the next stage's charge adds to it.
   */
  async markNext(id: string, reading: PageReading, checkedAt: Date, costUsd?: number, settledMicros = 0): Promise<void> {
    const total = costUsd !== undefined ? settledMicros + toMicros(costUsd) : undefined;
    const update = this.db
      .update(rankChecks)
      .set({
        status: 'next',
        ...readingColumns(reading),
        checkedAt,
        error: null,
        providerRef: null,
        // Without a figure from the provider, the booked cost stands as the stage's cost.
        ...(total !== undefined ? { costMicros: total, costSettledMicros: total } : { costSettledMicros: sql`${rankChecks.costMicros}` }),
      })
      .where(eq(rankChecks.id, id));
    if (total === undefined) await update;
    else await this.db.batch([update, this.charge(id, total)]);
  }

  /**
   * A search the provider could not run, tried again at `retryAt` (the same day): the check waits as `retry`, its pages
   * read so far kept, so the retry reads on from the stage that failed. What the failed try cost is settled — the
   * provider's figure when it gave one (usually nothing: a search it could not run is not charged), otherwise its booked
   * cost.
   */
  async markRetry(id: string, error: string, retryAt: Date, costUsd?: number, settledMicros = 0): Promise<void> {
    const total = costUsd !== undefined ? settledMicros + toMicros(costUsd) : undefined;
    const update = this.db
      .update(rankChecks)
      .set({
        status: 'retry',
        retryAt,
        attempts: sql`${rankChecks.attempts} + 1`,
        error: error.slice(0, 300),
        providerRef: null,
        ...(total !== undefined ? { costMicros: total, costSettledMicros: total } : { costSettledMicros: sql`${rankChecks.costMicros}` }),
      })
      .where(eq(rankChecks.id, id));
    if (total === undefined) await update;
    else await this.db.batch([update, this.charge(id, total)]);
  }

  /**
   * A keyword that ranked before now reads "not found": read once more from the first page at `retryAt`, and THAT reading
   * is recorded. What the first reading cost is settled, as for {@link markNext}.
   */
  async markConfirm(id: string, retryAt: Date, costUsd?: number, settledMicros = 0): Promise<void> {
    const total = costUsd !== undefined ? settledMicros + toMicros(costUsd) : undefined;
    const update = this.db
      .update(rankChecks)
      .set({
        status: 'retry',
        retryAt,
        confirming: true,
        providerRef: null,
        error: null,
        // From the first page again.
        pagesRead: 0,
        resultsRead: 0,
        position: null,
        absolutePosition: null,
        url: null,
        featured: false,
        ...(total !== undefined ? { costMicros: total, costSettledMicros: total } : { costSettledMicros: sql`${rankChecks.costMicros}` }),
      })
      .where(eq(rankChecks.id, id));
    if (total === undefined) await update;
    else await this.db.batch([update, this.charge(id, total)]);
  }

  /** The position of the keyword's last finished check before `day` — null when it was not found, undefined when there is none. */
  async lastPosition(keywordId: string, day: string, domain: string): Promise<number | null | undefined> {
    const [row] = await this.db
      .select({ position: rankChecks.position, domain: rankChecks.domain })
      .from(rankChecks)
      .where(and(eq(rankChecks.keywordId, keywordId), eq(rankChecks.status, 'done'), lt(rankChecks.day, day)))
      .orderBy(desc(rankChecks.day))
      .limit(1);
    // A check for another domain (the project changed it) says nothing about this one.
    return row && row.domain === domain ? row.position : undefined;
  }

  /** What the checks of each day since `fromDay` did, per provider, newest first (the admin's view). */
  async dailyStats(fromDay: string): Promise<RankDailyStat[]> {
    const rows = await this.db
      .select({
        day: rankChecks.day,
        provider: rankChecks.provider,
        checks: count(),
        found: sql<number>`SUM(CASE WHEN ${rankChecks.status} = 'done' AND ${rankChecks.position} IS NOT NULL THEN 1 ELSE 0 END)`,
        notFound: sql<number>`SUM(CASE WHEN ${rankChecks.status} = 'done' AND ${rankChecks.position} IS NULL THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${rankChecks.status} = 'failed' THEN 1 ELSE 0 END)`,
        running: sql<number>`SUM(CASE WHEN ${rankChecks.status} IN ('posting', 'queued', 'next', 'retry') THEN 1 ELSE 0 END)`,
        retried: sql<number>`SUM(CASE WHEN ${rankChecks.attempts} > 0 THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${rankChecks.confirming} THEN 1 ELSE 0 END)`,
        pages: sql<number>`COALESCE(SUM(${rankChecks.pagesRead}), 0)`,
        costMicros: sql<number>`COALESCE(SUM(${rankChecks.costMicros}), 0)`,
      })
      .from(rankChecks)
      .where(gte(rankChecks.day, fromDay))
      .groupBy(rankChecks.day, rankChecks.provider)
      .orderBy(desc(rankChecks.day), asc(rankChecks.provider));
    return rows.map((r) => ({
      day: r.day,
      provider: r.provider,
      checks: Number(r.checks),
      found: Number(r.found),
      notFound: Number(r.notFound),
      failed: Number(r.failed),
      running: Number(r.running),
      retried: Number(r.retried),
      confirmed: Number(r.confirmed),
      pages: Number(r.pages),
      costUsd: Number(r.costMicros) / 1_000_000,
    }));
  }

  /**
   * ★ CLAIMS a waiting check's next stage, booking the stage's estimated cost on top of what the earlier stages cost —
   * before the provider is called, as for {@link claim}. False when the check is no longer waiting.
   */
  async claimStage(id: string, estimateUsd: number, now: Date): Promise<boolean> {
    const [rows] = await this.db.batch([
      this.db
        .update(rankChecks)
        .set({ status: 'posting', costMicros: sql`${rankChecks.costSettledMicros} + ${toMicros(estimateUsd)}`, postedAt: now, providerRef: null })
        .where(and(eq(rankChecks.id, id), inArray(rankChecks.status, ['next', 'retry'])))
        .returning({ id: rankChecks.id }),
      this.db
        .update(rankCharges)
        .set({ costMicros: sql`(SELECT ${rankChecks.costMicros} FROM ${rankChecks} WHERE ${rankChecks.id} = ${id})` })
        .where(and(eq(rankCharges.checkId, id), sql`EXISTS (SELECT 1 FROM ${rankChecks} WHERE ${rankChecks.id} = ${id} AND ${rankChecks.status} = 'posting')`)),
    ]);
    return rows.length > 0;
  }

  /**
   * Checks waiting for their next stage with `provider` — of one project, or all — oldest first. A check of a provider
   * no longer active waits until its day ends and is then done with what it read (`expireStale`).
   */
  async continuing(limit: number, provider: string, now: Date, projectId?: string): Promise<ContinuingCheck[]> {
    const waiting = or(eq(rankChecks.status, 'next'), and(eq(rankChecks.status, 'retry'), lte(rankChecks.retryAt, now)));
    const rows = await this.db
      .select({
        id: rankChecks.id,
        keywordId: rankChecks.keywordId,
        projectId: rankChecks.projectId,
        provider: rankChecks.provider,
        day: rankChecks.day,
        depth: rankChecks.depth,
        domain: rankChecks.domain,
        includeSubdomains: rankChecks.includeSubdomains,
        resultsRead: rankChecks.resultsRead,
        pagesRead: rankChecks.pagesRead,
        settledMicros: rankChecks.costSettledMicros,
        attempts: rankChecks.attempts,
        confirming: rankChecks.confirming,
        keyword: rankKeywords.keyword,
        engine: rankKeywords.engine,
        device: rankKeywords.device,
        locationName: rankKeywords.locationName,
        countryCode: rankKeywords.countryCode,
        languageCode: rankKeywords.languageCode,
      })
      .from(rankChecks)
      .innerJoin(rankKeywords, eq(rankKeywords.id, rankChecks.keywordId))
      .innerJoin(projects, eq(projects.id, rankChecks.projectId))
      .where(and(waiting, eq(rankChecks.provider, provider), isNull(projects.deletedAt), projectId ? eq(rankChecks.projectId, projectId) : undefined))
      .orderBy(asc(rankChecks.postedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, resultsRead: r.resultsRead ?? 0, pagesRead: r.pagesRead ?? 0 }));
  }

  /**
   * The check's charge, set to `costMicros` — whether or not the check is still there: a check whose keyword or project
   * went while it was in flight was still paid for. The month is the claim's (kept on an update); only a charge somehow
   * missing is booked in the current month.
   */
  private charge(id: string, costMicros: number) {
    return this.db
      .insert(rankCharges)
      .values({ checkId: id, month: utcMonth(new Date()), costMicros })
      .onConflictDoUpdate({ target: rankCharges.checkId, set: { costMicros } });
  }

  /**
   * Sent: the provider's id for the search, and what it charged — replacing the stage's estimate. `settledMicros` is what
   * the check's earlier stages cost (zero for its first): passed in rather than read, so the charge comes out right
   * even when the check went (its keyword removed) while the request was out.
   */
  async markQueued(id: string, ref: string, costUsd: number, settledMicros = 0): Promise<void> {
    const costMicros = settledMicros + toMicros(costUsd);
    await this.db.batch([
      this.db.update(rankChecks).set({ status: 'queued', providerRef: ref, costMicros }).where(eq(rankChecks.id, id)),
      this.charge(id, costMicros),
    ]);
  }

  /**
   * Finished, with the reading of every stage it read. `costUsd` replaces the stage's booked cost when the provider
   * stated one with the result (a live search, a run's charge); it adds to `settledMicros`, as for {@link markQueued}.
   */
  async markDone(id: string, reading: PageReading, checkedAt: Date, costUsd?: number, settledMicros = 0): Promise<void> {
    const costMicros = costUsd !== undefined ? settledMicros + toMicros(costUsd) : undefined;
    const update = this.db
      .update(rankChecks)
      .set({
        status: 'done',
        ...readingColumns(reading),
        checkedAt,
        error: null,
        ...(costMicros !== undefined ? { costMicros } : {}),
      })
      .where(eq(rankChecks.id, id));
    if (costMicros === undefined) await update;
    else await this.db.batch([update, this.charge(id, costMicros)]);
  }

  /**
   * Failed, for the day. `costUsd` is the provider's stated charge when it gave one; without it the booked cost
   * stays — the outcome is uncertain, so the budget assumes it was paid.
   */
  async markFailed(id: string, error: string, costUsd?: number, settledMicros = 0): Promise<void> {
    const costMicros = costUsd !== undefined ? settledMicros + toMicros(costUsd) : undefined;
    const update = this.db
      .update(rankChecks)
      .set({ status: 'failed', error: error.slice(0, 300), ...(costMicros !== undefined ? { costMicros } : {}) })
      .where(eq(rankChecks.id, id));
    if (costMicros === undefined) await update;
    else await this.db.batch([update, this.charge(id, costMicros)]);
  }

  /** Queued checks to collect, oldest first — of one project, or all. */
  async queuedChecks(limit: number, projectId?: string): Promise<QueuedCheck[]> {
    const rows = await this.db
      .select({
        id: rankChecks.id,
        keywordId: rankChecks.keywordId,
        projectId: rankChecks.projectId,
        provider: rankChecks.provider,
        ref: rankChecks.providerRef,
        day: rankChecks.day,
        depth: rankChecks.depth,
        domain: rankChecks.domain,
        includeSubdomains: rankChecks.includeSubdomains,
        resultsRead: rankChecks.resultsRead,
        pagesRead: rankChecks.pagesRead,
        settledMicros: rankChecks.costSettledMicros,
        attempts: rankChecks.attempts,
        confirming: rankChecks.confirming,
      })
      .from(rankChecks)
      .where(and(eq(rankChecks.status, 'queued'), projectId ? eq(rankChecks.projectId, projectId) : undefined))
      .orderBy(asc(rankChecks.postedAt))
      .limit(limit);
    return rows.flatMap((r) => (r.ref ? [{ ...r, ref: r.ref, resultsRead: r.resultsRead ?? 0, pagesRead: r.pagesRead ?? 0, fullDepth: r.pagesRead === null }] : []));
  }

  /**
   * Finished checks of `provider` posted since `since` whose stored result has never been read for what they lack
   * (results read, pages, a featured snippet) — the checks made before those were recorded. Newest first: those
   * shape the chart, and the oldest are the next to expire at the provider anyway.
   */
  async rereadable(provider: string, since: Date, limit: number): Promise<RereadableCheck[]> {
    const rows = await this.db
      .select({ id: rankChecks.id, ref: rankChecks.providerRef, depth: rankChecks.depth, domain: rankChecks.domain, includeSubdomains: rankChecks.includeSubdomains })
      .from(rankChecks)
      .where(
        and(
          eq(rankChecks.provider, provider),
          eq(rankChecks.status, 'done'),
          isNull(rankChecks.resultsRead),
          isNull(rankChecks.rereadAt),
          gte(rankChecks.postedAt, since),
        ),
      )
      .orderBy(desc(rankChecks.postedAt))
      .limit(limit);
    return rows.flatMap((r) => (r.ref ? [{ ...r, ref: r.ref }] : []));
  }

  /**
   * Records a re-read: with a reading, the check is read again from its stored result under today's rules; without
   * one (the result is gone, or could not be read), it stays as it was. Either way it is not tried again.
   */
  async markReread(id: string, reading: PageReading | null, now: Date): Promise<void> {
    await this.db
      .update(rankChecks)
      .set({ ...(reading ? readingColumns(reading) : {}), rereadAt: now })
      .where(and(eq(rankChecks.id, id), eq(rankChecks.status, 'done')));
  }

  /**
   * Fails checks that can no longer finish: a send cut off by a restart, a result that never came. A check still
   * waiting for its next stage once its day is over (the budget ran out, the provider changed) is DONE with what it
   * read: the site was not in those results, and the history says how many there were.
   */
  async expireStale(now: Date): Promise<number> {
    const over = and(lt(rankChecks.day, utcDay(now)), lte(rankChecks.postedAt, new Date(now.getTime() - NEXT_STALE_MS)));
    const waiting = await this.db
      .update(rankChecks)
      .set({ status: 'done' })
      .where(and(eq(rankChecks.status, 'next'), over))
      .returning({ id: rankChecks.id });
    // A retry its day ran out on: a confirmation that never ran keeps the first reading's answer — not found (how many
    // results it read is gone with the restart); a search that read earlier pages is done with what they held; one the
    // provider never ran at all stays failed.
    const confirming = sql`${rankChecks.confirming} = 1`;
    const readSome = sql`COALESCE(${rankChecks.pagesRead}, 0) > 0`;
    const retries = await this.db
      .update(rankChecks)
      .set({
        status: sql`CASE WHEN ${confirming} OR ${readSome} THEN 'done' ELSE 'failed' END`,
        error: sql`CASE WHEN ${confirming} OR ${readSome} THEN NULL ELSE ${rankChecks.error} END`,
        resultsRead: sql`CASE WHEN ${confirming} THEN NULL ELSE ${rankChecks.resultsRead} END`,
        pagesRead: sql`CASE WHEN ${confirming} THEN NULL ELSE ${rankChecks.pagesRead} END`,
        listEnded: sql`CASE WHEN ${confirming} THEN NULL ELSE ${rankChecks.listEnded} END`,
      })
      .where(and(eq(rankChecks.status, 'retry'), over))
      .returning({ id: rankChecks.id });
    const posting = await this.db
      .update(rankChecks)
      .set({ status: 'failed', error: 'the request to the provider did not finish' })
      .where(and(eq(rankChecks.status, 'posting'), lte(rankChecks.postedAt, new Date(now.getTime() - POSTING_STALE_MS))))
      .returning({ id: rankChecks.id });
    const queued = await this.db
      .update(rankChecks)
      .set({ status: 'failed', error: 'the provider never returned a result' })
      .where(and(eq(rankChecks.status, 'queued'), lte(rankChecks.postedAt, new Date(now.getTime() - QUEUED_STALE_MS))))
      .returning({ id: rankChecks.id });
    return waiting.length + retries.length + posting.length + queued.length;
  }

  /**
   * What the checks claimed in `at`'s UTC month cost, in micro-dollars — claims in flight at their estimate. Read from
   * the charges, which outlive removed keywords and purged projects: their checks were paid for all the same.
   */
  async spentMicrosInMonth(at: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${rankCharges.costMicros}), 0)` })
      .from(rankCharges)
      .where(eq(rankCharges.month, utcMonth(at)));
    return Number(row?.total ?? 0);
  }

  /**
   * RETENTION: deletes checks posted before the first day still inside `STATS_RETENTION_MONTHS` of `today`, and charges
   * of months wholly before it (no budget reads them: it counts the current month only). In bounded batches, so the
   * tracker's pass is never held behind one huge delete; what is left past `maxBatches` goes the next day.
   */
  async pruneOld(today: string, batch = PRUNE_BATCH, maxBatches = PRUNE_MAX_BATCHES): Promise<{ checks: number; charges: number }> {
    const start = statsRetentionStart(today);
    const before = new Date(`${start}T00:00:00Z`);
    const checks = await inBatches(batch, maxBatches, () =>
      this.db
        .delete(rankChecks)
        .where(inArray(rankChecks.id, this.db.select({ id: rankChecks.id }).from(rankChecks).where(lt(rankChecks.postedAt, before)).limit(batch))),
    );
    const charges = await inBatches(batch, maxBatches, () =>
      this.db
        .delete(rankCharges)
        .where(inArray(rankCharges.checkId, this.db.select({ id: rankCharges.checkId }).from(rankCharges).where(lt(rankCharges.month, start.slice(0, 7))).limit(batch))),
    );
    return { checks, charges };
  }

  /** Finished checks of a project's keywords for `domain` between two days (inclusive), oldest first. */
  async history(projectId: string, domain: string, from: string, to: string): Promise<DoneCheck[]> {
    const rows = await this.db
      .select({
        keywordId: rankChecks.keywordId,
        day: rankChecks.day,
        position: rankChecks.position,
        url: rankChecks.url,
        depth: rankChecks.depth,
        checkedAt: rankChecks.checkedAt,
        featured: rankChecks.featured,
        resultsRead: rankChecks.resultsRead,
        pagesRead: rankChecks.pagesRead,
        listEnded: rankChecks.listEnded,
      })
      .from(rankChecks)
      .where(
        and(
          eq(rankChecks.projectId, projectId),
          eq(rankChecks.domain, domain),
          eq(rankChecks.status, 'done'),
          gte(rankChecks.day, from),
          lte(rankChecks.day, to),
        ),
      )
      .orderBy(asc(rankChecks.day));
    return rows.map((r) => ({ ...r, checkedAt: r.checkedAt ?? new Date(`${r.day}T00:00:00Z`) }));
  }

  /** Each keyword's two newest finished checks for `domain`, whatever the range (for "latest" and "change"). */
  async latestTwo(projectId: string, domain: string): Promise<Map<string, DoneCheck[]>> {
    const rows = (await this.db.all(sql`
      SELECT keyword_id AS keywordId, day, position, url, depth, checked_at AS checkedAt, featured,
        results_read AS resultsRead, pages_read AS pagesRead, list_ended AS listEnded FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.keyword_id ORDER BY c.day DESC) AS rn
        FROM ${rankChecks} c WHERE c.project_id = ${projectId} AND c.domain = ${domain} AND c.status = 'done'
      ) WHERE rn <= 2 ORDER BY keyword_id, day DESC
    `)) as Array<{
      keywordId: string;
      day: string;
      position: number | null;
      url: string | null;
      depth: number;
      checkedAt: number | null;
      featured: number | null;
      resultsRead: number | null;
      pagesRead: number | null;
      listEnded: number | null;
    }>;
    const out = new Map<string, DoneCheck[]>();
    for (const r of rows) {
      const list = out.get(r.keywordId) ?? [];
      list.push({
        keywordId: r.keywordId,
        day: r.day,
        position: r.position,
        url: r.url,
        depth: r.depth,
        checkedAt: new Date(r.checkedAt ?? Date.parse(`${r.day}T00:00:00Z`)),
        featured: r.featured === 1,
        resultsRead: r.resultsRead,
        pagesRead: r.pagesRead,
        listEnded: r.listEnded === null ? null : r.listEnded === 1,
      });
      out.set(r.keywordId, list);
    }
    return out;
  }

  /** Keywords with a check in flight. */
  async inFlight(projectId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ keywordId: rankChecks.keywordId })
      .from(rankChecks)
      .where(and(eq(rankChecks.projectId, projectId), inArray(rankChecks.status, ['posting', 'queued', 'next', 'retry'])));
    return new Set(rows.map((r) => r.keywordId));
  }

  /** Totals for the admin view: live projects with a setup and at least one keyword, and active keywords. */
  async totals(): Promise<{ projects: number; keywords: number }> {
    const [row] = await this.db
      .select({
        projects: sql<number>`COUNT(DISTINCT ${rankKeywords.projectId})`,
        keywords: count(),
      })
      .from(rankKeywords)
      .innerJoin(rankProjects, eq(rankProjects.projectId, rankKeywords.projectId))
      .innerJoin(projects, eq(projects.id, rankKeywords.projectId))
      .where(and(isNull(projects.deletedAt), eq(rankKeywords.paused, false)));
    return { projects: Number(row?.projects ?? 0), keywords: Number(row?.keywords ?? 0) };
  }
}
