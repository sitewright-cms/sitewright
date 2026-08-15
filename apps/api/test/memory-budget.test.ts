import { describe, it, expect } from 'vitest';
import { MemoryBudget, detectMemoryLimit } from '../src/runtime/memory-budget.js';

const MB = 1024 * 1024;

/** A budget with a known limit/usage, bypassing the cgroup. */
function budget(limitMb: number, usedMb: number, headroom = 0.2): MemoryBudget {
  const b = new MemoryBudget(headroom);
  b._setForTest(limitMb * MB, usedMb * MB);
  return b;
}

describe('MemoryBudget', () => {
  it('leaves headroom rather than handing out the whole limit', async () => {
    // 1000MB limit, 20% headroom, 100MB used → 800 spendable − 100 = 700 available.
    const snap = await budget(1000, 100).snapshot();
    expect(Math.round(snap.availableBytes / MB)).toBe(700);
  });

  it('refuses a reservation larger than what is available, and grants one that fits', async () => {
    const b = budget(1000, 100);
    expect(await b.tryReserve(900 * MB, 'too-big')).toBeNull();
    const ok = await b.tryReserve(600 * MB, 'fits');
    expect(ok).not.toBeNull();
    expect(ok!.bytes).toBe(600 * MB);
  });

  it('holds the reservation so a CONCURRENT caller cannot be admitted on the same headroom', async () => {
    // The race a check-then-act gate loses: both callers see 700MB free in the same tick.
    const b = budget(1000, 100);
    const [a, c] = await Promise.all([b.tryReserve(500 * MB, 'a'), b.tryReserve(500 * MB, 'b')]);
    const granted = [a, c].filter(Boolean);
    expect(granted, 'exactly one of two 500MB claims fits in 700MB').toHaveLength(1);
  });

  it('frees the headroom again when a reservation is released', async () => {
    const b = budget(1000, 100);
    const first = await b.tryReserve(600 * MB, 'first');
    expect(await b.tryReserve(600 * MB, 'second')).toBeNull();
    first!.release();
    expect(await b.tryReserve(600 * MB, 'second')).not.toBeNull();
  });

  it('ignores a double release, so one buggy caller cannot inflate the budget', async () => {
    const b = budget(1000, 100);
    const r = await b.tryReserve(300 * MB, 'r');
    r!.release();
    r!.release();
    r!.release();
    expect(Math.round((await b.snapshot()).reservedBytes / MB)).toBe(0);
  });

  it('does NOT double-count work that has already allocated', async () => {
    // The subtle one. A reservation whose memory is already resident shows up in BOTH `used` and
    // `reserved`; adding them would shed at half the real pressure. Committed is the max, not the sum.
    const b = budget(1000, 500); // 500MB already resident
    b.forceReserve(500 * MB, 'already-allocated');
    const snap = await b.snapshot();
    expect(snap.reservedBytes).toBe(500 * MB);
    // 800 spendable − max(500 used, 500 reserved) = 300, NOT 800 − 1000 = 0.
    expect(Math.round(snap.availableBytes / MB)).toBe(300);
  });

  it('reports zero available rather than a negative budget when usage exceeds the ceiling', async () => {
    const snap = await budget(1000, 950).snapshot();
    expect(snap.availableBytes).toBe(0);
  });

  it('forceReserve admits work even with no headroom (already-committed resources)', async () => {
    const b = budget(1000, 950);
    const r = b.forceReserve(100 * MB, 'running-browser');
    expect(r.bytes).toBe(100 * MB);
    expect((await b.snapshot()).reservedBytes).toBe(100 * MB);
  });

  it('detects a real limit, and flags when it had to fall back to the host', async () => {
    // On this machine the cgroup may or may not be capped; either answer is valid, but the figure
    // must be plausible and the fallback must be labelled rather than silently pretending.
    const { limitBytes, derivedFromHost } = await detectMemoryLimit();
    expect(limitBytes).toBeGreaterThan(64 * MB);
    expect(typeof derivedFromHost).toBe('boolean');
  });
});
