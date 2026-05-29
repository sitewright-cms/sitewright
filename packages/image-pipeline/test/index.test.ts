import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('public API (index barrel)', () => {
  it('re-exports the optimizer and srcset builder', () => {
    expect(typeof pkg.optimizeImage).toBe('function');
    expect(typeof pkg.buildSrcset).toBe('function');
  });
});
