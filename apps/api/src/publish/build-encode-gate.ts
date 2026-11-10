/**
 * Admission for the image encodes BUILDS run, from live free memory.
 *
 * - Every build can always run ONE encode: that is how each build encoded before it shared anything, so
 *   it is never slower than that, and never stalls.
 * - Further encodes start while the instance-wide `ceiling` (a CPU bound) has room AND free memory holds
 *   their estimate. Running build encodes are counted against free memory even before the kernel sees
 *   them: the ledger's `max(used, reserved)` let reservations absorb memory a build already used to render
 *   pages, and 340 parallel encodes OOM-killed a 768MB container.
 * - Each admitted encode is also BOOKED with the shared ledger, so the instance's other memory gates
 *   (uploads, list calls, screenshots) see it.
 */
export interface EncodeMemorySnapshot {
  availableBytes: number;
  usedBytes: number;
  reservedBytes: number;
}

/** One build's share — create one per build. */
export interface BuildEncodeCount {
  running: number;
}

export class BuildEncodeGate {
  private running = 0;
  private bytes = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly ceiling: number,
    /** Live memory, or undefined when the instance has no known limit (then the ceiling alone decides). */
    private readonly snapshot: () => Promise<EncodeMemorySnapshot | undefined>,
    /** Book `bytes` with the shared ledger for as long as the encode runs. */
    private readonly book?: (bytes: number) => { release(): void },
    private readonly pollMs = 250,
  ) {}

  async run<T>(build: BuildEncodeCount, bytes: number, fn: () => Promise<T>): Promise<T> {
    // Every check below is followed by its claim with NO await in between, so concurrent callers can
    // never all see "nothing running" and start together.
    for (;;) {
      if (build.running === 0) break;
      if (this.running < this.ceiling) {
        const snap = await this.snapshot();
        if (build.running === 0 || (this.running < this.ceiling && this.fits(snap, bytes))) break;
      }
      // Woken when an encode finishes; re-checked on a timer too, as memory frees up elsewhere.
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, this.pollMs);
        timer.unref?.();
        this.waiters.add(wake);
      });
    }
    this.running += 1;
    this.bytes += bytes;
    build.running += 1;
    let booked: { release(): void } | undefined;
    try {
      booked = this.book?.(bytes);
      return await fn();
    } finally {
      booked?.release();
      this.running -= 1;
      this.bytes -= bytes;
      build.running -= 1;
      for (const wake of [...this.waiters]) wake();
    }
  }

  private fits(snap: EncodeMemorySnapshot | undefined, bytes: number): boolean {
    if (!snap) return true;
    // `availableBytes` is spendable − max(used, reserved). When the reservations (which include these
    // encodes, booked) are the larger, they are already taken off; otherwise take them off again rather
    // than trust that the kernel has seen them yet.
    const free = snap.availableBytes - (snap.reservedBytes >= snap.usedBytes ? 0 : this.bytes);
    return free >= bytes;
  }
}
