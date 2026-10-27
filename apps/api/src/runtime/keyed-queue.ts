/**
 * A per-key promise chain: work for one key runs one at a time, in order; different keys run freely. Keeps
 * a read-modify-write pair (check a SKU's stock then reserve it, check a resource's time then claim it)
 * from interleaving. In-process: the platform runs one API process, and libsql transactions are not a
 * compare-and-swap.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly depth = new Map<string, number>();

  /** How many pieces of work for `key` are running or waiting. A caller can refuse new work past a bound. */
  waiting(key: string): number {
    return this.depth.get(key) ?? 0;
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.depth.set(key, this.waiting(key) + 1);
    const done = (): void => {
      const n = this.waiting(key) - 1;
      if (n > 0) this.depth.set(key, n);
      else this.depth.delete(key);
    };
    const prior = this.tails.get(key) ?? Promise.resolve();
    // `.then(fn, fn)` deliberately: a REJECTED predecessor must not cancel the next waiter, nor
    // leave the chain permanently rejected.
    const next = prior.then(fn, fn).finally(done);
    // The stored tail swallows rejections — the CALLER still receives `next` with its real outcome.
    // Without the catch, the tail itself is an unhandled rejection.
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    // Drop the entry once this is the last waiter, so the map does not grow one key per SKU for the
    // lifetime of the process. Compared by identity: a later `run` has already replaced the tail.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
