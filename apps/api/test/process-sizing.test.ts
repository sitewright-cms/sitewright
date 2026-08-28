import { describe, it, expect } from 'vitest';
import { processSizing, WORKER_HEAP_MB } from '../src/runtime/process-sizing.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * The invariant this module exists for: the ceilings handed to the processes that SHARE the cgroup
 * must sum to less than the cgroup. Before this, the main heap (65% of the limit) and the render pool
 * were derived independently from the same number, so on a 512 MB container they promised 458 MB
 * between them and the kernel SIGKILLed the result.
 */
const committedMb = (limitBytes: number): number => {
  const s = processSizing(limitBytes);
  const WORKER_OVERHEAD = 30; // mirrors the module's own allowance
  const MAIN_NATIVE = 80;
  return s.mainHeapMb + s.poolSize * (s.workerHeapMb + WORKER_OVERHEAD) + MAIN_NATIVE;
};

describe('processSizing — the ceilings must fit in the cgroup', () => {
  for (const [label, limit] of [
    ['512 MB', 512 * MB],
    ['768 MB', 768 * MB],
    ['1 GB', GB],
    ['2 GB', 2 * GB],
    ['4 GB', 4 * GB],
    ['8 GB', 8 * GB],
    ['31 GB (uncapped, derived from host)', 31 * GB],
  ] as const) {
    it(`fits at ${label}`, () => {
      const limitMb = limit / MB;
      expect(committedMb(limit)).toBeLessThan(limitMb);
    });
  }

  it('leaves real headroom at 512 MB, where the OOM was measured', () => {
    const s = processSizing(512 * MB);
    // The old figure was 65% = 332 MB, which with a 128 MB worker over-subscribed the container.
    expect(s.mainHeapMb).toBeLessThan(332);
    expect(s.poolSize).toBe(1);
    expect(committedMb(512 * MB)).toBeLessThanOrEqual(512 - 512 * 0.05);
  });

  it('only ever TIGHTENS the old 65% ceiling, never loosens it', () => {
    for (const limit of [512 * MB, 768 * MB, GB, 2 * GB, 4 * GB, 8 * GB, 31 * GB]) {
      expect(processSizing(limit).mainHeapMb).toBeLessThanOrEqual(Math.floor((limit / MB) * 0.65));
    }
  });

  it('keeps the pool tiers that were already tuned', () => {
    expect(processSizing(512 * MB)).toMatchObject({ poolSize: 1, poolMinSize: 0 });
    expect(processSizing(2 * GB)).toMatchObject({ poolSize: 2, poolMinSize: 0 });
    expect(processSizing(8 * GB)).toMatchObject({ poolSize: 3, poolMinSize: 1 });
    expect(processSizing(GB).workerHeapMb).toBe(WORKER_HEAP_MB);
  });

  it('never returns a heap too small for Node to run', () => {
    // A pathologically small limit must still yield a usable ceiling rather than 0 or a negative.
    for (const limit of [128 * MB, 192 * MB, 256 * MB]) {
      expect(processSizing(limit).mainHeapMb).toBeGreaterThanOrEqual(128);
    }
  });

  it('grows monotonically with the limit', () => {
    const limits = [512 * MB, 768 * MB, GB, 2 * GB, 4 * GB, 8 * GB];
    const heaps = limits.map((l) => processSizing(l).mainHeapMb);
    expect([...heaps].sort((a, b) => a - b)).toEqual(heaps);
  });
});
