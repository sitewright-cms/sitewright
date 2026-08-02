import { describe, it, expect } from 'vitest';
import {
  RETRY_BACKOFF_MS,
  MAX_DELIVERY_ATTEMPTS,
  DELIVERY_LEASE_MS,
  nextAttemptAt,
} from '../src/mail/delivery-policy.js';

// Pure scheduling decisions. Worth testing directly because their failure mode is silence: a
// backoff that never fires, or a lease that never expires, produces no error anywhere — the mail
// simply never goes, which is the exact condition this whole mechanism exists to end.

const NOW = 1_800_000_000_000;

describe('retry backoff', () => {
  it('starts within a minute — most failures are transient and clear quickly', () => {
    expect(nextAttemptAt(1, NOW)).toBe(NOW + 60_000);
  });

  it('lengthens every step, so a dead server is not hammered like a flaky one', () => {
    const delays = Array.from({ length: RETRY_BACKOFF_MS.length }, (_, i) => nextAttemptAt(i + 1, NOW)! - NOW);
    expect(delays).toEqual([...RETRY_BACKOFF_MS]);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
  });

  it('★ gives up rather than retrying forever, and the span covers a weekend outage', () => {
    expect(nextAttemptAt(MAX_DELIVERY_ATTEMPTS, NOW)).toBeNull();
    expect(nextAttemptAt(MAX_DELIVERY_ATTEMPTS + 5, NOW)).toBeNull();
    const total = RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(24 * 60 * 60_000); // more than a day of trying
    expect(total).toBeLessThan(48 * 60 * 60_000); // but not an unbounded pile-up
  });

  it('the lease outlasts the transport’s own ceiling, so a slow send is never double-attempted', () => {
    // connect 10s + greeting 10s + socket 15s is the worst case a single send can take.
    expect(DELIVERY_LEASE_MS).toBeGreaterThan(35_000);
  });
});
