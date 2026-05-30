import { describe, it, expect } from 'vitest';
import { relativeRoot } from '../src/routes.js';

describe('relativeRoot', () => {
  it('returns an empty prefix for the home page (no slug)', () => {
    expect(relativeRoot(undefined)).toBe('');
    expect(relativeRoot('')).toBe('');
  });

  it('returns one level up per slug segment', () => {
    expect(relativeRoot('about')).toBe('../');
    expect(relativeRoot('our-vehicles')).toBe('../');
    expect(relativeRoot('blog/post-1')).toBe('../../');
    expect(relativeRoot('a/b/c')).toBe('../../../');
  });
});
