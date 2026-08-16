import { describe, it, expect } from 'vitest';
import { ORDER_MAX, ORDER_STEP, orderBetween, reorderList, spacedOrders } from '../src/index.js';

// Sibling order used to be a DENSE 0..n reindex: moving one page rewrote every page after it —
// ~700 writes for one drag in an 831-page group, past the route's own rate limit. Midpoint insertion
// makes the ordinary move a SINGLE write; these tests pin the arithmetic and, more importantly, the
// honest failure signal when a gap has no integer left in it.

describe('orderBetween', () => {
  it('returns the midpoint of two neighbours', () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(0, 10)).toBe(5);
  });

  it('floors to an integer (order is an integer field)', () => {
    const v = orderBetween(1000, 1003)!;
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(1000);
    expect(v).toBeLessThan(1003);
  });

  it('drops BELOW the first item when there is no `before` neighbour', () => {
    const v = orderBetween(undefined, 5000)!;
    expect(v).toBeLessThan(5000);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('appends ABOVE the last item when there is no `after` neighbour', () => {
    const v = orderBetween(5000, undefined)!;
    expect(v).toBeGreaterThan(5000);
    expect(v).toBeLessThanOrEqual(ORDER_MAX);
  });

  it('places the only item in an empty group without pinning it to a boundary', () => {
    const v = orderBetween(undefined, undefined)!;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(ORDER_MAX);
  });

  it('★ returns null when two neighbours are ADJACENT — the caller must re-space, not guess', () => {
    // The whole point of the null: silently returning 1000 again would collide and reorder the group
    // at random. A caller that gets null re-spaces the group instead.
    expect(orderBetween(1000, 1001)).toBeNull();
    expect(orderBetween(1000, 1000)).toBeNull();
    // Inverted input is a caller bug, not a gap — also null rather than a nonsense midpoint.
    expect(orderBetween(2000, 1000)).toBeNull();
  });

  it('returns null at the very bottom and the very top (no room outside the range)', () => {
    expect(orderBetween(undefined, 0)).toBeNull();
    expect(orderBetween(ORDER_MAX, undefined)).toBeNull();
  });

  it('survives repeated insertion at the SAME spot far longer than the old 100k ceiling allowed', () => {
    // With the old max of 100_000 and 831 siblings the gap was ~120 → ~6 subdivisions. At 2^31 the
    // same group starts ~2.5M apart, so the same spot absorbs 20+ moves before a re-space is needed.
    let lo = 0;
    const hi = Math.floor(ORDER_MAX / 831); // the initial gap in an 831-item group
    let inserts = 0;
    for (;;) {
      const mid = orderBetween(lo, hi);
      if (mid === null) break;
      lo = mid; // keep inserting immediately after the item we just placed
      inserts += 1;
    }
    expect(inserts).toBeGreaterThan(20);
  });
});

describe('spacedOrders', () => {
  it('spreads n items evenly across the range with room to insert between any pair', () => {
    const orders = spacedOrders(4);
    expect(orders).toHaveLength(4);
    expect(orders).toStrictEqual([...orders].sort((a, b) => a - b)); // ascending
    expect(new Set(orders).size).toBe(4); // no duplicates
    for (let i = 1; i < orders.length; i++) {
      expect(orderBetween(orders[i - 1]!, orders[i]!)).not.toBeNull();
    }
    expect(orders[0]).toBeGreaterThan(0); // room to insert BEFORE the first
    expect(orders.at(-1)).toBeLessThan(ORDER_MAX); // and AFTER the last
  });

  it('uses the standard step while the group is small, so values stay readable', () => {
    expect(spacedOrders(3)).toStrictEqual([ORDER_STEP, ORDER_STEP * 2, ORDER_STEP * 3]);
  });

  it('compresses the step for a group too large for the standard spacing', () => {
    const orders = spacedOrders(100_000);
    expect(orders).toHaveLength(100_000);
    expect(orders.at(-1)).toBeLessThanOrEqual(ORDER_MAX);
    expect(new Set(orders).size).toBe(100_000); // still distinct at the compressed step
  });

  it('handles the degenerate sizes', () => {
    expect(spacedOrders(0)).toStrictEqual([]);
    expect(spacedOrders(1)).toHaveLength(1);
  });
});

describe('reorderList', () => {
  const item = (id: string, order?: number) => ({ id, order });
  const spaced = () => [item('a', 1000), item('b', 2000), item('c', 3000)];

  /** The resulting sequence after applying the returned changes — the contract that matters. */
  const seq = (list: ReturnType<typeof spaced>, changed: ReturnType<typeof spaced>) =>
    list
      .map((x) => changed.find((c) => c.id === x.id) ?? x)
      .slice()
      .sort((p, q) => (p.order ?? Infinity) - (q.order ?? Infinity) || (p.id < q.id ? -1 : 1))
      .map((x) => x.id);

  it('★ writes ONE item when the destination gap has room', () => {
    const changed = reorderList(spaced(), 'a', 'b', 'after');
    expect(changed).toHaveLength(1);
    expect(changed[0]!.id).toBe('a');
    expect(seq(spaced(), changed)).toEqual(['b', 'a', 'c']);
  });

  it('moves to the very end and to the very top with one write', () => {
    expect(seq(spaced(), reorderList(spaced(), 'a', 'c', 'after'))).toEqual(['b', 'c', 'a']);
    expect(seq(spaced(), reorderList(spaced(), 'c', 'a', 'before'))).toEqual(['c', 'a', 'b']);
  });

  it('★ re-spaces the whole list when the gap has no integer left', () => {
    const tight = [item('a', 1000), item('b', 1001), item('c', 5000)];
    const changed = reorderList(tight, 'c', 'b', 'before');
    expect(changed.length).toBeGreaterThan(1);
    expect(seq(tight, changed)).toEqual(['a', 'c', 'b']);
    for (const c of changed) expect(c.order).toBeGreaterThan(0);
  });

  it('re-spaces a legacy dense list (0,1,2) rather than emitting a negative order', () => {
    const dense = [item('a', 0), item('b', 1), item('c', 2)];
    const changed = reorderList(dense, 'c', 'a', 'before');
    expect(seq(dense, changed)).toEqual(['c', 'a', 'b']);
    for (const c of changed) expect(c.order).toBeGreaterThanOrEqual(0);
  });

  it('treats an item with NO order as sorting last, and gives it one when moved', () => {
    const mixed = [item('a', 1000), item('b', 2000), item('c')];
    const changed = reorderList(mixed, 'c', 'a', 'after');
    expect(seq(mixed, changed)).toEqual(['a', 'c', 'b']);
  });

  it('returns [] for a no-op or an unknown id', () => {
    expect(reorderList(spaced(), 'a', 'a', 'after')).toEqual([]);
    expect(reorderList(spaced(), 'nope', 'a', 'after')).toEqual([]);
    expect(reorderList(spaced(), 'a', 'nope', 'after')).toEqual([]);
  });
});
