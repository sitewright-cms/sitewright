/**
 * The headless-render slot pool: a small counting semaphore with a bounded wait, shared by every
 * browser-driving path (screenshots, the clone/visual captures, the Lighthouse audit) so a burst of
 * them cannot together exhaust container memory. Pure — no browser here — so the queue's behaviour is
 * unit-tested directly; `screenshot.ts` owns the one shared instance.
 */

/** Seconds a refused caller is told to wait before retrying (the `retry-after` the route sends). */
export const RENDER_BUSY_RETRY_AFTER_S = 15;

/**
 * No slot freed up within the wait budget. This is BACKPRESSURE, not a fault: the feature works and
 * every slot is held by other renders. It used to be a plain `Error`, which every route that let it
 * propagate turned into an opaque 500 — and an agent that reads a 500 as fatal stops retrying the one
 * thing that would have worked a few seconds later.
 *
 * Carries the fields the app's error handler reads off any error (`statusCode`, `retryable`,
 * `retryAfterSeconds`), so a route that does not catch it still answers 503 + `retry-after`.
 */
export class RenderQueueBusyError extends Error {
  readonly statusCode = 503;
  readonly retryable = true;
  readonly retryAfterSeconds: number;

  /** `queued`: refused without waiting, because that many callers were already queued. */
  constructor(waitedMs: number, retryAfterSeconds: number = RENDER_BUSY_RETRY_AFTER_S, queued?: number) {
    super(
      queued !== undefined
        ? `the headless-render queue is full — ${queued} requests are already waiting ` +
            `(other audits or screenshots are running); retry in about ${retryAfterSeconds}s`
        : `the headless-render queue is busy — every render slot stayed in use for ${Math.round(waitedMs / 1000)}s ` +
            `(other audits or screenshots are running); retry in about ${retryAfterSeconds}s`,
    );
    this.name = 'RenderQueueBusyError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SlotPool {
  /**
   * Take a slot, waiting at most the pool's budget. Rejects with {@link RenderQueueBusyError} when the
   * wait runs out, or with the signal's reason when `signal` aborts first — an abandoned caller LEAVES
   * the queue rather than inheriting a slot nobody is waiting for.
   */
  acquire(signal?: AbortSignal): Promise<void>;
  /** Give a slot back (to the next waiter, if any). Pair with exactly one successful {@link acquire}. */
  release(): void;
  /** Run `fn` holding a slot; the slot is released however `fn` settles. */
  run<T>(fn: () => Promise<T>, opts?: { signal?: AbortSignal }): Promise<T>;
  /** Slots currently held. */
  readonly active: number;
  /** Callers currently queued for a slot. */
  readonly waiting: number;
}

/**
 * `maxWaiting` caps the QUEUE: past it a caller is refused at once instead of joining. A waiter holds its
 * request (and, for an audit, a minute of the caller's patience) for work that cannot start until every
 * caller ahead of it has finished — past a few of those, "come back later" now is the better answer.
 */
export function createSlotPool(opts: { max: number; acquireTimeoutMs: number; retryAfterSeconds?: number; maxWaiting?: number }): SlotPool {
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(signal?: AbortSignal): Promise<void> {
    // `reason` is what `signal.throwIfAborted()` would throw — an AbortError unless the caller gave one.
    if (signal?.aborted) throw signal.reason;
    if (active < opts.max) {
      active++;
      return;
    }
    if (opts.maxWaiting !== undefined && waiters.length >= opts.maxWaiting) {
      throw new RenderQueueBusyError(0, opts.retryAfterSeconds, waiters.length);
    }
    await new Promise<void>((resolve, reject) => {
      // Each way out disarms the other two (timer, abort listener, queue seat), so exactly one of
      // onFree / onAbort / the timeout ever runs — `active++` cannot be applied twice.
      const leave = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const i = waiters.indexOf(onFree);
        if (i >= 0) waiters.splice(i, 1);
      };
      const onFree = (): void => {
        leave();
        active++; // take the slot the releaser just freed
        resolve();
      };
      const onAbort = (): void => {
        leave();
        reject((signal as AbortSignal).reason);
      };
      const timer = setTimeout(() => {
        leave();
        reject(new RenderQueueBusyError(opts.acquireTimeoutMs, opts.retryAfterSeconds));
      }, opts.acquireTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.push(onFree);
    });
  }

  function release(): void {
    active--;
    waiters.shift()?.();
  }

  return {
    acquire,
    release,
    async run<T>(fn: () => Promise<T>, runOpts?: { signal?: AbortSignal }): Promise<T> {
      await acquire(runOpts?.signal);
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiters.length;
    },
  };
}
