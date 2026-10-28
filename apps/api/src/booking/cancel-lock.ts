/**
 * ONE CANCELLATION OF A BOOKING AT A TIME. A paid booking's cancellation is two steps (its money first, then the
 * booking), and two of them at once (a double click, the customer and the business together) would each decide the
 * money: one refunds, the other finds nothing left and mails that the refund could not be confirmed. Run through
 * here, the second waits for the first, then finds the booking gone.
 *
 * In-process: one API process serves a project's bookings (as the project's booking queue already assumes). Keys
 * are dropped once their last run ends, so the map holds only cancellations in progress.
 */
export class BookingCancelLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(projectId: string, claimId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${projectId}\u0000${claimId}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** How many bookings have a cancellation in progress (for tests). */
  get size(): number {
    return this.tails.size;
  }
}

/**
 * A paid booking is not cancelled online in its last minute: its refund and its cancellation must both land before
 * it starts, or a refund could go out for a booking the cancellation then refuses as started.
 */
export const PAID_CANCEL_MARGIN_MS = 60_000;
