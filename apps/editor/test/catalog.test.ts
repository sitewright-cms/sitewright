import { describe, it, expect } from 'vitest';
import { ANIMATION_EFFECTS } from '@sitewright/blocks';
import { LIBRARY_SECTIONS } from '../src/views/library/catalog';

describe('Library catalog', () => {
  it('keeps the inlined AOS list in sync with @sitewright/blocks (no drift)', () => {
    // catalog.ts inlines the effect names to avoid pulling the blocks barrel (and the
    // 1865-icon set) into the main bundle; this guards them against drifting apart.
    const aos = LIBRARY_SECTIONS.find((s) => s.category === 'aos')!;
    expect(aos.items.map((i) => i.name)).toEqual([...ANIMATION_EFFECTS]);
  });

  it('icons + brand sections are lazy; DaisyUI ships a broad component set', () => {
    const icons = LIBRARY_SECTIONS.find((s) => s.category === 'icons')!;
    const brand = LIBRARY_SECTIONS.find((s) => s.category === 'brand')!;
    const daisy = LIBRARY_SECTIONS.find((s) => s.category === 'daisyui')!;
    expect(icons.lazy).toBe('icons');
    expect(brand.lazy).toBe('brand');
    expect(daisy.items.length).toBeGreaterThanOrEqual(45); // ~full DaisyUI library
  });
});
