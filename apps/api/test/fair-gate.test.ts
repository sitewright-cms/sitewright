import { describe, it, expect } from 'vitest';
import { FairGate, GateFullError, TenantShareError } from '../src/runtime/fair-gate.js';

/**
 * The gate that keeps one project from eating an instance-wide limit.
 *
 * Two failure modes drive these tests. The first is the one the gate exists for: a burst from one
 * project starving a neighbour. The second is subtler and is what a hand-rolled version actually got
 * wrong in production — a refusal path that skipped the release, leaking a fairness counter until
 * the project was permanently locked out of the route. Every refusal here is therefore followed by a
 * drain and an assertion that the gate came back to EXACTLY zero.
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Let queued microtasks run so handoffs settle before we assert. */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('FairGate', () => {
  it('runs straight through while slots are free', async () => {
    const gate = new FairGate({ label: 'jobs', limit: 2, queue: 4 });
    expect(await gate.run('a', async () => 'done')).toBe('done');
    expect(gate.active, 'the slot is returned').toBe(0);
    expect(gate.activeFor('a')).toBe(0);
  });

  it('queues past the limit and hands the slot straight on', async () => {
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 4 });
    const first = deferred();
    const order: string[] = [];

    const running = gate.run('a', async () => {
      order.push('first');
      await first.promise;
    });
    await settle();
    const queued = gate.run('a', async () => {
      order.push('second');
    });
    await settle();

    expect(gate.active, 'one slot, one holder').toBe(1);
    expect(gate.queued).toBe(1);
    expect(order, 'the second job has NOT started').toEqual(['first']);

    first.resolve();
    await running;
    await queued;
    expect(order).toEqual(['first', 'second']);
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it('serves one project FIFO — a single tenant sees the old behaviour exactly', async () => {
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 8 });
    const hold = deferred();
    const order: string[] = [];
    const all: Array<Promise<unknown>> = [gate.run('a', async () => void (await hold.promise))];
    await settle();
    for (const tag of ['1', '2', '3']) {
      all.push(
        gate.run('a', async () => {
          order.push(tag);
        }),
      );
      await settle();
    }
    hold.resolve();
    await Promise.all(all);
    expect(order, 'no reordering when there is nobody to be fair to').toEqual(['1', '2', '3']);
  });

  it("lets a neighbour's first job overtake a burst", async () => {
    // The whole point: `a` has the slot and three more queued; `b` arrives last holding nothing.
    // The freed slot must go to `b`, not to the front of a's queue.
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 8 });
    const hold = deferred();
    const order: string[] = [];

    const all: Array<Promise<unknown>> = [gate.run('a', async () => void (await hold.promise))];
    await settle();
    for (const tag of ['a1', 'a2', 'a3']) {
      all.push(
        gate.run('a', async () => {
          order.push(tag);
        }),
      );
      await settle();
    }
    all.push(
      gate.run('b', async () => {
        order.push('b1');
      }),
    );
    await settle();

    hold.resolve();
    await Promise.all(all);
    expect(order[0], "the neighbour is served first despite queueing last").toBe('b1');
    expect(order.slice(1), "a's own jobs keep their order among themselves").toEqual(['a1', 'a2', 'a3']);
  });

  it('alternates between two projects with equal backlogs', async () => {
    // The property the round-robin tie-break buys. Ranking on running jobs alone cannot see the
    // difference here — at a limit of one, everybody holds zero at handoff time — so an earlier
    // version drained all of `a` before starting `b`, which is the starvation this gate exists to
    // prevent, merely slower.
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 16 });
    const hold = deferred();
    const order: string[] = [];
    const all: Array<Promise<unknown>> = [gate.run('a', async () => void (await hold.promise))];
    await settle();
    for (let i = 0; i < 3; i += 1) {
      all.push(
        gate.run('a', async () => {
          order.push('a');
        }),
      );
      await settle();
    }
    for (let i = 0; i < 3; i += 1) {
      all.push(
        gate.run('b', async () => {
          order.push('b');
        }),
      );
      await settle();
    }
    hold.resolve();
    await Promise.all(all);
    expect(order.join(''), 'neither project waits for the other to finish').toBe('bababa');
  });

  it('keeps queue places free so a newcomer can always get in', async () => {
    // `a` tries to fill an 8-deep queue; `queuePerTenant` stops it at 6 and `b` still finds room.
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 8, queuePerTenant: 6 });
    const hold = deferred();
    const running = gate.run('a', async () => void (await hold.promise));
    await settle();

    const queuedByA: Array<Promise<unknown>> = [];
    for (let i = 0; i < 6; i += 1) {
      queuedByA.push(gate.run('a', async () => {}));
      await settle();
    }
    expect(gate.queuedFor('a')).toBe(6);
    await expect(gate.run('a', async () => {}), 'a is at its queue bound').rejects.toBeInstanceOf(TenantShareError);

    const order: string[] = [];
    const byB = gate.run('b', async () => {
      order.push('b');
    });
    await settle();
    expect(gate.queuedFor('b'), 'the reserved places were there for b').toBe(1);

    hold.resolve();
    await Promise.all([running, ...queuedByA, byB]);
    expect(order[0], 'and b is scheduled first').toBe('b');
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
    expect(gate.queuedFor('a')).toBe(0);
  });

  it('sheds with GateFullError once slots AND queue are full', async () => {
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 2 });
    const hold = deferred();
    const all: Array<Promise<unknown>> = [gate.run('a', async () => void (await hold.promise))];
    await settle();
    all.push(gate.run('b', async () => {}));
    await settle();
    all.push(gate.run('c', async () => {}));
    await settle();

    await expect(gate.run('d', async () => {})).rejects.toBeInstanceOf(GateFullError);
    hold.resolve();
    await Promise.all(all);
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it('refuses a project already at maxInFlightPerTenant instead of queueing it', async () => {
    const gate = new FairGate({ label: 'imports', limit: 2, queue: 4, maxInFlightPerTenant: 1 });
    const hold = deferred();
    const running = gate.run('a', async () => void (await hold.promise));
    await settle();

    await expect(gate.run('a', async () => {}), 'a already has one in flight').rejects.toBeInstanceOf(
      TenantShareError,
    );
    // A DIFFERENT project is unaffected — the bound is per tenant, not a second global limit.
    await gate.run('b', async () => {});

    hold.resolve();
    await running;
    await gate.run('a', async () => {}); // freed again
    expect(gate.active).toBe(0);
  });

  it('★ does not leak a share when a refusal happens — the lockout regression', async () => {
    // The hand-rolled version took the share, THEN threw on a full queue, and the throw skipped the
    // release. With a share of one, a single "too many in progress" refusal locked that project out
    // of the route for the life of the process. Refuse it repeatedly, drain, and it must still work.
    const gate = new FairGate({ label: 'imports', limit: 1, queue: 1, maxInFlightPerTenant: 1 });
    const hold = deferred();
    const running = gate.run('a', async () => void (await hold.promise));
    await settle();
    const queuedByB = gate.run('b', async () => {});
    await settle();

    for (let i = 0; i < 5; i += 1) {
      // c is refused for a FULL GATE, never having held anything.
      await expect(gate.run('c', async () => {})).rejects.toBeInstanceOf(GateFullError);
      // a is refused for its own share while it still holds one.
      await expect(gate.run('a', async () => {})).rejects.toBeInstanceOf(TenantShareError);
    }

    hold.resolve();
    await Promise.all([running, queuedByB]);

    expect(gate.active, 'no slot was lost to a refusal').toBe(0);
    expect(gate.queued).toBe(0);
    for (const t of ['a', 'b', 'c']) {
      expect(gate.activeFor(t), `${t} holds nothing`).toBe(0);
      expect(gate.queuedFor(t), `${t} awaits nothing`).toBe(0);
    }
    // The proof that matters: every refused project can still be served.
    await gate.run('a', async () => {});
    await gate.run('c', async () => {});
  });

  it('releases the slot when the job THROWS', async () => {
    const gate = new FairGate({ label: 'jobs', limit: 1, queue: 2 });
    await expect(
      gate.run('a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(gate.active, 'a failed job must not strand its slot').toBe(0);
    expect(gate.activeFor('a')).toBe(0);
    await gate.run('a', async () => {}); // still usable
  });

  it('never admits more than `limit` at once, under a mixed burst', async () => {
    const gate = new FairGate({ label: 'jobs', limit: 3, queue: 64 });
    let live = 0;
    let peak = 0;
    const jobs = Array.from({ length: 40 }, (_, i) =>
      gate.run(`t${i % 4}`, async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live -= 1;
      }),
    );
    await Promise.all(jobs);
    expect(peak, 'the handoff must never over-admit').toBeLessThanOrEqual(3);
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it('floors the limit at one so a misconfigured gate cannot hang every caller', async () => {
    // A zero limit admits nobody while queued callers wait on a handoff that can never happen —
    // exactly how `SW_RENDER_WORKERS=0` once made every render hang forever.
    const gate = new FairGate({ label: 'jobs', limit: 0, queue: 2 });
    await expect(gate.run('a', async () => 'ran')).resolves.toBe('ran');
  });

  it('bounds queuePerTenant to the queue it belongs to', async () => {
    // A per-tenant bound ABOVE the global queue would be silently meaningless; below one, nobody
    // could ever queue. Both are clamped rather than trusted.
    const wide = new FairGate({ label: 'jobs', limit: 1, queue: 2, queuePerTenant: 99 });
    const hold = deferred();
    const all: Array<Promise<unknown>> = [wide.run('a', async () => void (await hold.promise))];
    await settle();
    all.push(wide.run('a', async () => {}));
    await settle();
    all.push(wide.run('a', async () => {}));
    await settle();
    await expect(wide.run('a', async () => {}), 'the global queue still binds').rejects.toBeInstanceOf(GateFullError);
    hold.resolve();
    await Promise.all(all);

    const narrow = new FairGate({ label: 'jobs', limit: 1, queue: 4, queuePerTenant: 0 });
    const hold2 = deferred();
    const running = narrow.run('a', async () => void (await hold2.promise));
    await settle();
    const queued = narrow.run('a', async () => {}); // at least one place, never zero
    await settle();
    expect(narrow.queued).toBe(1);
    hold2.resolve();
    await Promise.all([running, queued]);
  });
});
