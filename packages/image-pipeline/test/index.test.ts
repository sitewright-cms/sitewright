import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('public API (index barrel)', () => {
  it('re-exports the store + thumbnail pipeline', () => {
    expect(typeof pkg.storeOriginal).toBe('function');
    expect(typeof pkg.generateThumbnail).toBe('function');
    expect(typeof pkg.thumbFileName).toBe('function');
    expect(pkg.THUMB_SIZES).toEqual({ sm: 500, md: 1000, lg: 1600, xl: 2400 });
  });
});
