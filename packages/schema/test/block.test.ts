import { describe, it, expect } from 'vitest';
import { PageNodeSchema } from '../src/block.js';

describe('PageNodeSchema', () => {
  it('parses a minimal block', () => {
    const node = PageNodeSchema.parse({ id: 'a', type: 'RichText' });
    expect(node.type).toBe('RichText');
  });

  it('parses a deeply nested tree', () => {
    const tree = {
      id: 'root',
      type: 'Section',
      children: [
        { id: 'h', type: 'Hero', props: { title: 'Hi' } },
        { id: 'g', type: 'Grid', children: [{ id: 'c1', type: 'Card' }] },
      ],
    };
    const parsed = PageNodeSchema.parse(tree);
    expect(parsed.children?.[1]?.children?.[0]?.type).toBe('Card');
  });

  it('applies the binding mode default of "single"', () => {
    const node = PageNodeSchema.parse({
      id: 'x',
      type: 'Card',
      binding: { dataset: 'products' },
    });
    expect(node.binding?.mode).toBe('single');
  });

  it('accepts a partialRef and a locked flag', () => {
    const node = PageNodeSchema.parse({
      id: 'h',
      type: 'Slot',
      partialRef: 'site-header',
      locked: true,
    });
    expect(node.partialRef).toBe('site-header');
    expect(node.locked).toBe(true);
  });

  it('rejects an empty type', () => {
    expect(() => PageNodeSchema.parse({ id: 'a', type: '' })).toThrow();
  });

  it('rejects a node without an id', () => {
    expect(() => PageNodeSchema.parse({ type: 'Card' })).toThrow();
  });
});
