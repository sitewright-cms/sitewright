/**
 * A concurrency gate that stays fair between projects.
 *
 * The gates in this codebase are whole-instance: a fixed number of slots, plus a bounded queue of
 * waiters. That bounds MEMORY, which is what they exist for, but it says nothing about WHOSE work
 * gets the capacity — so one project could hold every slot and fill the queue behind it, denying the
 * path to every other tenant for minutes while staying comfortably inside its own rate limit.
 *
 * This adds two things to that shape:
 *
 *  - **Fair scheduling.** When a slot frees it goes to the waiter whose project holds the FEWEST
 *    running jobs, oldest first within a tie. With one project waiting every candidate ties, so this
 *    degrades exactly to FIFO — the single-tenant instance, which is the common case, behaves as it
 *    always did. With two, a neighbour's first request overtakes a fifty-deep burst.
 *  - **A per-tenant queue bound.** Scheduling can only help a newcomer who is IN the queue; a
 *    project that has filled it leaves nobody to schedule. Holding a few places back guarantees the
 *    newcomer finds room, and the scheduler then runs it first.
 *
 * `maxInFlightPerTenant` adds outright refusal on top, for gates whose callers are agents rather
 * than browsers: a job that occupies a slot for minutes is better refused quickly (retry later) than
 * queued behind a three-minute wait. Leave it unset where a refusal would be a broken page.
 *
 * ★ Every counter mutation here is SYNCHRONOUS and paired with the queue mutation that causes it.
 * The bug this replaces came from a take/release pair spread across an early `throw` and a later
 * `finally`: the throw skipped the release, so one refusal leaked a permanent share and locked that
 * project out of the route until restart. Holding a slot is not representable apart from being
 * inside `run`, so that class of leak cannot recur.
 */

/** Thrown when the whole gate is saturated — slots full AND the queue full. Retryable. */
export class GateFullError extends Error {
  readonly statusCode = 503;
  constructor(readonly what: string) {
    super(`too many ${what} in progress — this is temporary, retry shortly`);
    this.name = 'GateFullError';
  }
}

/** Thrown when a tenant is at its OWN share of a gate — distinct from the instance being full. */
export class TenantShareError extends Error {
  readonly statusCode = 503;
  constructor(readonly what: string) {
    super(`this project already has its share of concurrent ${what} in flight — retry shortly`);
    this.name = 'TenantShareError';
  }
}

export interface FairGateOptions {
  /** Used in error messages: a plural noun phrase, e.g. 'large imports'. */
  readonly label: string;
  /** Concurrent slots across the whole instance. */
  readonly limit: number;
  /** How many callers may WAIT for a slot before the gate sheds. */
  readonly queue: number;
  /**
   * How many of those queue places one project may occupy. Defaults to the whole queue (no bound).
   * Set it below `queue` to keep room for a newcomer.
   */
  readonly queuePerTenant?: number;
  /**
   * Refuse a project already holding or awaiting this many jobs, instead of queueing it. Omit to let
   * every caller queue and rely on scheduling alone.
   */
  readonly maxInFlightPerTenant?: number;
}

interface Waiter {
  readonly tenant: string;
  readonly resolve: () => void;
}

export class FairGate {
  readonly #opts: FairGateOptions;
  readonly #queuePerTenant: number;
  #active = 0;
  readonly #waiters: Waiter[] = [];
  readonly #activeByTenant = new Map<string, number>();
  readonly #queuedByTenant = new Map<string, number>();
  /**
   * Turn counter for the round-robin tie-break.
   *
   * Running jobs alone are not enough to be fair. At a limit of one, the project that just finished
   * holds zero at the moment the slot is handed on — indistinguishable from the neighbour that has
   * never run — so a naive "fewest running, oldest first" hands the slot straight back to its own
   * queue and the neighbour never moves. Remembering who was served LAST breaks that tie correctly,
   * and turns equal backlogs into alternation instead of one project draining first.
   */
  #turn = 0;
  readonly #servedAt = new Map<string, number>();

  constructor(options: FairGateOptions) {
    // A limit below one would admit nobody while queued callers wait on a handoff that can never
    // happen — every caller hangs forever, which is strictly worse than any amount of contention.
    this.#opts = { ...options, limit: Math.max(1, options.limit), queue: Math.max(0, options.queue) };
    this.#queuePerTenant = Math.max(1, Math.min(options.queuePerTenant ?? this.#opts.queue, this.#opts.queue));
  }

  /** Slots in use across all projects. */
  get active(): number {
    return this.#active;
  }

  /** Callers currently waiting for a slot. */
  get queued(): number {
    return this.#waiters.length;
  }

  /**
   * Slots granted since boot. Monotonic, and incremented exactly once per admission — a request that
   * was refused before taking a slot never moves it, which is how a caller can prove work was kept
   * OUT of the gate rather than merely failing somewhere inside it.
   */
  get admitted(): number {
    return this.#turn;
  }

  /** Running jobs held by one project. */
  activeFor(tenant: string): number {
    return this.#activeByTenant.get(tenant) ?? 0;
  }

  /** Queued jobs held by one project. */
  queuedFor(tenant: string): number {
    return this.#queuedByTenant.get(tenant) ?? 0;
  }

  /**
   * Run `fn` under a slot, waiting for one if the gate is busy.
   *
   * Throws `TenantShareError` if this project is at its own bound, `GateFullError` if the whole gate
   * is saturated. Both carry a 503 and both are worth retrying.
   */
  async run<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
    const perTenant = this.#opts.maxInFlightPerTenant;
    if (perTenant !== undefined && this.activeFor(tenant) + this.queuedFor(tenant) >= perTenant) {
      throw new TenantShareError(this.#opts.label);
    }
    if (this.#active < this.#opts.limit) {
      this.#active += 1;
      bump(this.#activeByTenant, tenant, 1);
      this.#servedAt.set(tenant, (this.#turn += 1));
    } else {
      if (this.#waiters.length >= this.#opts.queue) throw new GateFullError(this.#opts.label);
      if (this.queuedFor(tenant) >= this.#queuePerTenant) throw new TenantShareError(this.#opts.label);
      bump(this.#queuedByTenant, tenant, 1);
      // The releaser dequeues us, moves our count from queued to active and only then wakes us, so
      // past this await the slot is already ours and no third caller can see it as free.
      await new Promise<void>((resolve) => this.#waiters.push({ tenant, resolve }));
    }
    try {
      return await fn();
    } finally {
      this.#release(tenant);
    }
  }

  /** Hand the slot to the fairest waiter, or return it to the pool. */
  #release(tenant: string): void {
    bump(this.#activeByTenant, tenant, -1);
    const next = this.#takeNextWaiter();
    if (next) {
      bump(this.#activeByTenant, next.tenant, 1);
      this.#servedAt.set(next.tenant, (this.#turn += 1));
      next.resolve();
    } else {
      this.#active -= 1;
    }
    // A project holding and awaiting nothing has left the gate; forget it so the maps stay the size
    // of what is actually in flight, and so its next arrival counts as a newcomer (served first).
    if (this.activeFor(tenant) === 0 && this.queuedFor(tenant) === 0) this.#servedAt.delete(tenant);
  }

  /**
   * The waiter to run next: the project holding the FEWEST running jobs, breaking ties in favour of
   * whoever was served LONGEST ago (a project still in its first turn counts as never served).
   *
   * Two waiters of the same project agree on both keys, so the earlier one wins and a project's own
   * jobs keep their arrival order — with a single project waiting, this is plain FIFO.
   */
  #takeNextWaiter(): Waiter | undefined {
    if (this.#waiters.length === 0) return undefined;
    let bestIndex = 0;
    let bestActive = Number.POSITIVE_INFINITY;
    let bestServed = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.#waiters.length; i += 1) {
      const candidate = this.#waiters[i]!.tenant;
      const active = this.activeFor(candidate);
      const served = this.#servedAt.get(candidate) ?? -1;
      if (active < bestActive || (active === bestActive && served < bestServed)) {
        bestIndex = i;
        bestActive = active;
        bestServed = served;
      }
    }
    const picked = this.#waiters.splice(bestIndex, 1)[0]!;
    bump(this.#queuedByTenant, picked.tenant, -1);
    return picked;
  }
}

/** Add `delta` to a counter, dropping the key at zero so an idle project leaves nothing behind. */
function bump(counts: Map<string, number>, tenant: string, delta: number): void {
  const next = (counts.get(tenant) ?? 0) + delta;
  if (next <= 0) counts.delete(tenant);
  else counts.set(tenant, next);
}
