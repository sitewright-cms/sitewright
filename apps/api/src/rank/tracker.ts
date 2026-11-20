import { rankNextStage, type RankPassReport, type RankProviderId, type RankStatus } from '@sitewright/schema';
import { findRank, readPage, readStage, type PageReading } from './match.js';
import { RankProviderError, type RankCredentials, type RankProvider, type RankProviderIo, type RankSearch, type SerpPage } from './providers/index.js';
import { utcDay, type CheckProgress, type ContinuingCheck, type DueKeyword, type RankRepository } from './repo.js';
import { resolveRedirect } from './resolve-link.js';

/**
 * THE RANK TRACKER — sends due checks to the active provider and collects their results.
 *
 * One pass: (1) collect results of queued checks from whichever provider holds them, (2) fail checks that can no
 * longer finish, (3) send the next stages of checks under way, then the keywords due today, within the month's
 * budget. Every step is decided from the database, so a restart or a skipped pass loses nothing: the next pass sees
 * the same due keywords and the same queued checks. The scheduled pass then (4) re-reads a few stored results of older
 * checks — see `reread`.
 *
 * ★ STAGES: a check reads its depth a few pages at a time (`rankStages`: page 1, 2, 3–5, 6–10) and asks for the next
 * pages only while the site has not turned up and Google has more — a site on the first page costs one page, not ten.
 * A queued provider's next stage goes out on the pass that collects the one before; a live provider's within the
 * same pass. Each stage is claimed and booked like a check of its own, on top of what the earlier ones cost.
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
/** Stored results fetched again per scheduled pass at most (free; see `reread`). */
const MAX_REREADS_PER_PASS = 50;
/**
 * After a "check now", when to look for its results (the queue usually answers within minutes) — and send the next
 * stage of a check whose earlier pages did not hold the site.
 */
const FOLLOW_UP_MS = [1, 3, 6, 10, 15, 20, 30, 45, 60].map((m) => m * 60_000);
/** Rounds of sending in one pass: a live provider's answers can call for every stage of a check in turn. */
const MAX_SEND_ROUNDS = 6;
/**
 * How long a pass keeps SENDING: past it, no further chunk is claimed, and what is left goes out on the next pass. A
 * live provider reads a page in seconds, so a pass of a thousand keywords would otherwise run for most of an hour —
 * with every "check now" waiting behind it.
 */
const PASS_SEND_BUDGET_MS = 3 * 60_000;
/** A pass that ran out of time is followed this soon by the next, not at the next scheduled one: the day's work goes on. */
const CONTINUE_AFTER_MS = 30_000;
/** A search the provider could not run is tried again this much later, the same day, at most this many times. */
const RETRY_AFTER_MS = 60 * 60_000;
const MAX_RETRIES_PER_DAY = 2;
/** A keyword that ranked before and now reads "not found" is read again this much later, to confirm the drop. */
const CONFIRM_AFTER_MS = 5 * 60_000;
/** After this many redirects in a row Google did not resolve, none is asked for this long (the site's address stays). */
const REDIRECT_FAILURES_TO_PAUSE = 3;
const REDIRECT_PAUSE_MS = 15 * 60_000;
/** Google's redirects looked up at once, and how long a batch's lookups may go on before the rest keep the site. */
const REDIRECT_LOOKUPS_AT_ONCE = 10;
const REDIRECT_BATCH_BUDGET_MS = 10_000;

export interface RankTrackerDeps {
  repo: RankRepository;
  providers: Readonly<Record<RankProviderId, RankProvider>>;
  io: RankProviderIo;
  now?: () => Date;
  /** Milliseconds, for how long a pass has run (tests drive it). */
  clock?: () => number;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

const micros = (usd: number): number => Math.max(0, Math.round(usd * 1_000_000));

/** A claimed stage: the request, and the check it reads on for. */
interface Claimed {
  search: RankSearch;
  check: CheckProgress;
}

/** Work for a pass: the next stage of a check under way (or due again), or a keyword due its first. */
type Work = { kind: 'stage'; check: ContinuingCheck } | { kind: 'due'; keyword: DueKeyword };

/**
 * What makes two pieces of work the same search: the provider can read it once for both (two projects tracking one
 * keyword in one place). Kept side by side, they go out in one request.
 */
function searchKey(w: Work): string {
  const k = w.kind === 'stage' ? w.check : w.keyword;
  const stage = rankNextStage(k.depth, w.kind === 'stage' ? w.check.pagesRead : 0);
  return JSON.stringify([k.engine, k.keyword.trim().toLowerCase(), k.locationName, k.countryCode, k.languageCode, k.device, stage?.startPage, stage?.pages]);
}

/** The work in chunks of at most `size`, identical searches together (a group larger than a chunk is split). */
function chunksOf(work: readonly Work[], size: number): Work[][] {
  const groups = new Map<string, Work[]>();
  for (const w of work) {
    const key = searchKey(w);
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  const chunks: Work[][] = [];
  let current: Work[] = [];
  for (const group of groups.values()) {
    if (current.length > 0 && current.length + group.length > size) {
      chunks.push(current);
      current = [];
    }
    for (const w of group) {
      if (current.length === size) {
        chunks.push(current);
        current = [];
      }
      current.push(w);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export class RankTracker {
  private chain: Promise<unknown> = Promise.resolve();
  private busy = false;
  /** Projects with a "check now" waiting or running: a second one is refused, not queued behind it. */
  private readonly checking = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  /** The UTC day retention last ran: it runs at most once a day, from the scheduled pass. */
  private prunedDay: string | null = null;
  /** Providers with nothing left to re-read: no new check ever needs it, so they are not asked again until a restart. */
  private readonly rereadDone = new Set<string>();
  /** A "check now" waits behind the scheduled pass: that pass stops sending at its next chunk. */
  private yieldRequested = false;
  /** The pass that carries on what a pass ran out of time for, when one is set. */
  private continuation: ReturnType<typeof setTimeout> | null = null;
  /** Shut down: no further pass is set (one under way may still finish). */
  private closed = false;
  /** Redirects in a row Google did not resolve, and until when none is asked (see {@link lookUpPages}). */
  private redirectFailures = 0;
  private redirectsPausedUntil = 0;

  constructor(private readonly deps: RankTrackerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private clock(): number {
    return this.deps.clock?.() ?? Date.now();
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
      const report = await this.pass({ yieldable: true });
      await this.reread();
      return report;
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
    // A scheduled pass under way stops sending at its next chunk; what it leaves goes out on the next one.
    if (this.busy) this.yieldRequested = true;
    try {
      const report = await this.serialized(() => {
        this.yieldRequested = false;
        return this.pass({ projectId, force: true });
      });
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
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.continuation = null;
  }

  /** Sets the pass that carries on what this one ran out of time for (one at a time). */
  private continueSoon(): void {
    if (this.continuation || this.closed) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.continuation = null;
      // Busy with a "check now": carried on once that is done, not left for the next scheduled pass.
      void this.tick()
        .then((report) => {
          if (report === null) this.continueSoon();
        })
        .catch((err) => this.deps.log.warn({ errMsg: err instanceof Error ? err.message : String(err) }, 'rank tracking continuation failed'));
    }, CONTINUE_AFTER_MS);
    t.unref();
    this.timers.add(t);
    this.continuation = t;
  }

  private followUp(): void {
    if (this.closed) return;
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

  private async pass(opts: { projectId?: string; force?: boolean; yieldable?: boolean }): Promise<RankPassReport> {
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
    let continued = 0;
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
      const pages = await this.lookUpPages(outcomes.flatMap((o) => (o.state === 'done' && byId.has(o.checkId) ? [{ check: byId.get(o.checkId)!, page: o.page }] : [])));
      for (const o of outcomes) {
        const check = byId.get(o.checkId);
        if (!check) continue;
        if (o.state === 'done') {
          if ((await this.record(check, o.page, o.costUsd, pages.get(check.id))) === 'done') done++;
          else continued++;
        } else if (o.state === 'failed') {
          // Final for the day — a search the provider ran and failed is not bought again until the next one — unless the
          // provider could not run it at all (and charged nothing): then it is tried again later today.
          if (o.retry && (await this.retry(check, o.error, o.costUsd))) continued++;
          else {
            await repo.markFailed(check.id, o.error, o.costUsd, check.settledMicros);
            failed++;
          }
        }
      }
    }
    if (done > 0 || continued > 0) {
      const config = await repo.getConfig();
      if (config.lastError) await repo.setLastError(null);
    }
    if (done || failed || continued) log.info({ done, failed, continued }, 'rank tracking: collected results');
    return { done, failed };
  }

  /**
   * Records a stage's results page: the check is DONE when the site turned up, Google had nothing more, or the depth is
   * read; otherwise it waits for its NEXT stage. A keyword that ranked last time and now reads "not found" is read once
   * more to CONFIRM it — results vary from one request to the next, and a lone miss is often one of those — and that
   * second reading is what is recorded.
   */
  private async record(check: CheckProgress, page: SerpPage, costUsd: number | undefined, found?: string): Promise<'done' | 'next' | 'confirm'> {
    const { repo } = this.deps;
    // A check sent for its whole depth before stages: its one result is all it asked for.
    const { reading, final } = check.fullDepth ? { reading: readPage(page, check), final: true } : readStage(page, check, check, check.depth);
    if (!final) {
      await repo.markNext(check.id, reading, page.checkedAt, costUsd, check.settledMicros);
      return 'next';
    }
    const confirmAt = new Date(this.now().getTime() + CONFIRM_AFTER_MS);
    // Within the check's own day (a reading after midnight would be another day's), and for the site that ranked: a
    // project that changed its domain has nothing to confirm.
    if (reading.hit === null && !check.confirming && !check.fullDepth && utcDay(confirmAt) === check.day) {
      const before = await repo.lastPosition(check.keywordId, check.day, check.domain);
      if (before !== null && before !== undefined) {
        await repo.markConfirm(check.id, confirmAt, costUsd, check.settledMicros);
        return 'confirm';
      }
    }
    await repo.markDone(check.id, this.pageOf(reading, found), page.checkedAt, costUsd, check.settledMicros);
    return 'done';
  }

  /** A reading whose hit is only the site, its page hidden behind Google's redirect: with the page, when it was found. */
  private pageOf(reading: PageReading, page: string | undefined): PageReading {
    const hit = reading.hit;
    if (!hit?.via) return reading;
    return { ...reading, hit: { position: hit.position, absolutePosition: hit.absolutePosition, url: page ?? hit.url, featured: hit.featured } };
  }

  /**
   * The pages behind Google's redirects, for the finished hits among a batch's results, by check: asked of Google before
   * the batch is recorded — for the site's own result alone, a few at a time and within a few seconds a batch, so a pass
   * never waits long on Google. A redirect Google does not answer leaves the site; after a few such answers in a row,
   * none is asked for a while.
   */
  private async lookUpPages(found: ReadonlyArray<{ check: CheckProgress; page: SerpPage }>): Promise<Map<string, string>> {
    const pages = new Map<string, string>();
    const asks = found.flatMap(({ check, page }) => {
      const via = findRank(page.entries, check)?.via;
      return via ? [{ check, via }] : [];
    });
    if (asks.length === 0) return pages;
    const deadline = this.clock() + REDIRECT_BATCH_BUDGET_MS;
    let next = 0;
    const lookUp = async (): Promise<void> => {
      while (next < asks.length && this.clock() < deadline && this.clock() >= this.redirectsPausedUntil) {
        const { check, via } = asks[next++]!;
        const url = await resolveRedirect(via, check, this.deps.io);
        if (url) {
          pages.set(check.id, url);
          this.redirectFailures = 0;
        } else if (++this.redirectFailures >= REDIRECT_FAILURES_TO_PAUSE) {
          this.redirectFailures = 0;
          this.redirectsPausedUntil = this.clock() + REDIRECT_PAUSE_MS;
          this.deps.log.warn({ provider: check.provider }, 'rank tracking: Google did not resolve its result redirects; the site is kept as the address for a while');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REDIRECT_LOOKUPS_AT_ONCE, asks.length) }, lookUp));
    return pages;
  }

  /** Puts a check the provider could not run back for later today, unless it has had its tries. True when it will be tried again. */
  private async retry(check: CheckProgress, error: string, costUsd: number | undefined): Promise<boolean> {
    const at = new Date(this.now().getTime() + RETRY_AFTER_MS);
    // Within the check's own day: past midnight, the keyword's next check is due anyway.
    if (check.attempts >= MAX_RETRIES_PER_DAY || utcDay(at) !== check.day) return false;
    await this.deps.repo.markRetry(check.id, error, at, costUsd, check.settledMicros);
    return true;
  }

  /**
   * RE-READS stored results of checks made before the platform kept how many results came back and whether the site's
   * result was a featured snippet — so the recent history is read by the same rules as every check from now on.
   *
   * ★ Only for a provider that keeps results and charges nothing to fetch them again (`freeRereadDays`), and only
   * within that window. Each check is tried ONCE (`markReread` records every attempt), a bounded number per pass, and
   * never during a "check now". A failure is logged, never shown as the provider's last error: sending still works.
   */
  private async reread(): Promise<void> {
    const { repo, providers, log } = this.deps;
    const now = this.now();
    for (const provider of Object.values(providers)) {
      if (!provider.freeRereadDays || this.rereadDone.has(provider.id)) continue;
      try {
        const since = new Date(now.getTime() - provider.freeRereadDays * 86_400_000);
        const checks = await repo.rereadable(provider.id, since, MAX_REREADS_PER_PASS);
        if (checks.length === 0) {
          this.rereadDone.add(provider.id);
          continue;
        }
        const creds = await this.credentials(provider.id);
        if (!creds) continue;
        const byId = new Map(checks.map((c) => [c.id, c]));
        const outcomes = await provider.collect(creds, checks.map((c) => ({ checkId: c.id, ref: c.ref })), this.deps.io);
        let read = 0;
        let featured = 0;
        let short = 0;
        for (const o of outcomes) {
          const check = byId.get(o.checkId);
          if (!check) continue;
          // A stored result that is not ready, or not there: tried, and left as it was. Not asking again keeps the
          // newest-first batch from filling up with the same few checks pass after pass.
          if (o.state !== 'done') {
            await repo.markReread(check.id, null, now);
            continue;
          }
          const reading = readPage(o.page, check);
          await repo.markReread(check.id, reading, now);
          read++;
          if (reading.hit?.featured) featured++;
          if (reading.pagesRead !== null && reading.pagesRead < Math.ceil(check.depth / 10)) short++;
        }
        if (read > 0) log.info({ provider: provider.id, read, featured, short }, 'rank tracking: re-read stored results of earlier checks');
      } catch (err) {
        log.warn({ provider: provider.id, errMsg: err instanceof Error ? err.message : String(err) }, 'rank tracking: re-reading stored results failed');
      }
    }
  }

  private async send(
    now: Date,
    opts: { projectId?: string; force?: boolean; yieldable?: boolean },
  ): Promise<{ status: RankStatus; sent: number; failed: number }> {
    const { repo, providers, log } = this.deps;
    const config = await repo.getConfig();
    if (!config.activeProvider) return { status: 'no-provider', sent: 0, failed: 0 };
    const provider = providers[config.activeProvider];
    const creds = await this.credentials(provider.id);
    if (!creds) return { status: 'no-provider', sent: 0, failed: 0 };

    // What is booked this month — claims in flight included, at their estimate.
    const budget = { remaining: config.monthlyBudgetMicros - (await repo.spentMicrosInMonth(now)), over: false };
    const idle: RankStatus = config.lastError ? 'provider-error' : budget.remaining > 0 ? 'ok' : 'budget-reached';
    const deadline = this.clock() + PASS_SEND_BUDGET_MS;
    let chunks = 0;
    // A scheduled pass sends at least one chunk before it gives way to a "check now": however often staff press it,
    // the day's checks still move.
    const stop = (): boolean => this.clock() >= deadline || (opts.yieldable === true && this.yieldRequested && chunks > 0);
    let sent = 0;
    let failed = 0;
    let continued = 0;
    let claimedAny = false;
    let refused = false;
    let outOfTime = false;
    // First the next stages of checks under way and the retries now due (what they have read is paid for; finishing
    // them is worth more), then the keywords due. Later rounds send the stages that a live provider's answers in this
    // pass called for. Work is claimed a chunk at a time, so a pass that runs out of time leaves the rest UNCLAIMED.
    for (let round = 0; round < MAX_SEND_ROUNDS && !refused && !outOfTime; round++) {
      const work: Work[] = (await repo.continuing(MAX_SENDS_PER_PASS, provider.id, now, opts.projectId)).map((check) => ({ kind: 'stage', check }));
      if (round === 0) work.push(...(await repo.dueKeywords(utcDay(now), MAX_SENDS_PER_PASS, opts)).map((keyword): Work => ({ kind: 'due', keyword })));
      if (work.length === 0) break;
      let roundContinued = 0;
      for (const chunk of chunksOf(work, provider.maxBatch)) {
        if (stop()) {
          outOfTime = true;
          break;
        }
        const claimed = await this.claim(provider, creds, now, budget, chunk);
        if (claimed.length === 0) continue;
        claimedAny = true;
        chunks++;
        const r = await this.submit(provider, creds, claimed);
        sent += r.sent;
        failed += r.failed;
        continued += r.continued;
        roundContinued += r.continued;
        if (r.refused) {
          refused = true;
          break;
        }
      }
      if (roundContinued === 0) break;
    }
    if (outOfTime) {
      log.info({ provider: provider.id, sent }, 'rank tracking: the pass stopped sending; the rest goes out on the next');
      this.continueSoon();
    }
    if (!claimedAny) return { status: budget.over ? 'budget-reached' : idle, sent: 0, failed: 0 };
    const status: RankStatus = refused ? 'provider-error' : budget.over ? 'budget-reached' : 'ok';
    if (status !== 'provider-error' && sent + continued > 0 && config.lastError) await repo.setLastError(null);
    if (sent || failed) log.info({ provider: provider.id, sent, failed }, 'rank tracking: sent checks');
    return { status, sent, failed };
  }

  /**
   * Claims one chunk of work within the budget: the next stage of a check under way, or the first of a keyword due. A
   * piece the rest of the budget cannot pay for is skipped, not the end: a cheaper one later may still fit.
   */
  private async claim(
    provider: RankProvider,
    creds: RankCredentials,
    now: Date,
    budget: { remaining: number; over: boolean },
    chunk: readonly Work[],
  ): Promise<Claimed[]> {
    const { repo, log } = this.deps;
    const day = utcDay(now);
    const claimed: Claimed[] = [];
    for (const w of chunk) {
      if (w.kind === 'stage') {
        const c = w.check;
        const stage = rankNextStage(c.depth, c.pagesRead);
        if (!stage) continue; // nothing left to read: done when its day ends
        const estimate = provider.estimateCostUsd(stage.pages, creds);
        if (micros(estimate) > budget.remaining) {
          budget.over = true; // waits; done with what it read when its day ends, if the budget never allows it
          continue;
        }
        if (!(await repo.claimStage(c.id, estimate, now))) continue;
        budget.remaining -= micros(estimate);
        claimed.push({ check: c, search: searchOf(c, c.id, stage) });
        continue;
      }
      const k = w.keyword;
      const stage = rankNextStage(k.depth, 0)!;
      const estimate = provider.estimateCostUsd(stage.pages, creds);
      if (micros(estimate) > budget.remaining) {
        budget.over = true;
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
      budget.remaining -= micros(estimate);
      const check: CheckProgress = {
        id: checkId,
        keywordId: k.id,
        projectId: k.projectId,
        provider: provider.id,
        day,
        depth: k.depth,
        domain: k.domain,
        includeSubdomains: k.includeSubdomains,
        resultsRead: 0,
        pagesRead: 0,
        settledMicros: 0,
        attempts: 0,
        confirming: false,
      };
      claimed.push({ check, search: searchOf(k, checkId, stage) });
    }
    return claimed;
  }

  /**
   * Hands claimed stages to the provider in batches and records what came back. `continued`: stages a live provider
   * answered at once without finding the site, now waiting for their next. `refused`: the provider refused a request
   * as a whole, or partway (searches it never sent) — what was not sent was given back.
   */
  private async submit(
    provider: RankProvider,
    creds: RankCredentials,
    claimed: Claimed[],
  ): Promise<{ sent: number; failed: number; continued: number; refused: boolean }> {
    const { repo, io, log } = this.deps;
    const byId = new Map(claimed.map((c) => [c.search.checkId, c.check]));
    // ★ Claims not yet handed to the provider. Whatever happens below, these go back in `finally`: nothing was
    // sent for them. A claim whose request went out is never released — it may have been charged.
    const unsent = new Set(claimed.map((c) => c.search.checkId));
    let sent = 0;
    let failed = 0;
    let continued = 0;
    let refused = false;
    try {
      for (let i = 0; i < claimed.length; i += provider.maxBatch) {
        const batch = claimed.slice(i, i + provider.maxBatch).map((c) => c.search);
        for (const s of batch) unsent.delete(s.checkId);
        let outcomes;
        try {
          outcomes = await provider.submit(creds, batch, io);
        } catch (err) {
          const message = err instanceof RankProviderError ? err.message : 'the provider could not be reached';
          const isRefusal = err instanceof RankProviderError && err.kind !== 'unavailable';
          for (const s of batch) {
            if (isRefusal) await repo.release(s.checkId, byId.get(s.checkId)?.settledMicros);
            else await repo.markFailed(s.checkId, message); // uncertain: the estimate stays booked
          }
          if (!isRefusal) failed += batch.length;
          await repo.setLastError(message, this.now());
          log.warn({ provider: provider.id, kind: err instanceof RankProviderError ? err.kind : 'unknown' }, 'rank tracking: the provider refused the checks');
          refused = true;
          break; // the rest stay in `unsent` and are given back below
        }
        let notSent: string | undefined;
        const pages = await this.lookUpPages(outcomes.flatMap((o) => (o.state === 'done' && byId.has(o.checkId) ? [{ check: byId.get(o.checkId)!, page: o.page }] : [])));
        for (const o of outcomes) {
          const check = byId.get(o.checkId);
          if (!check) continue;
          if (o.state === 'queued') {
            await repo.markQueued(o.checkId, o.ref, o.costUsd, check.settledMicros);
            sent++;
          } else if (o.state === 'done') {
            // A result for a keyword that went away meanwhile still records what the page held (and its cost).
            if ((await this.record(check, o.page, o.costUsd, pages.get(check.id))) === 'next') continued++;
            else sent++;
          } else if (o.state === 'unsent') {
            // Never sent, never charged: given back, and tried again on a later pass.
            await repo.release(o.checkId, check.settledMicros);
            notSent ??= o.error;
          } else if (o.retry && (await this.retry(check, o.error, o.costUsd))) {
            sent++; // sent, and to be tried again later today
          } else {
            await repo.markFailed(o.checkId, o.error, o.costUsd, check.settledMicros);
            failed++;
          }
        }
        if (notSent !== undefined) {
          // The provider refused partway: the admin sees why, and the rest of this pass is given back too.
          await repo.setLastError(notSent, this.now());
          log.warn({ provider: provider.id }, 'rank tracking: the provider refused some of the checks');
          refused = true;
          break;
        }
      }
    } finally {
      for (const id of unsent) await repo.release(id, byId.get(id)?.settledMicros);
    }
    return { sent, failed, continued, refused };
  }
}

/** The request for one stage of a check. */
function searchOf(
  k: { keyword: string; engine: RankSearch['engine']; device: RankSearch['device']; locationName: string; countryCode: string; languageCode: string },
  checkId: string,
  stage: { startPage: number; pages: number },
): RankSearch {
  return {
    checkId,
    keyword: k.keyword,
    engine: k.engine,
    device: k.device,
    location: { name: k.locationName, countryCode: k.countryCode },
    languageCode: k.languageCode,
    ...stage,
  };
}
