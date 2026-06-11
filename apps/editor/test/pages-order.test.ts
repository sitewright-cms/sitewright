import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import {
  bySiblingOrder,
  orderPagesByTree,
  canReorder,
  reorderWithinParent,
  orderedSiblings,
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
  it('moves a page AFTER a later sibling and renumbers only what changed', () => {
    // a,b,c (0,1,2) → move a after c → b,c,a (0,1,2)
    const updated = reorderWithinParent(tree(), 'a', 'c', 'after', DL);
    const byId = new Map(updated.map((p) => [p.id, p.order]));
    // New ranks: b→0, c→1, a→2. b changed 1→0, c changed 2→1, a changed 0→2.
    expect(byId.get('b')).toBe(0);
    expect(byId.get('c')).toBe(1);
    expect(byId.get('a')).toBe(2);
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
    // Every moved sibling now carries a contiguous top-level order (no stale nav.order scale left ranking).
    expect(updated.find((p) => p.id === 'c')?.order).toBe(0);
    expect(updated.find((p) => p.id === 'a')?.order).toBe(1);
    expect(updated.find((p) => p.id === 'b')?.order).toBe(2);
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
