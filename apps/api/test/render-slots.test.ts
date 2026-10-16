import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSlotPool, RenderQueueBusyError } from '../src/render/render-slots.js';

/**
 * The shared headless-render slot pool. A refused wait must come back as a TYPED, retryable
 * "busy" (the route answers 503 + retry-after), and a caller that gives up must leave the queue —
 * otherwise an abandoned audit keeps a seat and the next caller times out behind a ghost.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** A slot holder the test releases by hand. */
function holder() {
  let done!: () => void;
  const gate = new Promise<void>((r) => (done = r));
  return { gate, done };
}

describe('createSlotPool', () => {
  it('runs up to `max` at once and queues the rest in arrival order', async () => {
    const pool = createSlotPool({ max: 2, acquireTimeoutMs: 1000 });
    const a = holder();
    const b = holder();
    const order: string[] = [];
    const pa = pool.run(async () => {
      await a.gate;
      order.push('a');
    });
    const pb = pool.run(async () => {
      await b.gate;
      order.push('b');
    });
    const pc = pool.run(async () => {
      order.push('c');
    });
    await Promise.resolve();
    expect(pool.active).toBe(2);
    expect(pool.waiting).toBe(1);
    a.done();
    await pa;
    await pc; // c takes a's freed slot
    b.done();
    await pb;
    expect(order).toEqual(['a', 'c', 'b']);
    expect(pool.active).toBe(0);
    expect(pool.waiting).toBe(0);
  });

  it('releases the slot when the work throws', async () => {
    const pool = createSlotPool({ max: 1, acquireTimeoutMs: 1000 });
    await expect(pool.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(pool.active).toBe(0);
    await expect(pool.run(async () => 'next')).resolves.toBe('next');
  });

  it('a wait that outlasts the budget rejects with a typed, retryable RenderQueueBusyError', async () => {
    vi.useFakeTimers();
    const pool = createSlotPool({ max: 1, acquireTimeoutMs: 12_000, retryAfterSeconds: 15 });
    const h = holder();
    const held = pool.run(() => h.gate);
    const waiting = pool.run(async () => 'never');
    const caught = waiting.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(12_000);
    const err = await caught;
    expect(err).toBeInstanceOf(RenderQueueBusyError);
    const busy = err as RenderQueueBusyError;
    // The app's error handler reads these off the error: 503 + retry-after, flagged transient.
    expect(busy.statusCode).toBe(503);
    expect(busy.retryable).toBe(true);
    expect(busy.retryAfterSeconds).toBe(15);
    expect(busy.message).toMatch(/busy/);
    expect(busy.message).toMatch(/12s/);
    expect(pool.waiting).toBe(0); // the timed-out waiter left the queue
    h.done();
    await held;
    expect(pool.active).toBe(0);
  });

  it('defaults the retry-after hint when none is configured', () => {
    expect(new RenderQueueBusyError(3000).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a waiter whose caller aborts leaves the queue at once and never takes a slot', async () => {
    const pool = createSlotPool({ max: 1, acquireTimeoutMs: 60_000 });
    const h = holder();
    const held = pool.run(() => h.gate);
    const ac = new AbortController();
    const ran = vi.fn(async () => 'ran');
    const waiting = pool.run(ran, { signal: ac.signal });
    await Promise.resolve();
    expect(pool.waiting).toBe(1);
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.waiting).toBe(0);
    h.done();
    await held;
    expect(ran).not.toHaveBeenCalled();
    expect(pool.active).toBe(0); // the abandoned waiter did not inherit the freed slot
  });

  it('an already-aborted signal is refused before it queues or takes a free slot', async () => {
    const pool = createSlotPool({ max: 1, acquireTimeoutMs: 1000 });
    const ac = new AbortController();
    ac.abort(new Error('gone'));
    const ran = vi.fn(async () => 'ran');
    await expect(pool.run(ran, { signal: ac.signal })).rejects.toThrow('gone');
    expect(ran).not.toHaveBeenCalled();
    expect(pool.active).toBe(0);
  });

  it('an abort AFTER the slot was granted does not disturb the slot accounting', async () => {
    const pool = createSlotPool({ max: 1, acquireTimeoutMs: 1000 });
    const ac = new AbortController();
    const h = holder();
    const run = pool.run(() => h.gate, { signal: ac.signal });
    await Promise.resolve();
    ac.abort(); // the work owns its own abort handling; the pool only cared while queued
    h.done();
    await run;
    expect(pool.active).toBe(0);
    expect(pool.waiting).toBe(0);
  });

  it('acquire/release can be driven directly (the screenshot loop holds a slot per viewport)', async () => {
    const pool = createSlotPool({ max: 1, acquireTimeoutMs: 1000 });
    await pool.acquire();
    expect(pool.active).toBe(1);
    pool.release();
    expect(pool.active).toBe(0);
  });
});
