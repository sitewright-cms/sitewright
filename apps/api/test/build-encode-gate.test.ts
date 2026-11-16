import { describe, expect, it } from 'vitest';
import { BuildEncodeGate, type BuildEncodeCount, type EncodeMemorySnapshot } from '../src/publish/build-encode-gate.js';

const MB = 1024 * 1024;
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('BuildEncodeGate — build encodes admitted from free memory', () => {
  it('★ every build still encodes with no memory free — it never stalls', async () => {
    const gate = new BuildEncodeGate(8, async () => ({ availableBytes: 0, usedBytes: 700 * MB, reservedBytes: 0 }), undefined, 10);
    const a = { running: 0 };
    const b = { running: 0 };
    const order: string[] = [];
    await Promise.all([
      gate.run(a, 64 * MB, async () => void order.push('a')),
      gate.run(b, 64 * MB, async () => void order.push('b')),
    ]);
    expect(order.sort()).toEqual(['a', 'b']);
  });

  it('★★ with no memory free, ONE encode runs instance-wide — not one per build', async () => {
    // The guarantee used to be per build: ten builds at once ran ten 24MP encodes with no memory check,
    // which is what OOM-killed a 1.5 GiB container under several agents' load.
    let running = 0;
    let peak = 0;
    const gate = new BuildEncodeGate(8, async () => ({ availableBytes: 0, usedBytes: 1200 * MB, reservedBytes: 0 }), undefined, 5);
    const builds = Array.from({ length: 6 }, () => ({ running: 0 }));
    await Promise.all(
      builds.flatMap((build) =>
        Array.from({ length: 2 }, () =>
          gate.run(build, 100 * MB, async () => {
            running += 1;
            peak = Math.max(peak, running);
            await tick();
            running -= 1;
          }),
        ),
      ),
    );
    expect(peak).toBe(1);
    expect(builds.every((b) => b.running === 0)).toBe(true);
  });

  it('★ never runs more than the ceiling, a build’s first encode included', async () => {
    let running = 0;
    let peak = 0;
    const gate = new BuildEncodeGate(2, async () => ({ availableBytes: 4000 * MB, usedBytes: 100 * MB, reservedBytes: 0 }), undefined, 5);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        gate.run({ running: 0 }, 10 * MB, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('a build with nothing running gets the next slot ahead of a build that is already encoding', async () => {
    const gate = new BuildEncodeGate(1, async () => ({ availableBytes: 4000 * MB, usedBytes: 100 * MB, reservedBytes: 0 }), undefined, 1_000);
    const big = { running: 0 };
    const small = { running: 0 };
    const order: string[] = [];
    const first = deferred();
    const jobs = [gate.run(big, 10 * MB, () => first.promise.then(() => void order.push('big-1')))];
    await tick();
    jobs.push(gate.run(big, 10 * MB, async () => void order.push('big-2')));
    jobs.push(gate.run(big, 10 * MB, async () => void order.push('big-3')));
    await tick();
    jobs.push(gate.run(small, 10 * MB, async () => void order.push('small')));
    await tick();
    first.resolve();
    await Promise.all(jobs);
    // `big` holds the only slot when `small` arrives; when it frees, `small` is next, not big's queue.
    expect(order.slice(0, 2)).toEqual(['big-1', 'small']);
    expect(order).toHaveLength(4);
  });

  it('★ a build asking for many encodes AT ONCE still counts once — it cannot outvote a smaller build', async () => {
    // A build starts `encodeConcurrency` encodes in the same tick, so every one of them sees "nothing
    // running". Counted per call, they all went first and took the slots ahead of a build that waited.
    const gate = new BuildEncodeGate(1, async () => ({ availableBytes: 4000 * MB, usedBytes: 100 * MB, reservedBytes: 0 }), undefined, 1_000);
    const holder = deferred();
    const order: string[] = [];
    const held = gate.run({ running: 0 }, 10 * MB, () => holder.promise.then(() => void order.push('held')));
    await tick();
    const big: BuildEncodeCount = { running: 0 };
    const jobs = Array.from({ length: 4 }, (_, i) => gate.run(big, 10 * MB, async () => void order.push(`big-${i}`)));
    await tick();
    const small: BuildEncodeCount = { running: 0 };
    jobs.push(gate.run(small, 10 * MB, async () => void order.push('small')));
    await tick();
    holder.resolve();
    await Promise.all([held, ...jobs]);
    // big queued first, so it goes first — ONCE; then small, which waited before big's other encodes.
    expect(order.slice(0, 3)).toEqual(['held', 'big-0', 'small']);
    expect(order).toHaveLength(6);
    expect(big.waiting ?? 0).toBe(0);
    expect(small.waiting ?? 0).toBe(0);
  });

  it('a build stops going first the moment one of its encodes starts — the next waiting build is next', async () => {
    const gate = new BuildEncodeGate(2, async () => ({ availableBytes: 4000 * MB, usedBytes: 100 * MB, reservedBytes: 0 }), undefined, 1_000);
    const [h1, h2] = [deferred(), deferred()];
    const order: string[] = [];
    const holders = [gate.run({ running: 0 }, 10 * MB, () => h1.promise), gate.run({ running: 0 }, 10 * MB, () => h2.promise)];
    await tick();
    const x = { running: 0 };
    const y = { running: 0 };
    const xJobs = [0, 1].map((i) => gate.run(x, 10 * MB, async () => void order.push(`x-${i}`)));
    await tick();
    const yJob = gate.run(y, 10 * MB, async () => void order.push('y'));
    await tick();
    h1.resolve(); // one slot: x goes first…
    await tick(20);
    h2.resolve(); // …and the next slot is y's, not x's second encode
    await Promise.all([...holders, ...xJobs, yJob]);
    expect(order).toEqual(['x-0', 'y', 'x-1']);
  });

  it('runs more of a build at once while memory holds them, up to the ceiling', async () => {
    let running = 0;
    let peak = 0;
    const gate = new BuildEncodeGate(3, async () => ({ availableBytes: 1000 * MB, usedBytes: 100 * MB, reservedBytes: 0 }), undefined, 10);
    const build = { running: 0 };
    await Promise.all(
      Array.from({ length: 10 }, () =>
        gate.run(build, 10 * MB, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(build.running).toBe(0);
  });

  it('★ counts encodes already running against free memory, before the kernel sees them', async () => {
    // 100MB free and every encode wants 40MB: the kernel still reports the same usage, so the gate must
    // subtract what it has admitted itself, or all of them would fit "in the same" 100MB.
    let running = 0;
    let peak = 0;
    const gate = new BuildEncodeGate(10, async () => ({ availableBytes: 100 * MB, usedBytes: 500 * MB, reservedBytes: 0 }), undefined, 10);
    const build = { running: 0 };
    await Promise.all(
      Array.from({ length: 6 }, () =>
        gate.run(build, 40 * MB, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick(10);
          running -= 1;
        }),
      ),
    );
    // One always runs; a second fits beside it (100 − 40 ≥ 40); a third would not (100 − 80 < 40).
    expect(peak).toBe(3 - 1);
  });

  it('a waiting encode starts when a running one finishes, and the counts survive a failed encode', async () => {
    let snap: EncodeMemorySnapshot = { availableBytes: 0, usedBytes: 0, reservedBytes: 0 };
    const gate = new BuildEncodeGate(4, async () => snap, undefined, 1_000);
    const build = { running: 0 };
    const first = deferred();
    const one = gate.run(build, 10 * MB, () => first.promise.then(() => Promise.reject(new Error('corrupt image'))));
    let secondRan = false;
    const two = gate.run(build, 10 * MB, async () => void (secondRan = true));
    await tick(20);
    expect(secondRan).toBe(false); // no memory, and this build already has one running
    snap = { availableBytes: 500 * MB, usedBytes: 0, reservedBytes: 0 };
    first.resolve(); // the first fails — and its slot is still handed back
    await expect(one).rejects.toThrow('corrupt image');
    await two;
    expect(secondRan).toBe(true);
    expect(build.running).toBe(0);
  });

  it('books each admitted encode with the shared ledger for exactly as long as it runs', async () => {
    const booked: number[] = [];
    let held = 0;
    const gate = new BuildEncodeGate(
      2,
      async () => undefined,
      (bytes) => {
        booked.push(bytes);
        held += bytes;
        return { release: () => void (held -= bytes) };
      },
    );
    await gate.run({ running: 0 }, 32 * MB, async () => expect(held).toBe(32 * MB));
    expect(booked).toEqual([32 * MB]);
    expect(held).toBe(0);
  });

  describe('runIfFree — the single-page preview borrowing room that is free right now', () => {
    it('runs at once when the ceiling and free memory allow, booked like any other encode', async () => {
      let held = 0;
      const gate = new BuildEncodeGate(2, async () => ({ availableBytes: 500 * MB, usedBytes: 0, reservedBytes: 0 }), (bytes) => {
        held += bytes;
        return { release: () => void (held -= bytes) };
      });
      const out = await gate.runIfFree(20 * MB, async () => {
        expect(held).toBe(20 * MB);
        return 'encoded';
      });
      expect(out).toEqual({ value: 'encoded' });
      expect(held).toBe(0);
    });

    it('★ runs NOTHING and says so when the ceiling is taken — it never waits, and gets no guaranteed one', async () => {
      const gate = new BuildEncodeGate(1, async () => undefined, undefined, 10);
      const busy = deferred();
      const build = gate.run({ running: 0 }, 10 * MB, () => busy.promise);
      let ran = false;
      expect(await gate.runIfFree(10 * MB, async () => void (ran = true))).toBeUndefined();
      expect(ran).toBe(false);
      busy.resolve();
      await build;
      expect(await gate.runIfFree(10 * MB, async () => 1)).toEqual({ value: 1 });
    });

    it('yields to a build that is waiting with nothing running, though a slot and memory are free', async () => {
      // Memory never holds the build's encode and the one unchecked encode is taken, so the build waits
      // at the head of the queue; the preview must not take the free slot from it.
      let snap: EncodeMemorySnapshot = { availableBytes: 50 * MB, usedBytes: 900 * MB, reservedBytes: 0 };
      const gate = new BuildEncodeGate(3, async () => snap, undefined, 1_000);
      const holder = deferred();
      const first = gate.run({ running: 0 }, 200 * MB, () => holder.promise); // the unchecked one
      await tick();
      const starved: BuildEncodeCount = { running: 0 };
      let starvedRan = false;
      const waiting = gate.run(starved, 200 * MB, async () => void (starvedRan = true));
      await tick();
      expect(starved.waiting).toBe(1);
      expect(await gate.runIfFree(10 * MB, async () => 'preview')).toBeUndefined();
      snap = { availableBytes: 2000 * MB, usedBytes: 100 * MB, reservedBytes: 0 };
      holder.resolve();
      await Promise.all([first, waiting]);
      expect(starvedRan).toBe(true);
      expect(await gate.runIfFree(10 * MB, async () => 'preview')).toEqual({ value: 'preview' });
    });

    it('runs nothing when free memory does not hold it, counting the encodes already admitted', async () => {
      const gate = new BuildEncodeGate(8, async () => ({ availableBytes: 100 * MB, usedBytes: 500 * MB, reservedBytes: 0 }), undefined, 10);
      const busy = deferred();
      const first = gate.runIfFree(70 * MB, () => busy.promise);
      await tick();
      // 100MB free, 70 of it already taken by the first: a second 40MB encode does not fit.
      expect(await gate.runIfFree(40 * MB, async () => 'x')).toBeUndefined();
      busy.resolve();
      await first;
      expect(await gate.runIfFree(40 * MB, async () => 'x')).toEqual({ value: 'x' });
    });

    it('★ concurrent callers can never all see the one free slot and start together', async () => {
      const gate = new BuildEncodeGate(1, async () => ({ availableBytes: 500 * MB, usedBytes: 0, reservedBytes: 0 }), undefined, 10);
      let running = 0;
      let peak = 0;
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          gate.runIfFree(10 * MB, async () => {
            running += 1;
            peak = Math.max(peak, running);
            await tick();
            running -= 1;
          }),
        ),
      );
      expect(peak).toBe(1);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('freed() resolves when an encode finishes, well before the poll interval', async () => {
      const gate = new BuildEncodeGate(1, async () => undefined, undefined, 60_000);
      const busy = deferred();
      const job = gate.run({ running: 0 }, 10 * MB, () => busy.promise);
      let woke = false;
      const waiting = gate.freed().then(() => void (woke = true));
      await tick();
      expect(woke).toBe(false);
      busy.resolve();
      await job;
      await waiting;
      expect(woke).toBe(true);
    });
  });
});
