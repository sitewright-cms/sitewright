import { describe, expect, it } from 'vitest';
import { BuildEncodeGate, type EncodeMemorySnapshot } from '../src/publish/build-encode-gate.js';

const MB = 1024 * 1024;
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('BuildEncodeGate — build encodes admitted from free memory', () => {
  it('★ always lets each build run ONE encode, even with no memory free (never slower than before)', async () => {
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
});
