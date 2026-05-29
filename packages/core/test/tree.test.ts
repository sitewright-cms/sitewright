import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import {
  NodeNotFoundError,
  TreeOperationError,
  collectIds,
  findDuplicateIds,
  findNode,
  getAncestors,
  insertChild,
  moveNode,
  removeNode,
  replaceNode,
  updateNode,
  walk,
} from '../src/index.js';

function sample(): PageNode {
  return {
    id: 'root',
    type: 'Section',
    children: [
      { id: 'a', type: 'Hero' },
      {
        id: 'b',
        type: 'Grid',
        children: [
          { id: 'b1', type: 'Card' },
          { id: 'b2', type: 'Card' },
        ],
      },
    ],
  };
}

describe('walk / find / ancestors / ids', () => {
  it('visits nodes in pre-order', () => {
    const ids: string[] = [];
    walk(sample(), (n) => ids.push(n.id));
    expect(ids).toEqual(['root', 'a', 'b', 'b1', 'b2']);
  });

  it('finds a node or returns undefined', () => {
    expect(findNode(sample(), 'b1')?.type).toBe('Card');
    expect(findNode(sample(), 'nope')).toBeUndefined();
  });

  it('returns ancestors (root first), [] for root, undefined for missing', () => {
    expect(getAncestors(sample(), 'b1')?.map((n) => n.id)).toEqual(['root', 'b']);
    expect(getAncestors(sample(), 'root')).toEqual([]);
    expect(getAncestors(sample(), 'nope')).toBeUndefined();
  });

  it('collects ids and detects duplicates', () => {
    expect(collectIds(sample())).toEqual(['root', 'a', 'b', 'b1', 'b2']);
    expect(findDuplicateIds(sample())).toEqual([]);
    const dup: PageNode = {
      id: 'root',
      type: 'S',
      children: [
        { id: 'x', type: 'A' },
        { id: 'x', type: 'B' },
      ],
    };
    expect(findDuplicateIds(dup)).toEqual(['x']);
  });
});

describe('updateNode / replaceNode (immutable)', () => {
  it('returns a new tree and leaves the original untouched', () => {
    const tree = sample();
    const next = updateNode(tree, 'a', (n) => ({ ...n, type: 'Banner' }));
    expect(next).not.toBe(tree);
    expect(findNode(next, 'a')?.type).toBe('Banner');
    expect(tree.children?.[0]?.type).toBe('Hero'); // original unchanged
  });

  it('shares untouched subtrees by reference', () => {
    const tree = sample();
    const next = updateNode(tree, 'a', (n) => ({ ...n, type: 'Banner' }));
    expect(next.children?.[1]).toBe(tree.children?.[1]); // 'b' subtree shared
  });

  it('can update the root itself', () => {
    const next = updateNode(sample(), 'root', (n) => ({ ...n, type: 'Main' }));
    expect(next.type).toBe('Main');
  });

  it('throws NodeNotFoundError for a missing id', () => {
    expect(() => updateNode(sample(), 'nope', (n) => n)).toThrow(NodeNotFoundError);
  });

  it('replaceNode swaps the node', () => {
    const next = replaceNode(sample(), 'b1', { id: 'b1', type: 'Quote' });
    expect(findNode(next, 'b1')?.type).toBe('Quote');
  });
});

describe('removeNode (immutable)', () => {
  it('removes a node and preserves the original', () => {
    const tree = sample();
    const next = removeNode(tree, 'a');
    expect(next.children?.map((n) => n.id)).toEqual(['b']);
    expect(tree.children?.length).toBe(2); // original unchanged
  });

  it('throws when removing the root', () => {
    expect(() => removeNode(sample(), 'root')).toThrow(TreeOperationError);
  });

  it('throws NodeNotFoundError for a missing id', () => {
    expect(() => removeNode(sample(), 'nope')).toThrow(NodeNotFoundError);
  });
});

describe('insertChild (immutable)', () => {
  const node: PageNode = { id: 'new', type: 'CTA' };

  it('appends when no index is given', () => {
    const next = insertChild(sample(), 'b', node);
    expect(next.children?.[1]?.children?.map((n) => n.id)).toEqual(['b1', 'b2', 'new']);
  });

  it('inserts at an index', () => {
    const next = insertChild(sample(), 'b', node, 0);
    expect(next.children?.[1]?.children?.map((n) => n.id)).toEqual(['new', 'b1', 'b2']);
  });

  it('clamps an out-of-range index', () => {
    const next = insertChild(sample(), 'b', node, 99);
    expect(next.children?.[1]?.children?.map((n) => n.id)).toEqual(['b1', 'b2', 'new']);
  });

  it('creates a children array for a leaf node', () => {
    const next = insertChild(sample(), 'a', node);
    expect(findNode(next, 'a')?.children?.map((n) => n.id)).toEqual(['new']);
  });
});

describe('moveNode (immutable)', () => {
  it('moves a node under a new parent', () => {
    const next = moveNode(sample(), 'b1', 'a');
    expect(findNode(next, 'a')?.children?.map((n) => n.id)).toEqual(['b1']);
    expect(findNode(next, 'b')?.children?.map((n) => n.id)).toEqual(['b2']);
  });

  it('throws when moving a node into itself', () => {
    expect(() => moveNode(sample(), 'a', 'a')).toThrow(TreeOperationError);
  });

  it('throws when moving a node into its own subtree', () => {
    expect(() => moveNode(sample(), 'b', 'b1')).toThrow(TreeOperationError);
  });

  it('throws NodeNotFoundError for a missing source or target', () => {
    expect(() => moveNode(sample(), 'nope', 'a')).toThrow(NodeNotFoundError);
    expect(() => moveNode(sample(), 'a', 'nope')).toThrow(NodeNotFoundError);
  });
});
