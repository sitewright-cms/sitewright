import type { RankProviderId, RankStatus } from '@sitewright/schema';
import { findRank } from './match.js';
import { RankProviderError, type RankCredentials, type RankProvider, type RankProviderIo, type RankSearch } from './providers/index.js';
import { utcDay, type DueKeyword, type RankRepository } from './repo.js';

/**
 * THE RANK TRACKER — sends due checks to the active provider and collects their results.
 *
 * One pass: (1) collect results of queued checks from whichever provider holds them, (2) fail checks that can no
 * longer finish, (3) send the keywords due today, within the month's budget. Every step is decided from
 * the database, so a restart or a skipped pass loses nothing: the next pass sees the same due keywords and the
 * same queued checks.
 *
 * ★ Money: a check is CLAIMED in the database before the provider is called (see `RankRepository.claim`), the
 * budget is checked against an estimate before sending and charged with the provider's own figure after, and a
 * refusal of the whole request (credentials, funds) releases the claims instead of spending attempts on them.
 */

/** Keywords sent per pass at most — a backlog drains over several passes rather than in one burst. */
const MAX_SENDS_PER_PASS = 1000;
/** Queued checks asked about per pass at most. */
const MAX_COLLECTS_PER_PASS = 500;
/** After a "check now", when to look for its results (the queue usually answers within minutes). */
const FOLLOW_UP_MS = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000];

export interface RankPassReport {
  status: RankStatus;
  sent: number;
  collected: number;
  failed: number;
}

export interface RankTrackerDeps {
  repo: RankRepository;
  providers: Readonly<Record<RankProviderId, RankProvider>>;
  io: RankProviderIo;
  now?: () => Date;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const micros = (usd: number): number => Math.max(0, Math.round(usd * 1_000_000));

export class RankTracker {
  private chain: Promise<unknown> = Promise.resolve();
  private busy = false;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly deps: RankTrackerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** The scheduled pass. Skipped while another pass runs — the next tick picks up anything left. */
  async tick(): Promise<RankPassReport | null> {
    if (this.busy) return null;
    return this.serialized(() => this.pass({}));
  }

  /**
   * Checks one project's keywords now, whatever their schedule (each keyword still at most once a day), and looks
   * for the results a few times over the next half hour.
   */
  async checkNow(projectId: string): Promise<RankPassReport> {
    const report = await this.serialized(() => this.pass({ projectId, force: true }));
    if (report.sent > 0) this.followUp();
    return report;
  }

  /** Why checks would not run now, for staff: no provider, the budget spent, or the provider's last refusal. */
  async status(): Promise<RankStatus> {
    const config = await this.deps.repo.getConfig();
    const ready = config.activeProvider ? await this.credentials(config.activeProvider) : null;
    if (!config.activeProvider || !ready) return 'no-provider';
    if (config.lastError) return 'provider-error';
    const spent = await this.deps.repo.spentMicrosSince(monthStart(this.now()));
    return spent >= config.monthlyBudgetMicros ? 'budget-reached' : 'ok';
  }

  /** Stops the follow-up timers (app shutdown). */
  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private followUp(): void {
    for (const ms of FOLLOW_UP_MS) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void this.tick().catch((err) => this.deps.log.warn({ err }, 'rank tracking follow-up failed'));
      }, ms);
      t.unref();
      this.timers.add(t);
    }
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.busy = true;
      try {
        return await fn();
      } finally {
        this.busy = false;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The provider's checked credentials, or null when there are none (or they no longer parse). */
  private async credentials(id: RankProviderId): Promise<RankCredentials | null> {
    const raw = await this.deps.repo.getCredentials(id);
    if (!raw) return null;
    try {
      return this.deps.providers[id].parseCredentials(raw);
    } catch {
      return null;
    }
  }

  private async pass(opts: { projectId?: string; force?: boolean }): Promise<RankPassReport> {
    const { repo } = this.deps;
    const now = this.now();
    // Collect BEFORE expiring: after downtime, a result the provider still holds must be read, not thrown away
    // (and paid for again) because the platform was not running to ask for it.
    const collected = await this.collect();
    await repo.expireStale(now);
    const send = await this.send(now, opts);
    return { status: send.status, sent: send.sent, collected: collected.done, failed: collected.failed + send.failed };
  }

  private async collect(): Promise<{ done: number; failed: number }> {
    const { repo, providers, io, log } = this.deps;
    const queued = await repo.queuedChecks(MAX_COLLECTS_PER_PASS);
    let done = 0;
    let failed = 0;
    const byProvider = new Map<string, typeof queued>();
    for (const q of queued) byProvider.set(q.provider, [...(byProvider.get(q.provider) ?? []), q]);
    for (const [id, checks] of byProvider) {
      const provider = (providers as Record<string, RankProvider | undefined>)[id];
      const creds = provider ? await this.credentials(provider.id) : null;
      if (!provider || !creds) continue; // collected once an admin restores the credentials; expired after days otherwise
      const byId = new Map(checks.map((c) => [c.id, c]));
      let outcomes;
      try {
        outcomes = await provider.collect(creds, checks.map((c) => ({ checkId: c.id, ref: c.ref })), io);
      } catch (err) {
        if (err instanceof RankProviderError) {
          await repo.setLastError(err.message, this.now());
          log.warn({ provider: id, kind: err.kind }, 'rank tracking: the provider refused to return results');
          continue;
        }
        throw err;
      }
      for (const o of outcomes) {
        const check = byId.get(o.checkId);
        if (!check) continue;
        if (o.state === 'done') {
          const hit = check.domain ? findRank(o.page.entries, { domain: check.domain, includeSubdomains: check.includeSubdomains }) : null;
          await repo.markDone(check.id, hit, o.page.checkedAt);
          done++;
        } else if (o.state === 'failed') {
          await repo.markFailed(check.id, o.error);
          failed++;
        }
      }
    }
    if (done || failed) log.info({ done, failed }, 'rank tracking: collected results');
    return { done, failed };
  }

  private async send(now: Date, opts: { projectId?: string; force?: boolean }): Promise<{ status: RankStatus; sent: number; failed: number }> {
    const { repo, providers, io, log } = this.deps;
    const config = await repo.getConfig();
    if (!config.activeProvider) return { status: 'no-provider', sent: 0, failed: 0 };
    const provider = providers[config.activeProvider];
    const creds = await this.credentials(provider.id);
    if (!creds) return { status: 'no-provider', sent: 0, failed: 0 };

    let remaining = config.monthlyBudgetMicros - (await repo.spentMicrosSince(monthStart(now)));
    const day = utcDay(now);
    const due = await repo.dueKeywords(day, MAX_SENDS_PER_PASS, opts);
    if (due.length === 0) return { status: remaining > 0 ? (config.lastError ? 'provider-error' : 'ok') : 'budget-reached', sent: 0, failed: 0 };

    // Claim within the budget, in order; stop at the first keyword the rest of the budget cannot pay for.
    const claimed: Array<{ search: RankSearch; keyword: DueKeyword }> = [];
    let overBudget = false;
    for (const k of due) {
      const estimate = micros(provider.estimateCostUsd(k.depth, creds));
      if (estimate > remaining) {
        overBudget = true;
        break;
      }
      const checkId = await repo.claim(k, day, provider.id, k.depth, now);
      if (!checkId) continue;
      remaining -= estimate;
      claimed.push({
        keyword: k,
        search: {
          checkId,
          keyword: k.keyword,
          engine: k.engine,
          device: k.device,
          location: { name: k.locationName, countryCode: k.countryCode },
          languageCode: k.languageCode,
          depth: k.depth,
        },
      });
    }
    const keywordOf = new Map(claimed.map((c) => [c.search.checkId, c.keyword]));

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < claimed.length; i += provider.maxBatch) {
      const batch = claimed.slice(i, i + provider.maxBatch).map((c) => c.search);
      let outcomes;
      try {
        outcomes = await provider.submit(creds, batch, io);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'the provider could not be reached';
        const certainlyRefused = err instanceof RankProviderError && err.kind !== 'unavailable';
        // A refusal of the whole request was not charged: give every claim back. A transport failure MAY have
        // reached the provider, so those checks are failed (and may be retried, at most a few times a day).
        for (const c of claimed.slice(i)) {
          if (certainlyRefused) await repo.release(c.search.checkId, message);
          else await repo.markFailed(c.search.checkId, message);
        }
        await repo.setLastError(message, this.now());
        log.warn({ provider: provider.id, kind: err instanceof RankProviderError ? err.kind : 'unknown' }, 'rank tracking: the provider refused the checks');
        return { status: 'provider-error', sent, failed: failed + (certainlyRefused ? 0 : claimed.length - i) };
      }
      for (const o of outcomes) {
        if (o.state === 'queued') {
          await repo.markQueued(o.checkId, o.ref, o.costUsd);
          sent++;
        } else if (o.state === 'done') {
          const k = keywordOf.get(o.checkId);
          const project = k ? await repo.getProject(k.projectId) : null;
          const hit = project ? findRank(o.page.entries, project) : null;
          await repo.markDone(o.checkId, hit, o.page.checkedAt, o.costUsd);
          sent++;
        } else {
          await repo.markFailed(o.checkId, o.error, o.costUsd);
          failed++;
        }
      }
    }
    if (config.lastError && sent > 0) await repo.setLastError(null);
    if (sent || failed) log.info({ provider: provider.id, sent, failed }, 'rank tracking: sent checks');
    return { status: overBudget ? 'budget-reached' : 'ok', sent, failed };
  }
}
