import { describe, it, expect } from 'vitest';
import { ORDER_MAX, ORDER_STEP, nextOrderAfter, orderAfterSibling, orderBetween, reorderList, spacedOrders } from '../src/index.js';

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

  it('★ never returns a value EQUAL to a neighbour at the edges of the range', () => {
    // `last + Math.floor(x / 2) || null` parses as `(last + …) || null`, so a zero-width gap returned
    // `last` itself — a huge positive number, never falsy, so the null guard never fired. The moved item
    // then tied its predecessor and sorted by the id tie-break instead of where it was dropped: exactly
    // the silent mis-order the null exists to prevent.
    expect(orderBetween(ORDER_MAX - 1, undefined)).toBeNull();
    expect(orderBetween(ORDER_MAX - 2, undefined)).toBe(ORDER_MAX - 1);
    for (const last of [ORDER_MAX, ORDER_MAX - 1, ORDER_MAX - 2, ORDER_MAX - 3]) {
      const v = orderBetween(last, undefined);
      if (v !== null) expect(v, `appending after ${last}`).toBeGreaterThan(last);
    }
  });

  it('uses a valid 0 at the top of the range instead of forcing a needless re-space', () => {
    // The mirror branch had the opposite bug: `Math.floor(first / 2) || null` treats a perfectly good
    // 0 as falsy, so inserting above an item at 1 re-spaced the whole group for no reason.
    expect(orderBetween(undefined, 1)).toBe(0);
    expect(orderBetween(undefined, 2)).toBe(1);
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

describe('appending a new sibling after the ceiling was raised', () => {
  // ★ The regression both reviews ranked highest. `spacedOrders` starts at 65_536, so ONE re-space puts
  // every sibling above the old 100_000 clamp. A new page/entry appended with `min(100_000, max + 1)`
  // then lands in the MIDDLE of the group — silently, because 100_000 is still a valid order.
  it('appends ABOVE every existing sibling, including ones re-spaced past the old ceiling', () => {
    const respaced = spacedOrders(4); // [65536, 131072, 196608, 262144]
    const next = nextOrderAfter(respaced);
    expect(next).toBeGreaterThan(Math.max(...respaced));
    expect(next).toBeLessThanOrEqual(ORDER_MAX);
  });

  it('leaves room to keep appending, rather than pinning every later item to the ceiling', () => {
    let orders = spacedOrders(3);
    for (let i = 0; i < 20; i++) {
      const next = nextOrderAfter(orders);
      expect(next, `append #${i}`).toBeGreaterThan(Math.max(...orders));
      orders = [...orders, next];
    }
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('starts a fresh group away from 0, so the first "move to top" does not re-space', () => {
    const first = nextOrderAfter([]);
    expect(first).toBeGreaterThan(0);
    expect(orderBetween(undefined, first)).not.toBeNull();
  });

  it('returns the ceiling rather than overflowing when a group really is at the top', () => {
    expect(nextOrderAfter([ORDER_MAX])).toBe(ORDER_MAX);
    expect(nextOrderAfter([ORDER_MAX - 1])).toBe(ORDER_MAX);
  });
});

describe('orderAfterSibling (place a duplicate immediately after its source)', () => {
  const item = (id: string, order?: number) => ({ id, order });

  it('★ lands strictly BETWEEN the source and the next sibling', () => {
    const list = [item('a', 1000), item('b', 2000), item('c', 3000)];
    const at = orderAfterSibling(list, 'b');
    expect(at.order).toBeGreaterThan(2000);
    expect(at.order).toBeLessThan(3000);
    expect(at.respace).toEqual([]); // one write: the duplicate itself
  });

  it('lands after the LAST sibling when duplicating the last one', () => {
    const list = [item('a', 1000), item('b', 2000)];
    const at = orderAfterSibling(list, 'b');
    expect(at.order).toBeGreaterThan(2000);
    expect(at.respace).toEqual([]);
  });

  it('★ re-spaces when the source and its neighbour are ADJACENT, and still lands between them', () => {
    // The duplicate must not tie its source — a tie leaves the pair ordered by the id/title
    // tie-break, which is exactly the accidental placement this replaces.
    const list = [item('a', 1000), item('b', 1001), item('c', 5000)];
    const at = orderAfterSibling(list, 'a');
    expect(at.respace.length).toBeGreaterThan(0);
    const after = new Map(at.respace.map((r) => [r.id, r.order]));
    const srcOrder = after.get('a') ?? 1000;
    const nextOrder = after.get('b') ?? 1001;
    expect(at.order).toBeGreaterThan(srcOrder);
    expect(at.order).toBeLessThan(nextOrder);
  });

  it('handles a lone sibling and an unknown id', () => {
    expect(orderAfterSibling([item('a', 1000)], 'a').order).toBeGreaterThan(1000);
    expect(orderAfterSibling([item('a', 1000)], 'nope').order).toBeGreaterThan(1000); // appends
  });

  it('never returns an order equal to any sibling', () => {
    const list = [item('a', 1000), item('b', 2000), item('c', 3000)];
    const at = orderAfterSibling(list, 'a');
    const orders = new Map(list.map((x) => [x.id, x.order] as const));
    for (const r of at.respace) orders.set(r.id, r.order);
    expect([...orders.values()]).not.toContain(at.order);
  });
});
