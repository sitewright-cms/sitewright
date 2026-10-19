import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { singleFlight, useSingleFlight } from '../src/lib/single-flight';

/** A run the test finishes when it chooses, counting how many are in flight at once. */
function gatedRuns() {
  const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  let inFlight = 0;
  let peak = 0;
  const run = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const settle = (fn: () => void) => () => {
          inFlight -= 1;
          fn();
        };
        pending.push({ resolve: settle(resolve), reject: (e) => settle(() => reject(e))() });
      }),
  );
  const finishNext = async (error?: unknown) => {
    const next = pending.shift()!;
    await act(async () => (error === undefined ? next.resolve() : next.reject(error)));
  };
  return { run, finishNext, peak: () => peak };
}

describe('singleFlight', () => {
  it('runs once for one request', async () => {
    const run = vi.fn(async () => {});
    const reload = singleFlight(run);
    await reload();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('★ collapses a burst into ONE trailing run, and never runs two at once', async () => {
    const g = gatedRuns();
    const reload = singleFlight(g.run);
    // A bulk delete of 450 files arrives as 450 events: the first starts a read, the rest arrive while it runs.
    const calls = Array.from({ length: 450 }, () => reload());
    expect(g.run).toHaveBeenCalledTimes(1);

    await g.finishNext();
    // The trailing read starts only after the first answered: it is what sees the final state.
    expect(g.run).toHaveBeenCalledTimes(2);
    await g.finishNext();
    await Promise.all(calls);

    expect(g.run).toHaveBeenCalledTimes(2);
    expect(g.peak()).toBe(1);
  });

  it('settles a mid-flight request only after the trailing run that covers it', async () => {
    const g = gatedRuns();
    const reload = singleFlight(g.run);
    void reload();
    let covered = false;
    void reload().then(() => (covered = true));

    await g.finishNext();
    expect(covered).toBe(false); // the first read was taken before this request's change existed
    await g.finishNext();
    expect(covered).toBe(true);
  });

  it('starts a fresh flight for a request after the last one ended', async () => {
    const run = vi.fn(async () => {});
    const reload = singleFlight(run);
    await reload();
    await reload();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a failed run still lets the trailing run happen, and the flight reports how the LAST run ended', async () => {
    const g = gatedRuns();
    const reload = singleFlight(g.run);
    const first = reload();
    const second = reload();

    await g.finishNext(new Error('offline'));
    expect(g.run).toHaveBeenCalledTimes(2); // the request that arrived mid-flight is not lost
    await g.finishNext();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects with the final run’s error when the last run fails', async () => {
    const reload = singleFlight(async () => {
      throw new Error('offline');
    });
    await expect(reload()).rejects.toThrow('offline');
    // The failure ends that flight; the next request starts a new one rather than waiting forever.
    await expect(reload()).rejects.toThrow('offline');
  });
});

describe('singleFlight — runs that misbehave', () => {
  it('★ a run that throws SYNCHRONOUSLY does not leave the flight stuck', async () => {
    const run = vi.fn((): Promise<void> => {
      throw new Error('bad state');
    });
    const reload = singleFlight(run);
    await expect(reload()).rejects.toThrow('bad state');
    // A stuck flight would hand back the old rejection and never call `run` again.
    await expect(reload()).rejects.toThrow('bad state');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a run that requests a reload itself joins its own flight instead of overlapping it', async () => {
    let inFlight = 0;
    let peak = 0;
    let reload: () => Promise<void> = async () => {};
    const run = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (run.mock.calls.length === 1) void reload(); // e.g. a run that notices it is already stale
      await Promise.resolve();
      inFlight -= 1;
    });
    reload = singleFlight(run);
    await reload();
    expect(run).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });
});

describe('useSingleFlight', () => {
  it('keeps one trigger across renders, and the trailing run calls the LATEST function', async () => {
    const g = gatedRuns();
    const later = vi.fn(async () => {});
    const { result, rerender } = renderHook(({ fn }) => useSingleFlight(fn), { initialProps: { fn: g.run } });
    const trigger = result.current;

    void trigger();
    void trigger();
    // The view re-renders mid-flight (new state, new closure) before the trailing run starts.
    rerender({ fn: later });
    expect(result.current).toBe(trigger);

    await g.finishNext();
    expect(g.run).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
  });
});
