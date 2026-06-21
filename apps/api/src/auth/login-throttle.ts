/**
 * A per-key (per-IP) FAILED-attempt throttle for the login routes. Unlike a plain request rate limit,
 * a SUCCESSFUL login never consumes the budget — only failed credential/TOTP checks count — so a busy
 * legitimate user is never locked out, while credential guessing from one source is bounded.
 *
 * In-memory + per-process (resets on restart; not shared across replicas — fine for a single container,
 * and a brute-force attacker can't benefit from a restart). Fixed window keyed off an injectable clock
 * for deterministic tests. Lazy expiry on read + an opportunistic sweep bound memory.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
// Hard cap on tracked keys — a flood of distinct source IPs can't grow the map unbounded (a sweep runs
// first when the cap is hit). Far above any realistic concurrent-attacker count.
const MAX_KEYS = 50_000;

export class LoginThrottle {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when `key` has already reached `max` failures in the current window — the caller returns 429. */
  isBlocked(key: string, max: number): boolean {
    const b = this.buckets.get(key);
    if (!b || this.now() >= b.resetAt) return false;
    return b.count >= max;
  }

  /** Record ONE failed attempt for `key` (call only on a failed credential/TOTP check). */
  recordFailure(key: string): void {
    const t = this.now();
    const existing = this.buckets.get(key);
    if (!existing || t >= existing.resetAt) {
      if (this.buckets.size >= MAX_KEYS) this.sweep();
      this.buckets.set(key, { count: 1, resetAt: t + this.windowMs });
      return;
    }
    this.buckets.set(key, { count: existing.count + 1, resetAt: existing.resetAt });
  }

  /** Drop expired buckets (opportunistic — bounds memory under a distinct-key flood). */
  sweep(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) if (t >= b.resetAt) this.buckets.delete(k);
  }
}
