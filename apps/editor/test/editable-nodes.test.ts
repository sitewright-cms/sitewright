import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import { collectEditableNodes } from '../src/lib/editable-nodes';

const tree: PageNode = {
  id: 'root',
  type: 'Section',
  children: [
    { id: 'a', type: 'Heading', props: { text: 'Locked' } },
    {
      id: 'b',
      type: 'Grid',
      children: [
        { id: 'c', type: 'RichText', editable: true, props: { text: 'one' } },
        { id: 'd', type: 'Card', children: [{ id: 'e', type: 'RichText', editable: true, props: { text: 'deep' } }] },
      ],
    },
    { id: 'f', type: 'RichText', editable: true, props: { text: 'three' } },
  ],
};

describe('collectEditableNodes', () => {
  it('returns every editable node in document order', () => {
    expect(collectEditableNodes(tree).map((n) => n.id)).toEqual(['c', 'e', 'f']);
  });

  it('returns an empty list when nothing is editable', () => {
    expect(collectEditableNodes({ id: 'r', type: 'Section', children: [{ id: 'x', type: 'Heading' }] })).toEqual([]);
  });

  it('includes the root itself when the root is editable', () => {
    expect(collectEditableNodes({ id: 'r', type: 'RichText', editable: true }).map((n) => n.id)).toEqual(['r']);
  });
});
