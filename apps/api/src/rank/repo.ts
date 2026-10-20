import { and, asc, count, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  RankProviderIdSchema,
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
/** How often a failed check is tried again on the same day. */
export const RANK_MAX_ATTEMPTS = 3;
/** A check still `posting` after this died mid-request (a restart): it is failed, and may be tried again. */
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
}

export interface QueuedCheck {
  id: string;
  keywordId: string;
  projectId: string;
  provider: string;
  ref: string;
  depth: number;
  domain: string | null;
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

  /** Records (or, with null, clears) the provider's last refusal for the admin view. */
  async setLastError(message: string | null, now = new Date()): Promise<void> {
    await this.putConfig({});
    await this.db
      .update(rankTrackingConfig)
      .set({ lastError: message, lastErrorAt: message ? now : null })
      .where(eq(rankTrackingConfig.id, RANK_TRACKING_CONFIG_ID));
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

  /** Removes a keyword AND its history. */
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
   * Keywords due a check on `today`: not paused, in a live project with a setup, and with no check recent
   * enough for the project's schedule. A failed check does not count while it has attempts left.
   * `projectId` limits it to one project; `force` treats every keyword as daily (a "check now").
   */
  async dueKeywords(today: string, limit: number, opts: { projectId?: string; force?: boolean } = {}): Promise<DueKeyword[]> {
    const dailyCutoff = today;
    const weeklyCutoff = shiftDay(today, -(SCHEDULE_DAYS.weekly - 1));
    const cutoff = opts.force
      ? sql`${dailyCutoff}`
      : sql`CASE ${rankProjects.schedule} WHEN 'daily' THEN ${dailyCutoff} ELSE ${weeklyCutoff} END`;
    const recent = sql`EXISTS (SELECT 1 FROM ${rankChecks} c WHERE c.keyword_id = ${rankKeywords.id} AND c.day >= ${cutoff}
      AND (c.status <> 'failed' OR c.attempts >= ${RANK_MAX_ATTEMPTS}))`;
    const rows = await this.db
      .select({ k: rankKeywords, depth: rankProjects.depth })
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
      .orderBy(asc(rankKeywords.projectId), asc(rankKeywords.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.k, depth: r.depth }));
  }

  /**
   * ★ CLAIMS the day's check for a keyword BEFORE the provider is called. Returns the check id, or null when the
   * keyword already has a check that day that is queued, finished, or out of attempts — so two passes (or a pass
   * and a "check now") can never pay for the same keyword twice in a day.
   */
  async claim(k: { id: string; projectId: string }, day: string, provider: RankProviderId, depth: number, now: Date): Promise<string | null> {
    const id = newId();
    const rows = (await this.db.all(sql`
      INSERT INTO ${rankChecks} (id, keyword_id, project_id, day, provider, status, attempts, depth, cost_micros, posted_at)
      VALUES (${id}, ${k.id}, ${k.projectId}, ${day}, ${provider}, 'posting', 1, ${depth}, 0, ${now.getTime()})
      ON CONFLICT (keyword_id, day) DO UPDATE SET
        status = 'posting', attempts = ${rankChecks}.attempts + 1, provider = excluded.provider, depth = excluded.depth,
        posted_at = excluded.posted_at, provider_ref = NULL, error = NULL
      WHERE ${rankChecks}.status = 'failed' AND ${rankChecks}.attempts < ${RANK_MAX_ATTEMPTS}
      RETURNING id
    `)) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  /**
   * Gives a claim back when the provider certainly did not take the request (it refused it as a whole): a fresh
   * claim is removed, a retry goes back to failed without using up an attempt.
   */
  async release(id: string, reason: string): Promise<void> {
    await this.db.delete(rankChecks).where(and(eq(rankChecks.id, id), eq(rankChecks.status, 'posting'), eq(rankChecks.attempts, 1)));
    await this.db
      .update(rankChecks)
      .set({ status: 'failed', attempts: sql`${rankChecks.attempts} - 1`, error: reason.slice(0, 300) })
      .where(and(eq(rankChecks.id, id), eq(rankChecks.status, 'posting')));
  }

  async markQueued(id: string, ref: string, costUsd: number): Promise<void> {
    await this.db
      .update(rankChecks)
      .set({ status: 'queued', providerRef: ref, costMicros: sql`${rankChecks.costMicros} + ${toMicros(costUsd)}` })
      .where(eq(rankChecks.id, id));
  }

  async markDone(id: string, hit: { position: number; absolutePosition: number; url: string } | null, checkedAt: Date, costUsd = 0): Promise<void> {
    await this.db
      .update(rankChecks)
      .set({
        status: 'done',
        position: hit?.position ?? null,
        absolutePosition: hit?.absolutePosition ?? null,
        url: hit?.url ?? null,
        checkedAt,
        error: null,
        costMicros: sql`${rankChecks.costMicros} + ${toMicros(costUsd)}`,
      })
      .where(eq(rankChecks.id, id));
  }

  async markFailed(id: string, error: string, costUsd = 0): Promise<void> {
    await this.db
      .update(rankChecks)
      .set({ status: 'failed', error: error.slice(0, 300), costMicros: sql`${rankChecks.costMicros} + ${toMicros(costUsd)}` })
      .where(eq(rankChecks.id, id));
  }

  /** Queued checks to collect, oldest first, with the project's current target. */
  async queuedChecks(limit: number): Promise<QueuedCheck[]> {
    const rows = await this.db
      .select({
        id: rankChecks.id,
        keywordId: rankChecks.keywordId,
        projectId: rankChecks.projectId,
        provider: rankChecks.provider,
        ref: rankChecks.providerRef,
        depth: rankChecks.depth,
        domain: rankProjects.domain,
        includeSubdomains: rankProjects.includeSubdomains,
      })
      .from(rankChecks)
      .leftJoin(rankProjects, eq(rankProjects.projectId, rankChecks.projectId))
      .where(eq(rankChecks.status, 'queued'))
      .orderBy(asc(rankChecks.postedAt))
      .limit(limit);
    return rows.flatMap((r) => (r.ref ? [{ ...r, ref: r.ref, domain: r.domain ?? null, includeSubdomains: r.includeSubdomains ?? true }] : []));
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

  /** What every check posted since `start` cost, in micro-dollars. */
  async spentMicrosSince(start: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${rankChecks.costMicros}), 0)` })
      .from(rankChecks)
      .where(gte(rankChecks.postedAt, start));
    return Number(row?.total ?? 0);
  }

  /** Finished checks of a project's keywords between two days (inclusive), oldest first. */
  async history(projectId: string, from: string, to: string): Promise<DoneCheck[]> {
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
      .where(and(eq(rankChecks.projectId, projectId), eq(rankChecks.status, 'done'), gte(rankChecks.day, from), lte(rankChecks.day, to)))
      .orderBy(asc(rankChecks.day));
    return rows.map((r) => ({ ...r, checkedAt: r.checkedAt ?? new Date(`${r.day}T00:00:00Z`) }));
  }

  /** Each keyword's two newest finished checks, whatever the range (for "latest" and "change"). */
  async latestTwo(projectId: string): Promise<Map<string, DoneCheck[]>> {
    const rows = (await this.db.all(sql`
      SELECT keyword_id AS keywordId, day, position, url, depth, checked_at AS checkedAt FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.keyword_id ORDER BY c.day DESC) AS rn
        FROM ${rankChecks} c WHERE c.project_id = ${projectId} AND c.status = 'done'
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
