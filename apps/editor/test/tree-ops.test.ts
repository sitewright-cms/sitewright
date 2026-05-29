import { describe, expect, it } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import {
  appendChild,
  findNode,
  governingBinding,
  insertChild,
  isDescendant,
  moveNode,
  moveWithinParent,
  parentInfo,
  removeNode,
  setProps,
  updateNode,
} from '../src/lib/tree-ops';

// A small fixed tree:
//   root(Section)
//     a(Heading)
//     b(Grid)
//       b1(Card)
//       b2(Card)
function tree(): PageNode {
  return {
    id: 'root',
    type: 'Section',
    children: [
      { id: 'a', type: 'Heading', props: { text: 'A' } },
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

describe('findNode', () => {
  it('finds nodes at any depth, and undefined when absent', () => {
    expect(findNode(tree(), 'root')?.type).toBe('Section');
    expect(findNode(tree(), 'b2')?.id).toBe('b2');
    expect(findNode(tree(), 'nope')).toBeUndefined();
  });
});

describe('immutability', () => {
  it('does not mutate the input tree', () => {
    const root = tree();
    const snapshot = JSON.stringify(root);
    setProps(root, 'a', { text: 'changed' });
    removeNode(root, 'b1');
    appendChild(root, 'b', { id: 'z', type: 'Card' });
    expect(JSON.stringify(root)).toBe(snapshot);
  });
});

describe('updateNode / setProps', () => {
  it('replaces the targeted node', () => {
    const next = updateNode(tree(), 'a', (n) => ({ ...n, type: 'RichText' }));
    expect(findNode(next, 'a')?.type).toBe('RichText');
  });

  it('merges props', () => {
    const next = setProps(tree(), 'a', { level: 3 });
    expect(findNode(next, 'a')?.props).toEqual({ text: 'A', level: 3 });
  });
});

describe('removeNode', () => {
  it('removes a nested node and its subtree', () => {
    const next = removeNode(tree(), 'b1');
    expect(findNode(next, 'b1')).toBeUndefined();
    expect(findNode(next, 'b2')?.id).toBe('b2');
  });

  it('refuses to remove the root (returns it unchanged)', () => {
    const root = tree();
    expect(removeNode(root, 'root')).toEqual(root);
  });
});

describe('insertChild / appendChild', () => {
  it('appends a child to the end', () => {
    const next = appendChild(tree(), 'b', { id: 'b3', type: 'Card' });
    expect(findNode(next, 'b')?.children?.map((c) => c.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('inserts a child at an index, clamping out-of-range indices', () => {
    const next = insertChild(tree(), 'b', 1, { id: 'bx', type: 'Card' });
    expect(findNode(next, 'b')?.children?.map((c) => c.id)).toEqual(['b1', 'bx', 'b2']);
    const clamped = insertChild(tree(), 'b', 99, { id: 'by', type: 'Card' });
    expect(clamped.children?.find((c) => c.id === 'b')?.children?.at(-1)?.id).toBe('by');
  });
});

describe('moveWithinParent', () => {
  it('moves a node up and down among its siblings', () => {
    const down = moveWithinParent(tree(), 'b1', 'down');
    expect(findNode(down, 'b')?.children?.map((c) => c.id)).toEqual(['b2', 'b1']);
    const up = moveWithinParent(down, 'b1', 'up');
    expect(findNode(up, 'b')?.children?.map((c) => c.id)).toEqual(['b1', 'b2']);
  });

  it('is a no-op at the boundaries', () => {
    const root = tree();
    expect(moveWithinParent(root, 'b1', 'up')).toEqual(root);
    expect(moveWithinParent(root, 'b2', 'down')).toEqual(root);
  });
});

describe('isDescendant', () => {
  it('detects ancestry (inclusive of self)', () => {
    const root = tree();
    expect(isDescendant(root, 'b', 'b1')).toBe(true);
    expect(isDescendant(root, 'b', 'b')).toBe(true);
    expect(isDescendant(root, 'b', 'a')).toBe(false);
    expect(isDescendant(root, 'ghost', 'a')).toBe(false);
  });
});

describe('governingBinding', () => {
  // root(Section) > grid(Grid, list-bound to posts) > head(Heading)
  function bound(): PageNode {
    return {
      id: 'root',
      type: 'Section',
      children: [
        {
          id: 'grid',
          type: 'Grid',
          binding: { dataset: 'posts', mode: 'list' },
          children: [{ id: 'head', type: 'Heading' }],
        },
      ],
    };
  }

  it('returns a node’s own binding', () => {
    expect(governingBinding(bound(), 'grid')?.dataset).toBe('posts');
  });

  it('inherits the nearest ancestor binding for an unbound descendant', () => {
    expect(governingBinding(bound(), 'head')?.dataset).toBe('posts');
  });

  it('returns undefined when nothing in the ancestry is bound', () => {
    expect(governingBinding(tree(), 'b1')).toBeUndefined();
  });
});

describe('parentInfo', () => {
  it('reports the parent id and index of a node', () => {
    expect(parentInfo(tree(), 'b2')).toEqual({ parentId: 'b', index: 1 });
    expect(parentInfo(tree(), 'a')).toEqual({ parentId: 'root', index: 0 });
  });

  it('returns undefined for the root and unknown nodes', () => {
    expect(parentInfo(tree(), 'root')).toBeUndefined();
    expect(parentInfo(tree(), 'ghost')).toBeUndefined();
  });
});

describe('moveNode (reparent)', () => {
  it('moves a node under a new parent at an index', () => {
    const next = moveNode(tree(), 'a', 'b', 0);
    expect(findNode(next, 'b')?.children?.map((c) => c.id)).toEqual(['a', 'b1', 'b2']);
    expect(next.children?.some((c) => c.id === 'a')).toBe(false);
  });

  it('refuses to move a node into itself or its own descendant (cycle guard)', () => {
    const root = tree();
    expect(moveNode(root, 'b', 'b1', 0)).toEqual(root); // into descendant
    expect(moveNode(root, 'b', 'b', 0)).toEqual(root); // into self
  });

  it('refuses to move the root', () => {
    const root = tree();
    expect(moveNode(root, 'root', 'b', 0)).toEqual(root);
  });

  it('is a no-op for an unknown node', () => {
    const root = tree();
    expect(moveNode(root, 'ghost', 'b', 0)).toEqual(root);
  });
});
