import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { RenderPool, RenderUnavailableError } from '../src/render/render-pool.js';
import { sharedMemoryBudget } from '../src/runtime/memory-budget.js';

const workerPath = fileURLToPath(new URL('./fixtures/test-render-worker.mjs', import.meta.url));

let pool: RenderPool | undefined;
afterEach(async () => {
  if (pool) await pool.shutdown(50);
  pool = undefined;
});

describe('RenderPool', () => {
  it('renders a job in a worker', async () => {
    pool = new RenderPool({ size: 1, workerPath });
    expect(await pool.render('hi', {})).toBe('R:hi');
  });

  it('serves more concurrent jobs than workers via the queue', async () => {
    pool = new RenderPool({ size: 2, workerPath });
    const out = await Promise.all(['a', 'b', 'c', 'd'].map((s) => pool!.render(s, {})));
    expect(out).toEqual(['R:a', 'R:b', 'R:c', 'R:d']);
  });

  // `renderTimeoutMs` governs BOTH renders here, and the second one has to fork a brand-new worker and
  // load its module before it can reply — so this budget must cover process startup on a loaded CI runner,
  // not just the reply. At 100ms it was a coin flip and became the single most common CI failure. The
  // first render costs the full budget (`__SLEEP__` never replies, so the timeout is what ends it), so
  // keep it generous but not extravagant. Do NOT tighten this to "make the test fast".
  it('times out a stuck render, then the respawned worker still serves', async () => {
    pool = new RenderPool({ size: 1, workerPath, renderTimeoutMs: 2000 });
    await expect(pool.render('__SLEEP__', {})).rejects.toThrow(RenderUnavailableError);
    expect(await pool.render('after', {})).toBe('R:after');
  });

  it('rejects the in-flight job when a worker crashes, then respawns', async () => {
    pool = new RenderPool({ size: 1, workerPath });
    await expect(pool.render('__CRASH__', {})).rejects.toThrow(RenderUnavailableError);
    expect(await pool.render('ok', {})).toBe('R:ok');
  });

  it('recycles a worker after maxRendersPerWorker without dropping jobs', async () => {
    pool = new RenderPool({ size: 1, workerPath, maxRendersPerWorker: 2 });
    expect(await pool.render('1', {})).toBe('R:1');
    expect(await pool.render('2', {})).toBe('R:2'); // hits the recycle threshold
    expect(await pool.render('3', {})).toBe('R:3'); // a fresh worker serves it
  });

  it('rejects new work when the queue is full (bounds parent memory)', async () => {
    pool = new RenderPool({ size: 1, workerPath, maxQueueDepth: 1 });
    const inflight = pool.render('__SLEEP__', {}); // occupies the worker
    const queued = pool.render('q1', {}); // fills the queue (depth 1)
    await expect(pool.render('q2', {})).rejects.toThrow(RenderUnavailableError); // over the cap
    const ip = expect(inflight).rejects.toThrow(RenderUnavailableError);
    const qd = expect(queued).rejects.toThrow(RenderUnavailableError);
    await pool.shutdown(50);
    await ip;
    await qd;
    pool = undefined;
  });

  it('rejects queued + in-flight work on shutdown', async () => {
    pool = new RenderPool({ size: 1, workerPath });
    const inflight = pool.render('__SLEEP__', {}); // occupies the only worker
    const queued = pool.render('queued', {}); // waits in the queue
    // Attach the rejection handlers BEFORE shutdown rejects them (avoids a transient
    // unhandled-rejection while the handler isn't yet attached).
    const expectInflight = expect(inflight).rejects.toThrow(RenderUnavailableError);
    const expectQueued = expect(queued).rejects.toThrow(RenderUnavailableError);
    await pool.shutdown(50);
    await expectInflight;
    await expectQueued;
    pool = undefined; // already shut down
  });
});

describe('RenderPool — lazy spawning and idle retirement', () => {
  it('starts with NO workers: an instance that never renders pays nothing', () => {
    pool = new RenderPool({ size: 2, workerPath });
    expect(pool.workerCount).toBe(0);
  });

  it('spawns on the first render and REUSES that worker for later ones', async () => {
    pool = new RenderPool({ size: 2, workerPath });
    expect(await pool.render('a', {})).toBe('R:a');
    expect(pool.workerCount).toBe(1);
    expect(await pool.render('b', {})).toBe('R:b');
    expect(pool.workerCount, 'a sequential render must not grow the pool').toBe(1);
  });

  it('grows up to `size` under concurrency, and no further', async () => {
    pool = new RenderPool({ size: 2, workerPath });
    const out = await Promise.all(['a', 'b', 'c', 'd'].map((s) => pool!.render(s, {})));
    expect(out).toEqual(['R:a', 'R:b', 'R:c', 'R:d']);
    expect(pool.workerCount, '`size` is a ceiling — the rest queue').toBe(2);
  });

  it('pre-warms `minSize` workers for instances that want the latency instead', () => {
    pool = new RenderPool({ size: 3, minSize: 2, workerPath });
    expect(pool.workerCount).toBe(2);
  });

  it('retires a worker that has gone idle', async () => {
    pool = new RenderPool({ size: 2, workerPath, idleMs: 60 });
    await pool.render('a', {});
    expect(pool.workerCount).toBe(1);
    await new Promise((r) => setTimeout(r, 400));
    expect(pool.workerCount, 'an idle worker must give its memory back').toBe(0);
  });

  it('never retires below `minSize`, and stays serviceable afterwards', async () => {
    pool = new RenderPool({ size: 2, minSize: 1, workerPath, idleMs: 60 });
    await pool.render('a', {});
    await new Promise((r) => setTimeout(r, 400));
    expect(pool.workerCount, 'the warm floor is held').toBe(1);
    expect(await pool.render('b', {}), 'and the pool still renders').toBe('R:b');
  });

  it('re-spawns after retirement when work arrives again', async () => {
    pool = new RenderPool({ size: 2, workerPath, idleMs: 60 });
    await pool.render('a', {});
    await new Promise((r) => setTimeout(r, 400));
    expect(pool.workerCount).toBe(0);
    expect(await pool.render('b', {})).toBe('R:b');
    expect(pool.workerCount).toBe(1);
  });
});

describe('RenderPool — a zero ceiling must not hang', () => {
  it('still renders when constructed with size 0 instead of queueing forever', async () => {
    // Found by security review: with size 0 the lazy-spawn guard (`slots.length < size`) is never
    // true, so no worker is created — and a queued job has no timer, because timers are attached in
    // assign(). Every render would hang indefinitely rather than fail. A hang is worse than the
    // silent fallback this option was added to fix, so the ceiling is floored at 1.
    pool = new RenderPool({ size: 0, workerPath });
    expect(await pool.render('a', {})).toBe('R:a');
    expect(pool.workerCount).toBe(1);
  });

  it('still renders with a negative ceiling', async () => {
    pool = new RenderPool({ size: -3, workerPath });
    expect(await pool.render('a', {})).toBe('R:a');
  });
});

describe('RenderPool — workers are accounted for in the memory ledger', () => {
  it('reserves while a worker lives and gives it back when the worker dies', async () => {
    // The headless browser already reserves its footprint; a forked worker is the same shape of
    // long-lived allocation. Without this the ledger admits other work against memory a just-spawned
    // worker has taken, which is precisely the ramp-up window where it matters.
    const before = (await sharedMemoryBudget.snapshot()).reservedBytes;
    pool = new RenderPool({ size: 1, workerPath, memoryLimitMb: 64, idleMs: 60 });
    await pool.render('a', {});
    expect(pool.workerCount).toBe(1);

    const held = (await sharedMemoryBudget.snapshot()).reservedBytes;
    expect(held - before, 'the worker holds its declared ceiling').toBe(64 * 1024 * 1024);

    // Let it retire on idle — the reservation must go with the process.
    await new Promise((r) => setTimeout(r, 400));
    expect(pool.workerCount).toBe(0);
    const after = (await sharedMemoryBudget.snapshot()).reservedBytes;
    expect(after, 'a dead worker must not keep shrinking the budget').toBe(before);
  });

  it('releases on shutdown too, not only on idle retirement', async () => {
    const before = (await sharedMemoryBudget.snapshot()).reservedBytes;
    const p = new RenderPool({ size: 1, workerPath, memoryLimitMb: 64 });
    await p.render('a', {});
    expect((await sharedMemoryBudget.snapshot()).reservedBytes).toBeGreaterThan(before);
    await p.shutdown(50);
    // onExit fires per killed worker and releases there.
    await new Promise((r) => setTimeout(r, 200));
    expect((await sharedMemoryBudget.snapshot()).reservedBytes).toBe(before);
  });
});
