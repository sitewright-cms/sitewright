import { describe, it, expect } from 'vitest';
import { SiteBuildSlots } from '../src/runtime/site-build-slots.js';
import { GateFullError, TenantShareError } from '../src/runtime/fair-gate.js';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** One slot held by a build the test releases, so everything after it queues. */
async function held(slots: SiteBuildSlots): Promise<{ release: () => void; done: Promise<unknown> }> {
  const holder = deferred();
  const done = slots.run('preview', 'holder', () => holder.promise);
  await tick();
  return { release: holder.resolve, done };
}

describe('SiteBuildSlots', () => {
  it('runs at most `limit` builds at once and hands each freed slot on', async () => {
    const slots = new SiteBuildSlots(2);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        slots.run('preview', `p${i}`, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect([slots.active, slots.waiting]).toEqual([0, 0]);
  });

  it('★ a waiting publish does not wait behind a queue of previews — the two alternate', async () => {
    // One slot and a stream of previews: a publish used to wait behind all of them (145 s median, measured).
    const slots = new SiteBuildSlots(1);
    const order: string[] = [];
    const h = await held(slots);
    const jobs = [
      slots.run('preview', 'a', async () => void order.push('prev-a')),
      slots.run('preview', 'b', async () => void order.push('prev-b')),
      slots.run('preview', 'c', async () => void order.push('prev-c')),
      slots.run('publish', 'x', async () => void order.push('pub-x')),
      slots.run('publish', 'y', async () => void order.push('pub-y')),
    ];
    h.release();
    await Promise.all([h.done, ...jobs]);
    // The publish goes first; then the lanes take turns, so previews are never starved either.
    expect(order).toEqual(['pub-x', 'prev-a', 'pub-y', 'prev-b', 'prev-c']);
  });

  it('★ explicit builds take turns between projects — one project cannot hog the line', async () => {
    const slots = new SiteBuildSlots(1);
    const order: string[] = [];
    const h = await held(slots);
    const jobs = [
      ...[1, 2, 3].map((i) => slots.run('publish', 'busy', async () => void order.push(`busy-${i}`))),
      slots.run('publish', 'other', async () => void order.push('other')),
    ];
    h.release();
    await Promise.all([h.done, ...jobs]);
    expect(order).toEqual(['busy-1', 'other', 'busy-2', 'busy-3']);
  });

  it('★ refuses a project that already has its share of explicit builds waiting (a retryable 503)', async () => {
    // A site zip needs only read access: without a cap one member could queue builds at the head of the line.
    const slots = new SiteBuildSlots(1, 1024, 2);
    const h = await held(slots);
    const queued = [slots.run('publish', 'p', async () => 1), slots.run('publish', 'p', async () => 2)];
    await expect(slots.run('publish', 'p', async () => 3)).rejects.toBeInstanceOf(TenantShareError);
    // Another project still gets in.
    const other = slots.run('publish', 'q', async () => 4);
    h.release();
    await Promise.all([h.done, ...queued, other]);
  });

  it('a failing build still hands its slot on', async () => {
    const slots = new SiteBuildSlots(1);
    const first = slots.run('publish', 'a', async () => {
      throw new Error('boom');
    });
    const second = slots.run('preview', 'b', async () => 'ran');
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ran');
    expect(slots.active).toBe(0);
  });

  it('refuses with the retryable 503 only past its backstop queue depth', async () => {
    const slots = new SiteBuildSlots(1, 2);
    const h = await held(slots);
    const queued = [slots.run('preview', 'a', async () => 1), slots.run('publish', 'b', async () => 2)];
    await expect(slots.run('preview', 'c', async () => 3)).rejects.toBeInstanceOf(GateFullError);
    h.release();
    await Promise.all([h.done, ...queued]);
  });
});
