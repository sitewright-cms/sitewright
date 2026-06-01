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
      editable: true,
    });
    expect(node.partialRef).toBe('site-header');
    expect(node.editable).toBe(true);
  });

  it('rejects an empty type', () => {
    expect(() => PageNodeSchema.parse({ id: 'a', type: '' })).toThrow();
  });

  it('rejects a node without an id', () => {
    expect(() => PageNodeSchema.parse({ type: 'Card' })).toThrow();
  });

  it('accepts Tailwind utility classes in className', () => {
    const node = PageNodeSchema.parse({
      id: 'a',
      type: 'Section',
      // arbitrary values, modifiers, opacity, and arbitrary props all occur in real usage
      className: 'flex md:grid grid-cols-[1fr_2fr] bg-brand/80 text-[#0a0a0a] hover:underline py-8',
    });
    expect(node.className).toContain('md:grid');
  });

  it('rejects className containing attribute-breakout characters', () => {
    for (const bad of ['"onload', "x'y", 'a<b', 'a>b', 'a{b}', 'a;b']) {
      expect(() => PageNodeSchema.parse({ id: 'a', type: 'Section', className: bad })).toThrow();
    }
  });

  it('rejects an over-long className', () => {
    expect(() =>
      PageNodeSchema.parse({ id: 'a', type: 'Section', className: 'x'.repeat(1001) }),
    ).toThrow();
  });
});
