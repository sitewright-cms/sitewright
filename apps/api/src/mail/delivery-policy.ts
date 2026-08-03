/**
 * When to retry a form-notification email, and when to stop.
 *
 * Pure on purpose — no clock, no database, no transport. The scheduling decisions are the part
 * most likely to be wrong in a way that is invisible (a backoff that never fires, a lease that
 * never expires), and they are only cheap to test if they do not need a fake timer or a fixture.
 */

/**
 * Delay before attempt N+1, given N failed attempts so far.
 *
 * Front-loaded because most failures are transient — a provider hiccup, a rate limit, a moment of
 * DNS trouble — and those clear in minutes. The long tail exists for the other kind: an expired
 * password or a provider suspension, where retrying every minute for a day would just look like
 * abuse to the far end. Total span is a little over 31 hours, which covers an outage that starts on
 * a Friday evening without pestering anyone.
 */
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000, // 1m
  5 * 60_000, // 5m
  15 * 60_000, // 15m
  60 * 60_000, // 1h
  6 * 60 * 60_000, // 6h
  24 * 60 * 60_000, // 24h
];

/** Attempts after which a submission is marked `failed` and left for a human. */
export const MAX_DELIVERY_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * How long an in-flight attempt is assumed to be running before the row is considered abandoned.
 *
 * The runner pushes `deliveryNextAt` forward by this much BEFORE it tries, so a process killed
 * mid-send leaves a row that becomes due again by itself. Comfortably longer than the transport's
 * own ceiling (connect 10s + greeting 10s + socket 15s) so a slow-but-alive send is never
 * double-attempted, and short enough that a crash costs one lease, not one backoff step.
 */
export const DELIVERY_LEASE_MS = 2 * 60_000;

/**
 * When the next attempt becomes due, or `null` when the attempts are exhausted.
 *
 * `attempts` is the number ALREADY made (so 0 before the first). Returns null at the point the
 * caller should mark the row `failed` rather than schedule another try.
 */
export function nextAttemptAt(attempts: number, now: number): number | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  // attempts=1 → the first entry, i.e. the delay AFTER one failure.
  const delay = RETRY_BACKOFF_MS[attempts - 1];
  if (delay === undefined) return null;
  return now + delay;
}
