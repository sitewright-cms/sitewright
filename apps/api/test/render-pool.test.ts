import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { RenderPool, RenderUnavailableError } from '../src/render/render-pool.js';

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

  it('times out a stuck render, then the respawned worker still serves', async () => {
    pool = new RenderPool({ size: 1, workerPath, renderTimeoutMs: 100 });
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
