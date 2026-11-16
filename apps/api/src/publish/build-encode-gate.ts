/**
 * Admission for the image encodes BUILDS run, from live free memory.
 *
 * - Encodes start while the instance-wide `ceiling` (a CPU bound) has room AND free memory holds their
 *   estimate. Running build encodes are counted against free memory even before the kernel sees them:
 *   the ledger's `max(used, reserved)` let reservations absorb memory a build already used to render
 *   pages, and 340 parallel encodes OOM-killed a 768MB container.
 * - When memory does NOT hold one, a single encode still runs instance-wide — given to a build that has
 *   none running — so no build ever stalls: under pressure encodes go one at a time, as every build
 *   encoded before it shared anything. ★ That guarantee used to be PER BUILD and above the ceiling, so
 *   ten concurrent builds (agents' previews, a publish, an audit's build) ran ten 24MP encodes with no
 *   memory check at all; MEASURED at 1.5 GiB, that is what OOM-killed the container under load.
 * - A build with nothing running goes first: a big build's queue cannot keep a small one waiting.
 * - Each admitted encode is also BOOKED with the shared ledger, so the instance's other memory gates
 *   (uploads, list calls, screenshots) see it.
 * - The single-page preview borrows room that is free right now (`runIfFree`) for the images of a page
 *   a member just rendered; when there is none it takes the public thumbnail gate as before.
 */
export interface EncodeMemorySnapshot {
  availableBytes: number;
  usedBytes: number;
  reservedBytes: number;
}

/** One build's share — create one per build. */
export interface BuildEncodeCount {
  running: number;
  /** This build's calls waiting while it had nothing running (kept by the gate). */
  waiting?: number;
}

export class BuildEncodeGate {
  private running = 0;
  private bytes = 0;
  /** Encodes running WITHOUT their memory fitting — the one that keeps builds moving (at most 1). */
  private unchecked = 0;
  /**
   * Builds waiting with nothing running, oldest first. The head gets the next slot: a build is counted
   * once however many encodes it asks for at once, so a big build cannot outvote a small one.
   */
  private readonly starving: BuildEncodeCount[] = [];
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
    let queued = false; // this call is counted in build.waiting
    try {
      for (;;) {
        if (this.mayTry(build)) {
          const snap = await this.snapshot();
          if (this.mayTry(build)) {
            const fits = this.fits(snap, bytes);
            if (fits || (build.running === 0 && this.unchecked === 0)) return this.admitted(bytes, fn, build, !fits);
          }
        }
        // Waiting. A build with nothing running joins the queue of builds that go first — at the BACK,
        // so a big build whose own encode just finished does not jump a small one that waited longer.
        if (build.running === 0) {
          if (!queued) {
            queued = true;
            build.waiting = (build.waiting ?? 0) + 1;
          }
          if (!this.starving.includes(build)) this.starving.push(build);
        } else if (queued) {
          queued = false;
          this.leave(build);
        }
        await this.freed();
      }
    } finally {
      if (queued) this.leave(build);
    }
  }

  /** Room under the ceiling, and no build that waited with nothing running is ahead of this one. */
  private mayTry(build: BuildEncodeCount): boolean {
    return this.running < this.ceiling && (this.starving.length === 0 || this.starving[0] === build);
  }

  private leave(build: BuildEncodeCount): void {
    build.waiting = Math.max(0, (build.waiting ?? 1) - 1);
    if (build.waiting === 0) this.unqueue(build);
  }

  private unqueue(build: BuildEncodeCount): void {
    const at = this.starving.indexOf(build);
    if (at >= 0) this.starving.splice(at, 1);
  }

  /** Resolves when an encode here finishes, or after the poll interval (memory frees up elsewhere too). */
  freed(): Promise<void> {
    return new Promise<void>((resolve) => {
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

  /**
   * Runs `fn` NOW when the ceiling has room and free memory holds `bytes`; otherwise resolves undefined
   * without running it, so the caller can take its usual path instead. It never waits for a slot,
   * belongs to no build, and never runs without its memory fitting.
   */
  async runIfFree<T>(bytes: number, fn: () => Promise<T>): Promise<{ value: T } | undefined> {
    // A build with nothing running is waiting: it gets the slot, and the preview takes its usual path.
    if (this.running >= this.ceiling || this.starving.length > 0) return undefined;
    const snap = await this.snapshot();
    // Re-checked after the await and claimed with none in between, as in run().
    if (this.running >= this.ceiling || this.starving.length > 0 || !this.fits(snap, bytes)) return undefined;
    return { value: await this.admitted(bytes, fn, undefined, false) };
  }

  private async admitted<T>(bytes: number, fn: () => Promise<T>, build: BuildEncodeCount | undefined, unchecked: boolean): Promise<T> {
    this.running += 1;
    this.bytes += bytes;
    if (unchecked) this.unchecked += 1;
    if (build) {
      build.running += 1;
      this.unqueue(build); // it has one running now: it no longer goes first
    }
    let booked: { release(): void } | undefined;
    try {
      booked = this.book?.(bytes);
      return await fn();
    } finally {
      booked?.release();
      this.running -= 1;
      this.bytes -= bytes;
      if (unchecked) this.unchecked -= 1;
      if (build) build.running -= 1;
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
