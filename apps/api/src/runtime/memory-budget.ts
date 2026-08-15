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

export class MemoryBudget {
  private limitBytes = 0;
  private derivedFromHost = false;
  private reserved = 0;
  private readonly held = new Set<symbol>();
  private cachedUsed = 0;
  private cachedAt = 0;

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
  async tryReserve(bytes: number, label: string): Promise<Reservation | null> {
    // Refresh the sample FIRST, then decide and commit with no await in between. An `await` between
    // reading headroom and taking it re-creates the exact check-then-act race this ledger exists to
    // close: two callers await the same snapshot, both see the same free space, and both proceed.
    // JS is single-threaded, so a synchronous check-and-commit is atomic.
    await this.used();
    return this.tryReserveSync(bytes, label);
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
      },
    };
  }

  /** Test seam: pretend a limit/usage without a cgroup. */
  _setForTest(limitBytes: number, usedBytes: number): void {
    this.limitBytes = limitBytes;
    this.derivedFromHost = false;
    this.cachedUsed = usedBytes;
    this.cachedAt = Date.now();
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
