import { describe, it, expect } from 'vitest';
import { buildSrcset } from '../src/srcset.js';
import type { ImageVariant } from '../src/types.js';

const variants: ImageVariant[] = [
  { format: 'webp', width: 800, height: 450, path: 'h-800.webp' },
  { format: 'avif', width: 400, height: 225, path: 'h-400.avif' },
  { format: 'webp', width: 400, height: 225, path: 'h-400.webp' },
];

describe('buildSrcset', () => {
  it('builds a width-sorted srcset for one format', () => {
    expect(buildSrcset(variants, 'webp')).toBe('h-400.webp 400w, h-800.webp 800w');
  });

  it('applies a base path (with or without a trailing slash)', () => {
    expect(buildSrcset(variants, 'avif', '/media/')).toBe('/media/h-400.avif 400w');
    expect(buildSrcset(variants, 'avif', '/assets')).toBe('/assets/h-400.avif 400w');
  });

  it('returns an empty string when no variants match', () => {
    expect(buildSrcset([], 'webp')).toBe('');
  });
});
