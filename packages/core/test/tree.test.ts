import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import {
  NodeNotFoundError,
  TreeOperationError,
  collectClassNames,
  extractClassNames,
  extractRegions,
  collectIds,
  findDuplicateIds,
  reIdTree,
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

  it('reIdTree deep-clones with fresh ids, preserving structure + props (fork-on-insert)', () => {
    let n = 0;
    const idGen = () => `new-${n++}`;
    const pattern: PageNode = {
      id: 'p',
      type: 'Section',
      props: { tone: 'primary' },
      className: 'py-8',
      children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }],
    };
    const a = reIdTree(pattern, idGen);
    const b = reIdTree(pattern, idGen); // a second insert → distinct ids, no collision

    // Fresh ids throughout, none shared with the source or each other.
    expect(collectIds(a)).toEqual(['new-0', 'new-1']);
    expect(collectIds(b)).toEqual(['new-2', 'new-3']);
    expect(findDuplicateIds({ id: 'r', type: 'S', children: [a, b] })).toEqual([]);
    // Structure, props, and className preserved.
    expect(a.type).toBe('Section');
    expect(a.props).toEqual({ tone: 'primary' });
    expect(a.className).toBe('py-8');
    expect(a.children?.[0]?.props).toEqual({ text: 'Hi' });
    // Immutable: the source is untouched.
    expect(pattern.id).toBe('p');
    expect(pattern.children?.[0]?.id).toBe('h');
  });

  it('collects className lists in document order, skipping nodes without one', () => {
    const tree: PageNode = {
      id: 'root',
      type: 'Section',
      className: 'flex gap-4',
      children: [
        { id: 'a', type: 'Hero' }, // no className
        { id: 'b', type: 'Card', className: 'rounded-lg' },
      ],
    };
    expect(collectClassNames(tree)).toEqual(['flex gap-4', 'rounded-lg']);
    expect(collectClassNames(sample())).toEqual([]); // none set
  });
});

describe('extractRegions (data-sw-* leaf directives)', () => {
  it('lists data-sw-text and data-sw-html regions with kinds', () => {
    const src =
      `<h1 data-sw-text="headline">Welcome</h1>` +
      `<p data-sw-text="tagline">A snappy tagline</p>` +
      `<section data-sw-html="intro"><p>Default intro</p></section>`;
    expect(extractRegions(src)).toEqual([
      { key: 'headline', default: 'Welcome', kind: 'text' },
      { key: 'tagline', default: 'A snappy tagline', kind: 'text' },
      { key: 'intro', default: '<p>Default intro</p>', kind: 'rich' },
    ]);
  });

  it('captures a data-sw-text default even when the attribute is not first', () => {
    expect(extractRegions('<h2 class="x" id="y" data-sw-text="t">Hello</h2>')).toEqual([
      { key: 't', default: 'Hello', kind: 'text' },
    ]);
  });

  it('recognizes single-quoted directive values and dedupes by key (first wins)', () => {
    expect(extractRegions(`<p data-sw-text='a'>One</p><span data-sw-text="a">Two</span>`)).toEqual([
      { key: 'a', default: 'One', kind: 'text' },
    ]);
  });

  it('recognizes a data-sw-href link region', () => {
    expect(extractRegions('<a data-sw-href="cta" href="/x">Go</a>')).toEqual([{ key: 'cta', default: '', kind: 'link' }]);
  });

  it('recognizes data-sw-src (image) and data-sw-bg (background) regions', () => {
    expect(extractRegions('<img data-sw-src="hero"><section data-sw-bg="band"></section>')).toEqual([
      { key: 'hero', default: '', kind: 'image' },
      { key: 'band', default: '', kind: 'bg' },
    ]);
  });

  it('returns nothing when there are no regions', () => {
    expect(extractRegions('<div class="x"><img src="/a.jpg"></div>')).toEqual([]);
  });
});

describe('extractClassNames (code-first / raw markup)', () => {
  it('pulls deduplicated tokens from double- and single-quoted class attributes', () => {
    const html = `<main class="grid gap-4"><h1 class='text-xl grid'>x</h1></main>`;
    expect(extractClassNames(html)).toEqual(['grid', 'gap-4', 'text-xl']);
  });

  it('strips Handlebars expressions so a dynamic class value leaks no half-token', () => {
    // `{{ theme }}` is removed; only the literal `px-4` survives as a candidate.
    expect(extractClassNames('<div class="{{ theme }} px-4">x</div>')).toEqual(['px-4']);
  });

  it('caps the candidate set (DoS guard against a synthetic class list)', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `c${i}`).join(' ');
    expect(extractClassNames(`<div class="${many}">x</div>`, 100)).toHaveLength(100);
  });

  it('returns nothing for markup with no class attributes', () => {
    expect(extractClassNames('<section><p>hi</p></section>')).toEqual([]);
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
