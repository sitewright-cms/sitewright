import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import { COMPONENT_TYPES, usedComponentTypes, componentAssets } from '../src/components.js';

describe('component registry', () => {
  it('registers Carousel as an interactive component (Slide is a plain block)', () => {
    expect(COMPONENT_TYPES.has('Carousel')).toBe(true);
    expect(COMPONENT_TYPES.has('Slide')).toBe(false);
    expect(COMPONENT_TYPES.has('Section')).toBe(false);
  });

  it('collects distinct component types used in a tree (deduped, ignores non-components)', () => {
    const tree: PageNode = {
      id: 'r',
      type: 'Section',
      children: [
        { id: 'c1', type: 'Carousel', children: [{ id: 's', type: 'Slide' }] },
        { id: 'c2', type: 'Carousel' },
        { id: 'h', type: 'Heading' },
      ],
    };
    expect(usedComponentTypes(tree)).toEqual(['Carousel']); // deduped
    expect(usedComponentTypes({ id: 'x', type: 'Section' })).toEqual([]);
  });

  it('bundles CSS + JS for used components, empty when none', () => {
    const used = componentAssets(['Carousel']);
    expect(used.css).toContain('[data-sw-block="Carousel"]');
    expect(used.css).toContain('scroll-snap-type');
    expect(used.js).toContain('data-sw-component="carousel"');
    expect(used.js).toContain('data-sw-enhanced'); // progressive enhancement marker

    const none = componentAssets([]);
    expect(none.css).toBe('');
    expect(none.js).toBe('');
  });

  it('ignores unknown component types', () => {
    expect(componentAssets(['Nope', 'AlsoNope'])).toEqual({ css: '', js: '' });
  });
});
