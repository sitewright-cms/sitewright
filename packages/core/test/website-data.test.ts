import { describe, it, expect } from 'vitest';
import { setWebsiteDataLeaf } from '../src/website-data.js';

describe('setWebsiteDataLeaf', () => {
  it('sets a top-level leaf without mutating the input', () => {
    const before = { a: '1' };
    const after = setWebsiteDataLeaf(before, 'footerImage', '/footer.png');
    expect(after).toEqual({ a: '1', footerImage: '/footer.png' });
    expect(before).toEqual({ a: '1' }); // unchanged
  });
  it('creates intermediate objects for a nested path (immutably)', () => {
    const before = { hero: { title: 'T' } };
    const after = setWebsiteDataLeaf(before, 'hero.bg', '/bg.jpg');
    expect(after).toEqual({ hero: { title: 'T', bg: '/bg.jpg' } });
    expect(before).toEqual({ hero: { title: 'T' } }); // input untouched, nested object copied
    expect((after.hero as object) === (before.hero as object)).toBe(false);
  });
  it('creates the whole chain when absent / from undefined', () => {
    expect(setWebsiteDataLeaf(undefined, 'a.b.c', 'x')).toEqual({ a: { b: { c: 'x' } } });
    expect(setWebsiteDataLeaf({}, 'k', 'v')).toEqual({ k: 'v' });
  });
  it('overwrites a non-object value mid-path with a fresh object so the leaf can be set', () => {
    expect(setWebsiteDataLeaf({ a: 'scalar' }, 'a.b', 'v')).toEqual({ a: { b: 'v' } });
  });
  it('is a no-op (shallow copy) for proto / empty path segments', () => {
    expect(setWebsiteDataLeaf({ a: '1' }, '__proto__', 'x')).toEqual({ a: '1' });
    expect(setWebsiteDataLeaf({ a: '1' }, 'a.__proto__.b', 'x')).toEqual({ a: '1' });
    expect(setWebsiteDataLeaf({ a: '1' }, 'a..b', 'x')).toEqual({ a: '1' });
    expect(Object.prototype.hasOwnProperty.call(setWebsiteDataLeaf({}, '__proto__', 'x'), '__proto__')).toBe(false);
  });
});
