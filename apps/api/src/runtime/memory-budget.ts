import { readFile } from 'node:fs/promises';
import { totalmem } from 'node:os';

/**
 * The instance's memory budget — what is actually available RIGHT NOW, and a reservation ledger so
 * expensive work is admitted against real headroom instead of a hardcoded count.
 *
 * WHY THIS EXISTS. Every guard in the API counts REQUESTS (3 concurrent optimizes, 2 imports, 2
 * exports), never bytes. Measured on a 1 GiB container: ten concurrent list calls rode to exactly
 * the cap and survived, then three concurrent screenshots took the container out with exit 137 —
 * an OOM kill, not backpressure, so every in-flight request died with it. Counting requests cannot
 * see that, because the cost of a request varies from ~0 to 200 MB.
 *
 * THREE THINGS THIS GETS RIGHT, each because the naive version was measured to be wrong:
 *
 * 1. "Used" is `anon + unreclaimable slab`, NOT `memory.current`. `current` includes the page cache,
 *    which the kernel drops under pressure — measured 538 MB current vs 484 MB anon on an idle
 *    container, and the gap widens sharply while writing media. Treating cache as used would make an
 *    instance starve itself right after an upload.
 *
 * 2. Admission RESERVES. A check-then-act gate is racy: N callers can observe the same headroom in
 *    the same tick and all proceed. Callers declare an estimated cost, the ledger holds it for the
 *    duration, and the live reading is a correction on top — never the only signal.
 *
 * 3. Readings LAG. RSS does not fall the moment work finishes (measured: the floor oscillated
 *    343→459 MB with no load and no leak), so a decision taken purely on an instantaneous sample
 *    would shed for seconds after a burst. Samples are cached briefly and callers that scale slow
 *    resources (worker pool, browser) are expected to apply their own hysteresis.
 */

/** cgroup v2, then v1, then the host. `max` (v2) / a huge sentinel (v1) means "no limit set". */
const CGROUP_V2_MAX = '/sys/fs/cgroup/memory.max';
const CGROUP_V2_CURRENT = '/sys/fs/cgroup/memory.current';
const CGROUP_V2_STAT = '/sys/fs/cgroup/memory.stat';
const CGROUP_V1_MAX = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
const CGROUP_V1_USAGE = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
const CGROUP_V1_STAT = '/sys/fs/cgroup/memory/memory.stat';

/**
 * A container with no limit set reports the host's whole RAM, which on a big build host is tens of
 * GB — a budget derived from that would admit everything and defeat the point. Treat an
 * implausible "limit" as unset and fall back to a conservative fraction of host memory.
 */
const UNLIMITED_SENTINEL = 1024 ** 4; // 1 TiB

/** Never hand out the whole budget: leave room for allocations nothing declares (GC, sockets, libs). */
const DEFAULT_HEADROOM_FRACTION = 0.2;

/** How long a usage sample is reused. Long enough to survive a burst of admissions, short enough to react. */
const SAMPLE_TTL_MS = 250;

export interface MemorySnapshot {
  /** The enforced ceiling (cgroup limit, or a fallback derived from host RAM). */
  limitBytes: number;
  /** Non-reclaimable memory in use — anonymous pages + unreclaimable slab. */
  usedBytes: number;
  /** Bytes currently promised to in-flight work by the ledger. */
  reservedBytes: number;
  /** What a new admission may take: limit − headroom − max(used, reserved-adjusted). */
  availableBytes: number;
  /** True when no cgroup limit was found and the figure is derived from host RAM. */
  derivedFromHost: boolean;
}

const readNumberFile = async (path: string): Promise<number | null> => {
  try {
    const raw = (await readFile(path, 'utf8')).trim();
    if (raw === 'max') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

/** Sum the named keys out of a cgroup `memory.stat` (space-separated `key value` lines). */
const readStatKeys = async (path: string, keys: readonly string[]): Promise<number | null> => {
  try {
    const raw = await readFile(path, 'utf8');
    let total = 0;
    let found = false;
    for (const line of raw.split('\n')) {
      const [k, v] = line.split(/\s+/);
      if (k && keys.includes(k)) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          total += n;
          found = true;
        }
      }
    }
    return found ? total : null;
  } catch {
    return null;
  }
};

/**
 * The ceiling this process should respect. A cgroup limit wins; otherwise fall back to a fraction of
 * host RAM, because an uncapped container that sizes itself from a 62 GB host will happily plan for
 * memory the operator never intended it to use.
 */
export async function detectMemoryLimit(): Promise<{ limitBytes: number; derivedFromHost: boolean }> {
  for (const path of [CGROUP_V2_MAX, CGROUP_V1_MAX]) {
    const v = await readNumberFile(path);
    if (v !== null && v < UNLIMITED_SENTINEL) return { limitBytes: v, derivedFromHost: false };
  }
  // No enforced limit. Half of host RAM is a deliberately conservative planning figure: it keeps a
  // co-tenanted host usable and makes the uncapped case behave like a modest container.
  return { limitBytes: Math.floor(totalmem() / 2), derivedFromHost: true };
}

/** Non-reclaimable usage. Falls back to `current`/`usage_in_bytes` only if `stat` is unreadable. */
export async function readUsedBytes(): Promise<number> {
  const v2 = await readStatKeys(CGROUP_V2_STAT, ['anon', 'slab_unreclaimable']);
  if (v2 !== null) return v2;
  const v1 = await readStatKeys(CGROUP_V1_STAT, ['rss']);
  if (v1 !== null) return v1;
  for (const path of [CGROUP_V2_CURRENT, CGROUP_V1_USAGE]) {
    const v = await readNumberFile(path);
    if (v !== null) return v;
  }
  // Last resort: this process only. Undercounts children (render workers, the browser), so it is a
  // floor, not a truth — which is why it is last.
  return process.memoryUsage.rss();
}

/** A held reservation. Release exactly once; releasing twice is harmless. */
export interface Reservation {
  readonly bytes: number;
  readonly label: string;
  release(): void;
}

/**
 * How long a caller may WAIT for headroom before being refused, and how many may wait at once.
 *
 * Serializing beats shedding when the shortage is transient — most spikes clear in seconds, and a
 * slightly slower success is far better than a 503. But a queue is memory too: every waiter holds its
 * connection, its parsed body and its closure, so an unbounded queue OOMs with the queue. And some
 * reservations (the browser, a worker) are held for a LIFETIME and never free while the instance is
 * serving, so waiting forever really would be forever. Bounded wait, bounded depth, then refuse.
 */
const MAX_WAITERS = 32;

export class MemoryBudget {
  private limitBytes = 0;
  private derivedFromHost = false;
  private reserved = 0;
  private readonly held = new Set<symbol>();
  private cachedUsed = 0;
  private cachedAt = 0;
  /**
   * Set by `_setForTest`: hold the pretended usage instead of resampling the real cgroup.
   *
   * Without this the seam expires after {@link SAMPLE_TTL_MS} and the budget silently reverts to
   * whatever the host is really doing — so a test asserting "there is headroom" passes only while it
   * finishes inside 250ms, and starts shedding as soon as it does enough work to matter. That is a
   * test that reports the machine's load, not the code's behaviour.
   */
  private frozen = false;
  /** Woken when a reservation is released, so a waiter can re-try immediately instead of polling. */
  private waiters: Array<() => void> = [];

  constructor(private readonly headroomFraction: number = DEFAULT_HEADROOM_FRACTION) {}

  /** Read the cgroup once at boot. Cheap, and the limit cannot change under a running container. */
  async init(): Promise<void> {
    const { limitBytes, derivedFromHost } = await detectMemoryLimit();
    this.limitBytes = limitBytes;
    this.derivedFromHost = derivedFromHost;
    this.cachedUsed = await readUsedBytes();
    this.cachedAt = Date.now();
  }

  get limit(): number {
    return this.limitBytes;
  }

  /** Usage, resampled at most every {@link SAMPLE_TTL_MS} so an admission burst is not a syscall storm. */
  private async used(now = Date.now()): Promise<number> {
    if (this.frozen) return this.cachedUsed;
    if (now - this.cachedAt >= SAMPLE_TTL_MS) {
      this.cachedUsed = await readUsedBytes();
      this.cachedAt = now;
    }
    return this.cachedUsed;
  }

  async snapshot(): Promise<MemorySnapshot> {
    const usedBytes = await this.used();
    const spendable = this.limitBytes * (1 - this.headroomFraction);
    // Reservations for work that has already allocated are ALREADY in `used`, so adding them
    // wholesale would double-count and shed far too early. Take whichever is larger: what the
    // kernel sees, or what we have promised.
    const committed = Math.max(usedBytes, this.reserved);
    return {
      limitBytes: this.limitBytes,
      usedBytes,
      reservedBytes: this.reserved,
      availableBytes: Math.max(0, Math.floor(spendable - committed)),
      derivedFromHost: this.derivedFromHost,
    };
  }

  /**
   * Reserve `bytes` for a piece of work, or return null when there is not room.
   *
   * The caller decides what a refusal means — a 503 for a request, "run one fewer worker" for a
   * pool. Returning null rather than throwing keeps the decision at the call site.
   */
  /**
   * `waitMs` defaults to 0 — REFUSE IMMEDIATELY. Waiting is opt-in at the call site rather than a
   * default, because a default wait silently turns every existing caller into a blocking one: it
   * makes them hold whatever else they already own (a concurrency slot, a connection) for the
   * duration, which is a latency change nobody asked for.
   */
  async tryReserve(bytes: number, label: string, waitMs = 0): Promise<Reservation | null> {
    // Refresh the sample FIRST, then decide and commit with no await in between. An `await` between
    // reading headroom and taking it re-creates the exact check-then-act race this ledger exists to
    // close: two callers await the same snapshot, both see the same free space, and both proceed.
    // JS is single-threaded, so a synchronous check-and-commit is atomic.
    await this.used();
    const immediate = this.tryReserveSync(bytes, label);
    if (immediate || waitMs <= 0) return immediate;

    // No room right now. WAIT for a release rather than refusing outright — a transient spike is the
    // common case, and a slower success beats a 503. Bounded on both axes: at most `waitMs`, and at
    // most MAX_WAITERS queued, because the queue is memory as surely as the work is.
    if (this.waiters.length >= MAX_WAITERS) return null;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const woke = await this.waitForRelease(deadline - Date.now());
      // Re-sample: a release may have been accompanied by the kernel reclaiming more.
      await this.used();
      const retry = this.tryReserveSync(bytes, label);
      if (retry) return retry;
      if (!woke) break; // timed out rather than being woken
    }
    return null;
  }

  /** Resolves true when a reservation was released, false on timeout. */
  private waitForRelease(ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (woken: boolean): void => {
        if (settled) return;
        settled = true;
        this.waiters = this.waiters.filter((w) => w !== wake);
        clearTimeout(timer);
        resolve(woken);
      };
      const wake = (): void => done(true);
      const timer = setTimeout(() => done(false), Math.max(0, ms));
      timer.unref?.();
      this.waiters.push(wake);
    });
  }

  /** The atomic half of {@link tryReserve}: no awaits, so nothing can interleave. */
  private tryReserveSync(bytes: number, label: string): Reservation | null {
    const spendable = this.limitBytes * (1 - this.headroomFraction);
    const committed = Math.max(this.cachedUsed, this.reserved);
    const available = Math.max(0, Math.floor(spendable - committed));
    if (bytes > available) return null;
    return this.forceReserve(bytes, label);
  }

  /**
   * Reserve unconditionally — for work already committed elsewhere (a browser that is running, a
   * worker already forked). Keeps the ledger honest about memory we know is spoken for.
   */
  forceReserve(bytes: number, label: string): Reservation {
    const token = Symbol(label);
    this.held.add(token);
    this.reserved += bytes;
    let released = false;
    return {
      bytes,
      label,
      release: () => {
        if (released || !this.held.has(token)) return;
        released = true;
        this.held.delete(token);
        this.reserved = Math.max(0, this.reserved - bytes);
        // Headroom just appeared — wake everyone waiting so the first that fits proceeds at once.
        const woken = this.waiters;
        this.waiters = [];
        for (const wake of woken) wake();
      },
    };
  }

  /**
   * Test seam: pretend a limit/usage without a cgroup.
   *
   * The pretended usage is FROZEN — it must not decay back to the real cgroup mid-test, or an
   * assertion about admission quietly becomes an assertion about how busy the host happened to be.
   */
  _setForTest(limitBytes: number, usedBytes: number): void {
    this.limitBytes = limitBytes;
    this.derivedFromHost = false;
    this.cachedUsed = usedBytes;
    this.cachedAt = Date.now();
    this.frozen = true;
  }
}

/**
 * The process-wide budget.
 *
 * A singleton because the thing being rationed is a single OS-level resource: two ledgers would each
 * believe they had the whole container. Modules that own a long-lived allocation (the headless
 * browser) reserve against this directly, rather than the HTTP layer trying to guess on their behalf.
 */
export const sharedMemoryBudget = new MemoryBudget();
