import { and, asc, count, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  RankProviderIdSchema,
  statsRetentionStart,
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

/** The monthly budget until an admin sets one: small enough that a mistake is cheap. */
export const DEFAULT_RANK_BUDGET_MICROS = 10_000_000;
/** A check still `posting` after this died mid-request (a restart): failed, its estimated cost kept. */
const POSTING_STALE_MS = 60 * 60 * 1000;
/** A queued check whose result never came. A queue answers within the hour; DataForSEO keeps results 30 days. */
const QUEUED_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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

export interface QueuedCheck {
  id: string;
  keywordId: string;
  projectId: string;
  provider: string;
  ref: string;
  depth: number;
  /** The site the check was sent for (not the project's current setup). */
  domain: string;
  includeSubdomains: boolean;
}

export interface DoneCheck {
  keywordId: string;
  day: string;
  position: number | null;
  url: string | null;
  depth: number;
  checkedAt: Date;
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

const toMicros = (usd: number): number => Math.max(0, Math.round(usd * 1_000_000));

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
      // NULL (never checked) sorts first in SQLite's ascending order.
      .orderBy(sql`${lastChecked} ASC`, asc(rankKeywords.createdAt))
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
   */
  async release(id: string): Promise<void> {
    await this.db.batch([
      this.db.delete(rankChecks).where(and(eq(rankChecks.id, id), eq(rankChecks.status, 'posting'))),
      this.db.delete(rankCharges).where(and(eq(rankCharges.checkId, id), sql`NOT EXISTS (SELECT 1 FROM ${rankChecks} WHERE ${rankChecks.id} = ${id})`)),
    ]);
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

  /** Sent: the provider's id for the search, and what it charged (replacing the estimate). */
  async markQueued(id: string, ref: string, costUsd: number): Promise<void> {
    const costMicros = toMicros(costUsd);
    await this.db.batch([
      this.db.update(rankChecks).set({ status: 'queued', providerRef: ref, costMicros }).where(eq(rankChecks.id, id)),
      this.charge(id, costMicros),
    ]);
  }

  /** Finished. `costUsd` replaces the booked cost when the provider stated one with the result (a live search). */
  async markDone(id: string, hit: { position: number; absolutePosition: number; url: string } | null, checkedAt: Date, costUsd?: number): Promise<void> {
    const costMicros = costUsd !== undefined ? toMicros(costUsd) : undefined;
    const update = this.db
      .update(rankChecks)
      .set({
        status: 'done',
        position: hit?.position ?? null,
        absolutePosition: hit?.absolutePosition ?? null,
        url: hit?.url ?? null,
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
  async markFailed(id: string, error: string, costUsd?: number): Promise<void> {
    const costMicros = costUsd !== undefined ? toMicros(costUsd) : undefined;
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
        depth: rankChecks.depth,
        domain: rankChecks.domain,
        includeSubdomains: rankChecks.includeSubdomains,
      })
      .from(rankChecks)
      .where(and(eq(rankChecks.status, 'queued'), projectId ? eq(rankChecks.projectId, projectId) : undefined))
      .orderBy(asc(rankChecks.postedAt))
      .limit(limit);
    return rows.flatMap((r) => (r.ref ? [{ ...r, ref: r.ref }] : []));
  }

  /** Fails checks that can no longer finish: a send cut off by a restart, a result that never came. */
  async expireStale(now: Date): Promise<number> {
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
    return posting.length + queued.length;
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
   * of months wholly before it (no budget reads them: it counts the current month only).
   */
  async pruneOld(today: string): Promise<{ checks: number; charges: number }> {
    const start = statsRetentionStart(today);
    const checks = await this.db
      .delete(rankChecks)
      .where(lt(rankChecks.postedAt, new Date(`${start}T00:00:00Z`)))
      .returning({ id: rankChecks.id });
    const charges = await this.db
      .delete(rankCharges)
      .where(lt(rankCharges.month, start.slice(0, 7)))
      .returning({ id: rankCharges.checkId });
    return { checks: checks.length, charges: charges.length };
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
      SELECT keyword_id AS keywordId, day, position, url, depth, checked_at AS checkedAt FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.keyword_id ORDER BY c.day DESC) AS rn
        FROM ${rankChecks} c WHERE c.project_id = ${projectId} AND c.domain = ${domain} AND c.status = 'done'
      ) WHERE rn <= 2 ORDER BY keyword_id, day DESC
    `)) as Array<{ keywordId: string; day: string; position: number | null; url: string | null; depth: number; checkedAt: number | null }>;
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
      .where(and(eq(rankChecks.projectId, projectId), inArray(rankChecks.status, ['posting', 'queued'])));
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
