import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import {
  bySiblingOrder,
  orderPagesByTree,
  canReorder,
  reorderWithinParent,
  orderedSiblings,
  nextSiblingOrder,
} from '../src/views/pages-order';

/** Minimal Page factory — only the fields the ordering logic reads. */
function page(id: string, over: Partial<Page> = {}): Page {
  return {
    id,
    path: over.path ?? id,
    title: over.title ?? id,
    root: { id: 'root', type: 'Section', children: [] },
    ...over,
  } as Page;
}

const DL = 'en';

// A home (root) + three top-level children under it, in a known order.
function tree(): Page[] {
  return [
    page('home', { path: '', title: 'Home' }),
    page('a', { parent: 'home', title: 'Alpha', order: 0 }),
    page('b', { parent: 'home', title: 'Beta', order: 1 }),
    page('c', { parent: 'home', title: 'Gamma', order: 2 }),
  ];
}

describe('bySiblingOrder', () => {
  it('pins Home first, then sorts by order, then title', () => {
    const pages = tree();
    const sorted = [...pages].sort((x, y) => bySiblingOrder(x, y, DL));
    expect(sorted.map((p) => p.id)).toEqual(['home', 'a', 'b', 'c']);
  });

  it('falls back to legacy nav.order when top-level order is absent', () => {
    const pages = [
      page('x', { parent: 'home', title: 'X', nav: { slots: ['header'], order: 5 } }),
      page('y', { parent: 'home', title: 'Y', nav: { slots: ['header'], order: 1 } }),
    ];
    const sorted = [...pages].sort((a, b) => bySiblingOrder(a, b, DL));
    expect(sorted.map((p) => p.id)).toEqual(['y', 'x']);
  });
});

describe('canReorder', () => {
  it('allows reordering distinct siblings of the same parent', () => {
    expect(canReorder(tree(), 'a', 'c', DL)).toBe(true);
  });
  it('refuses Home as source or target (pinned)', () => {
    expect(canReorder(tree(), 'home', 'a', DL)).toBe(false);
    expect(canReorder(tree(), 'a', 'home', DL)).toBe(false);
  });
  it('refuses a no-op (same id) and cross-parent moves', () => {
    expect(canReorder(tree(), 'a', 'a', DL)).toBe(false);
    const pages = [...tree(), page('deep', { parent: 'a', title: 'Deep' })];
    expect(canReorder(pages, 'deep', 'b', DL)).toBe(false); // different parents
  });
  it('refuses cross-locale moves (locale groups are separate)', () => {
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('a', { parent: 'home', title: 'A' }),
      page('a-de', { parent: 'home', title: 'A', locale: 'de' }),
    ];
    expect(canReorder(pages, 'a', 'a-de', DL)).toBe(false);
  });
});

describe('reorderWithinParent', () => {
  it('moves a page AFTER a later sibling', () => {
    // a,b,c → move a after c → b,c,a. The RESULTING SEQUENCE is the contract; the specific order
    // values are not (midpoint insertion writes one page, a re-space rewrites the group).
    const updated = reorderWithinParent(tree(), 'a', 'c', 'after', DL);
    const seq = tree()
      .map((p) => updated.find((u) => u.id === p.id) ?? p)
      .filter((p) => p.path !== '')
      .sort((x, y) => bySiblingOrder(x, y, DL))
      .map((p) => p.id);
    expect(seq).toEqual(['b', 'c', 'a']);
  });

  it('moves a page BEFORE an earlier sibling', () => {
    // a,b,c → move c before a → c,a,b
    const updated = reorderWithinParent(tree(), 'c', 'a', 'before', DL);
    const order = [...tree().filter((p) => p.path !== '')]
      .map((p) => ({ ...p, order: updated.find((u) => u.id === p.id)?.order ?? p.order }))
      .sort((x, y) => bySiblingOrder(x, y, DL))
      .map((p) => p.id);
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('normalizes a legacy group that has only nav.order (no top-level order)', () => {
    // Pre-PR pages carry nav.order on a different scale (10/20/30). Reordering should renumber
    // the whole group to a contiguous 0..n `order` so the new scale is self-consistent.
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('a', { parent: 'home', title: 'Alpha', nav: { slots: ['header'], order: 10 } }),
      page('b', { parent: 'home', title: 'Beta', nav: { slots: ['header'], order: 20 } }),
      page('c', { parent: 'home', title: 'Gamma', nav: { slots: ['header'], order: 30 } }),
    ];
    // Move c before a → c,a,b.
    const updated = reorderWithinParent(pages, 'c', 'a', 'before', DL);
    const merged = pages.map((p) => updated.find((u) => u.id === p.id) ?? p);
    const order = merged.filter((p) => p.path !== '').sort((x, y) => bySiblingOrder(x, y, DL)).map((p) => p.id);
    expect(order).toEqual(['c', 'a', 'b']);
    // Every moved sibling now carries a top-level `order` on one scale (no stale nav.order left ranking).
    for (const u of updated) expect(typeof u.order).toBe('number');
  });

  it('returns [] for an invalid move (Home / cross-parent / no-op)', () => {
    expect(reorderWithinParent(tree(), 'home', 'a', 'after', DL)).toEqual([]);
    expect(reorderWithinParent(tree(), 'a', 'a', 'before', DL)).toEqual([]);
  });

  it('does not mutate the input pages', () => {
    const pages = tree();
    const snapshot = JSON.stringify(pages);
    reorderWithinParent(pages, 'a', 'c', 'after', DL);
    expect(JSON.stringify(pages)).toBe(snapshot);
  });
});

describe('nextSiblingOrder (append a new page last under its parent)', () => {
  it('returns one past the current max order among siblings', () => {
    // home has children a,b,c at 0,1,2 → a new child appends at 3.
    expect(nextSiblingOrder(tree(), 'home', 'en', DL)).toBe(3);
  });

  it('is 0 when the parent has no siblings yet', () => {
    const pages = [page('home', { path: '', title: 'Home' })];
    expect(nextSiblingOrder(pages, 'home', 'en', DL)).toBe(0);
  });

  it('counts the effective order (legacy nav.order) when top-level order is absent', () => {
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('a', { parent: 'home', title: 'A', nav: { slots: ['header'], order: 5 } }),
    ];
    expect(nextSiblingOrder(pages, 'home', 'en', DL)).toBe(6);
  });

  it('scopes to the target parent — a deep child does not affect a home append', () => {
    const pages = [...tree(), page('deep', { parent: 'a', title: 'Deep', order: 9 })];
    expect(nextSiblingOrder(pages, 'home', 'en', DL)).toBe(3); // unaffected by deep@9 under 'a'
    expect(nextSiblingOrder(pages, 'a', 'en', DL)).toBe(10); // last under 'a'
  });

  it('scopes to the locale — a locale-only page appends within its own language group', () => {
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('a', { parent: 'home', title: 'A', order: 0 }),
      page('b', { parent: 'home', title: 'B', order: 1 }),
      page('x-de', { parent: 'home', title: 'X', locale: 'de', order: 0 }),
    ];
    // Appending an en page sees a,b (→2); appending a de page sees only x-de (→1).
    expect(nextSiblingOrder(pages, 'home', 'en', DL)).toBe(2);
    expect(nextSiblingOrder(pages, 'home', 'de', DL)).toBe(1);
  });

  it('never counts Home itself as a sibling', () => {
    // Home carries no order; a first real child still appends at 0, not after a phantom home.
    const pages = [page('home', { path: '', title: 'Home', order: 7 })];
    expect(nextSiblingOrder(pages, 'home', 'en', DL)).toBe(0);
  });

  it('caps at the schema max even if a sibling already sits there (tie is expected, then title order)', () => {
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('a', { parent: 'home', title: 'A', order: 100_000 }),
    ];
    expect(nextSiblingOrder(pages, 'home', 'en', DL)).toBe(100_000);
  });

  it('does not mutate the input pages', () => {
    const pages = tree();
    const snapshot = JSON.stringify(pages);
    nextSiblingOrder(pages, 'home', 'en', DL);
    expect(JSON.stringify(pages)).toBe(snapshot);
  });
});

describe('orderedSiblings', () => {
  it('returns the non-Home group in display order', () => {
    expect(orderedSiblings(tree(), 'b', DL).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('is empty for Home', () => {
    expect(orderedSiblings(tree(), 'home', DL)).toEqual([]);
  });
});

describe('orderPagesByTree', () => {
  it('keeps Home first and nests children under their parent', () => {
    const pages = [...tree(), page('a1', { parent: 'a', title: 'A-child' })];
    const rows = orderPagesByTree(pages, DL);
    expect(rows.map((r) => `${r.page.id}@${r.depth}`)).toEqual(['home@0', 'a@1', 'a1@2', 'b@1', 'c@1']);
  });
});

describe('link placeholders in the tree', () => {
  it('a slugless link placeholder is NOT treated as Home — it is a normal, reorderable node', () => {
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('nav-x', { path: '', title: 'Menu', kind: 'link', parent: 'home', order: 0 }),
      page('a', { parent: 'home', title: 'A', order: 1 }),
    ];
    expect(orderPagesByTree(pages, DL).find((r) => r.page.id === 'nav-x')!.depth).toBe(1);
    // Reorderable among its siblings (the real Home stays pinned, the link does not).
    expect(canReorder(pages, 'nav-x', 'a', DL)).toBe(true);
    expect(canReorder(pages, 'a', 'nav-x', DL)).toBe(true);
    expect(canReorder(pages, 'nav-x', 'home', DL)).toBe(false);
    expect(orderedSiblings(pages, 'nav-x', DL).map((p) => p.id)).toEqual(['nav-x', 'a']);
  });

  it('child pages nest under a link-placeholder parent', () => {
    const pages = [
      page('home', { path: '', title: 'Home' }),
      page('grp', { path: '', title: 'Group', kind: 'link', parent: 'home' }),
      page('child', { path: 'child', title: 'Child', parent: 'grp' }),
    ];
    const rows = orderPagesByTree(pages, DL);
    expect(rows.find((r) => r.page.id === 'grp')!.depth).toBe(1);
    expect(rows.find((r) => r.page.id === 'child')!.depth).toBe(2);
  });
});

describe('reorderWithinParent writes ONE page when there is room between neighbours', () => {
  /** a,b,c spaced far apart — the shape a re-spaced or freshly created group has. */
  const spaced = () => [
    page('home', { path: '', title: 'Home' }),
    page('a', { parent: 'home', title: 'A', order: 1000 }),
    page('b', { parent: 'home', title: 'B', order: 2000 }),
    page('c', { parent: 'home', title: 'C', order: 3000 }),
  ];
  const sequence = (pages: ReturnType<typeof spaced>, updated: ReturnType<typeof spaced>) =>
    pages
      .map((p) => updated.find((u) => u.id === p.id) ?? p)
      .filter((p) => p.path !== '')
      .sort((x, y) => bySiblingOrder(x, y, DL))
      .map((p) => p.id);

  it('★ moves a page with a SINGLE write instead of renumbering the group', () => {
    // The dense 0..n reindex this replaced rewrote every later sibling — ~700 writes for one drag in
    // an 831-page group, which does not fit inside the content route's rate limit.
    const updated = reorderWithinParent(spaced(), 'a', 'b', 'after', DL);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.id).toBe('a');
    expect(updated[0]!.order).toBeGreaterThan(2000);
    expect(updated[0]!.order).toBeLessThan(3000);
    expect(sequence(spaced(), updated)).toEqual(['b', 'a', 'c']);
  });

  it('moves to the END with a single write', () => {
    const updated = reorderWithinParent(spaced(), 'a', 'c', 'after', DL);
    expect(updated).toHaveLength(1);
    expect(sequence(spaced(), updated)).toEqual(['b', 'c', 'a']);
  });

  it('moves to the TOP with a single write when the first item is not pinned to 0', () => {
    const updated = reorderWithinParent(spaced(), 'c', 'a', 'before', DL);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.order).toBeLessThan(1000);
    expect(updated[0]!.order).toBeGreaterThanOrEqual(0);
    expect(sequence(spaced(), updated)).toEqual(['c', 'a', 'b']);
  });

  it('★ RE-SPACES the group when the destination gap has no integer left', () => {
    const tight = [
      page('home', { path: '', title: 'Home' }),
      page('a', { parent: 'home', title: 'A', order: 1000 }),
      page('b', { parent: 'home', title: 'B', order: 1001 }), // adjacent — nothing fits between
      page('c', { parent: 'home', title: 'C', order: 5000 }),
    ];
    const updated = reorderWithinParent(tight, 'c', 'b', 'before', DL);
    expect(updated.length).toBeGreaterThan(1); // the whole group, not a single write
    const seq = tight
      .map((p) => updated.find((u) => u.id === p.id) ?? p)
      .filter((p) => p.path !== '')
      .sort((x, y) => bySiblingOrder(x, y, DL))
      .map((p) => p.id);
    expect(seq).toEqual(['a', 'c', 'b']);
    // A re-space must leave room at BOTH ends, or the next move to the top re-spaces again.
    const orders = updated.map((u) => u.order!).sort((x, y) => x - y);
    expect(orders[0]).toBeGreaterThan(0);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('re-spaces a legacy group whose first item sits at 0, rather than emitting a negative order', () => {
    // `order: 0` has nothing below it. The old dense scheme created exactly this shape.
    const updated = reorderWithinParent(tree(), 'c', 'a', 'before', DL);
    expect(updated.length).toBeGreaterThan(1);
    for (const u of updated) expect(u.order).toBeGreaterThanOrEqual(0);
  });
});
