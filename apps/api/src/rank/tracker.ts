import type { RankPassReport, RankProviderId, RankStatus } from '@sitewright/schema';
import { findRank } from './match.js';
import { RankProviderError, type RankCredentials, type RankProvider, type RankProviderIo, type RankSearch } from './providers/index.js';
import { utcDay, type DueKeyword, type RankRepository } from './repo.js';

/**
 * THE RANK TRACKER — sends due checks to the active provider and collects their results.
 *
 * One pass: (1) collect results of queued checks from whichever provider holds them, (2) fail checks that can no
 * longer finish, (3) send the keywords due today, within the month's budget. Every step is decided from the
 * database, so a restart or a skipped pass loses nothing: the next pass sees the same due keywords and the same
 * queued checks.
 *
 * ★ Money:
 *   - a check is CLAIMED in the database, with its estimated cost booked, before the provider is called — so a
 *     keyword is sent at most once a day, and spending in flight already counts against the budget;
 *   - a refusal of the whole request (credentials, funds, rate) gives the claims back: nothing was charged;
 *   - an UNCERTAIN outcome (a reply lost after the request went out) keeps the estimate and is not sent again that
 *     day — it may have been charged, and sending it again could pay twice;
 *   - the month's spend is read from the CHARGES (`rank_charges`), which outlive the checks: removing a keyword or
 *     purging a project deletes its checks, never what they cost — even while one is in flight.
 */

/** Keywords sent per pass at most — a backlog drains over several passes rather than in one burst. */
const MAX_SENDS_PER_PASS = 1000;
/** Queued checks asked about per pass at most. */
const MAX_COLLECTS_PER_PASS = 500;
/** After a "check now", when to look for its results (the queue usually answers within minutes). */
const FOLLOW_UP_MS = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000];

export interface RankTrackerDeps {
  repo: RankRepository;
  providers: Readonly<Record<RankProviderId, RankProvider>>;
  io: RankProviderIo;
  now?: () => Date;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

const micros = (usd: number): number => Math.max(0, Math.round(usd * 1_000_000));

export class RankTracker {
  private chain: Promise<unknown> = Promise.resolve();
  private busy = false;
  /** Projects with a "check now" waiting or running: a second one is refused, not queued behind it. */
  private readonly checking = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  /** The UTC day retention last ran: it runs at most once a day, from the scheduled pass. */
  private prunedDay: string | null = null;

  constructor(private readonly deps: RankTrackerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * The scheduled pass over every project. Skipped while another pass runs — the next tick picks up the rest. Once a
   * day it also deletes checks (and charges) older than the retention period: 500 keywords checked daily are 180,000
   * rows a year per project, and nothing else ever removes one.
   */
  async tick(): Promise<RankPassReport | null> {
    if (this.busy) return null;
    return this.serialized(async () => {
      await this.prune();
      return this.pass({});
    });
  }

  /** Retention, at most once a UTC day (one attempt: a failure is logged and tried the next day). Never throws. */
  private async prune(): Promise<void> {
    const today = utcDay(this.now());
    if (this.prunedDay === today) return;
    this.prunedDay = today;
    try {
      const removed = await this.deps.repo.pruneOld(today);
      if (removed.checks || removed.charges) this.deps.log.info(removed, 'rank tracking: removed checks past the retention period');
    } catch (err) {
      this.deps.log.warn({ errMsg: err instanceof Error ? err.message : String(err) }, 'rank tracking: retention failed');
    }
  }

  /**
   * Checks ONE project's keywords now, whatever their schedule (each keyword still at most once a day), and looks
   * for the results a few times over the next half hour. Null when a check of this project is already under way.
   */
  async checkNow(projectId: string): Promise<RankPassReport | null> {
    if (this.checking.has(projectId)) return null;
    this.checking.add(projectId);
    try {
      const report = await this.serialized(() => this.pass({ projectId, force: true }));
      if (report.sent > 0) this.followUp();
      return report;
    } finally {
      this.checking.delete(projectId);
    }
  }

  /** Why checks would not run now, for staff: no provider, the budget spent, or the provider's last refusal. */
  async status(): Promise<RankStatus> {
    const config = await this.deps.repo.getConfig();
    const ready = config.activeProvider ? await this.credentials(config.activeProvider) : null;
    if (!config.activeProvider || !ready) return 'no-provider';
    if (config.lastError) return 'provider-error';
    const spent = await this.deps.repo.spentMicrosInMonth(this.now());
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

  /**
   * The provider's checked credentials, or null when there are none — or they cannot be read (the encryption key
   * changed or is missing) or no longer parse. Never throws: a broken credential stops the tracker, not the page.
   */
  private async credentials(id: RankProviderId): Promise<RankCredentials | null> {
    try {
      const raw = await this.deps.repo.getCredentials(id);
      return raw ? this.deps.providers[id].parseCredentials(raw) : null;
    } catch {
      return null;
    }
  }

  private async pass(opts: { projectId?: string; force?: boolean }): Promise<RankPassReport> {
    const now = this.now();
    // Collect BEFORE expiring: after downtime, a result the provider still holds must be read, not thrown away
    // (and paid for again) because the platform was not running to ask for it.
    const collected = await this.collect(opts.projectId);
    await this.deps.repo.expireStale(now);
    const send = await this.send(now, opts);
    return { status: send.status, sent: send.sent, collected: collected.done, failed: collected.failed + send.failed };
  }

  private async collect(projectId?: string): Promise<{ done: number; failed: number }> {
    const { repo, providers, io, log } = this.deps;
    const queued = await repo.queuedChecks(MAX_COLLECTS_PER_PASS, projectId);
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
          await repo.markDone(check.id, findRank(o.page.entries, check), o.page.checkedAt);
          done++;
        } else if (o.state === 'failed') {
          // Final for the day: a search the provider ran and failed is not bought again until the next one.
          await repo.markFailed(check.id, o.error);
          failed++;
        }
      }
    }
    if (done > 0) {
      const config = await repo.getConfig();
      if (config.lastError) await repo.setLastError(null);
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

    // What is booked this month — claims in flight included, at their estimate.
    let remaining = config.monthlyBudgetMicros - (await repo.spentMicrosInMonth(now));
    const day = utcDay(now);
    const due = await repo.dueKeywords(day, MAX_SENDS_PER_PASS, opts);
    const idle: RankStatus = config.lastError ? 'provider-error' : remaining > 0 ? 'ok' : 'budget-reached';

    // Claim within the budget. A keyword the rest of the budget cannot pay for is skipped, not the end: a
    // shallower one later in the list may still fit.
    const claimed: Array<{ search: RankSearch; keyword: DueKeyword }> = [];
    let overBudget = false;
    for (const k of due) {
      const estimate = provider.estimateCostUsd(k.depth, creds);
      if (micros(estimate) > remaining) {
        overBudget = true;
        continue;
      }
      let checkId: string | null;
      try {
        checkId = await repo.claim(k, day, provider.id, estimate, now);
      } catch (err) {
        // The keyword went away since the list was read (removed by staff, or its project reaped).
        log.warn({ keywordId: k.id, err: err instanceof Error ? err.message : String(err) }, 'rank tracking: could not claim a check');
        continue;
      }
      if (!checkId) continue;
      remaining -= micros(estimate);
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
    if (claimed.length === 0) return { status: overBudget ? 'budget-reached' : idle, sent: 0, failed: 0 };

    const keywordOf = new Map(claimed.map((c) => [c.search.checkId, c.keyword]));
    // ★ Claims not yet handed to the provider. Whatever happens below, these go back in `finally`: nothing was
    // sent for them. A claim whose request went out is never released — it may have been charged.
    const unsent = new Set(claimed.map((c) => c.search.checkId));
    let sent = 0;
    let failed = 0;
    let status: RankStatus = overBudget ? 'budget-reached' : 'ok';
    try {
      for (let i = 0; i < claimed.length; i += provider.maxBatch) {
        const batch = claimed.slice(i, i + provider.maxBatch).map((c) => c.search);
        for (const s of batch) unsent.delete(s.checkId);
        let outcomes;
        try {
          outcomes = await provider.submit(creds, batch, io);
        } catch (err) {
          const message = err instanceof RankProviderError ? err.message : 'the provider could not be reached';
          const refused = err instanceof RankProviderError && err.kind !== 'unavailable';
          for (const s of batch) {
            if (refused) await repo.release(s.checkId);
            else await repo.markFailed(s.checkId, message); // uncertain: the estimate stays booked
          }
          if (!refused) failed += batch.length;
          await repo.setLastError(message, this.now());
          log.warn({ provider: provider.id, kind: err instanceof RankProviderError ? err.kind : 'unknown' }, 'rank tracking: the provider refused the checks');
          status = 'provider-error';
          break; // the rest stay in `unsent` and are given back below
        }
        for (const o of outcomes) {
          if (o.state === 'queued') {
            await repo.markQueued(o.checkId, o.ref, o.costUsd);
            sent++;
          } else if (o.state === 'done') {
            const k = keywordOf.get(o.checkId);
            await repo.markDone(o.checkId, k ? findRank(o.page.entries, k) : null, o.page.checkedAt, o.costUsd);
            sent++;
          } else {
            await repo.markFailed(o.checkId, o.error, o.costUsd);
            failed++;
          }
        }
      }
    } finally {
      for (const id of unsent) await repo.release(id);
    }
    if (status !== 'provider-error' && sent > 0 && config.lastError) await repo.setLastError(null);
    if (sent || failed) log.info({ provider: provider.id, sent, failed }, 'rank tracking: sent checks');
    return { status, sent, failed };
  }
}
