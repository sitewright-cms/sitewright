import { describe, it, expect } from 'vitest';
import type { PageNode, SitewrightPartial } from '@sitewright/schema';
import { PartialResolutionError, findNode, resolvePartials } from '../src/index.js';

function partialsMap(...partials: SitewrightPartial[]): Map<string, SitewrightPartial> {
  return new Map(partials.map((p) => [p.id, p]));
}

describe('resolvePartials', () => {
  it('replaces a partialRef with the partial subtree, preserving the host id', () => {
    const partials = partialsMap({
      id: 'header',
      name: 'Header',
      root: { id: 'h-root', type: 'Header', children: [{ id: 'h-logo', type: 'Logo' }] },
    });
    const tree: PageNode = {
      id: 'root',
      type: 'Section',
      children: [
        { id: 'host', type: 'Slot', partialRef: 'header' },
        { id: 'x', type: 'RichText' },
      ],
    };

    const resolved = resolvePartials(tree, partials);
    const host = resolved.children?.[0];
    expect(host?.id).toBe('host'); // host id preserved
    expect(host?.type).toBe('Header'); // expanded from the partial
    expect(host?.partialRef).toBeUndefined();
    expect(host?.children?.[0]?.id).toBe('h-logo');
  });

  it('expands partials that reference other partials', () => {
    const partials = partialsMap(
      { id: 'brand', name: 'Brand', root: { id: 'brand-root', type: 'Logo' } },
      {
        id: 'header',
        name: 'Header',
        root: {
          id: 'h-root',
          type: 'Header',
          children: [{ id: 'h-brand', type: 'Slot', partialRef: 'brand' }],
        },
      },
    );
    const tree: PageNode = { id: 'host', type: 'Slot', partialRef: 'header' };

    const resolved = resolvePartials(tree, partials);
    expect(resolved.type).toBe('Header');
    expect(findNode(resolved, 'h-brand')?.type).toBe('Logo');
  });

  it('returns the same reference when there are no partials to expand', () => {
    const tree: PageNode = {
      id: 'root',
      type: 'Section',
      children: [{ id: 'a', type: 'Hero' }],
    };
    expect(resolvePartials(tree, partialsMap())).toBe(tree);
  });

  it('throws for an unknown partial', () => {
    const tree: PageNode = { id: 'host', type: 'Slot', partialRef: 'missing' };
    expect(() => resolvePartials(tree, partialsMap())).toThrow(PartialResolutionError);
  });

  it('throws on a reference cycle', () => {
    const partials = partialsMap({
      id: 'loop',
      name: 'Loop',
      root: { id: 'loop-root', type: 'Box', partialRef: 'loop' },
    });
    const tree: PageNode = { id: 'host', type: 'Slot', partialRef: 'loop' };
    expect(() => resolvePartials(tree, partials)).toThrow(/cycle/);
  });

  it('throws when expansion exceeds maxDepth', () => {
    const deep: PageNode = {
      id: 'root',
      type: 'A',
      children: [{ id: 'c1', type: 'B', children: [{ id: 'c2', type: 'C' }] }],
    };
    expect(() => resolvePartials(deep, partialsMap(), { maxDepth: 2 })).toThrow(
      PartialResolutionError,
    );
  });
});
