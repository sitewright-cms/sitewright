import { describe, expect, it } from 'vitest';
import { deepMerge } from '../src/repo/merge.js';

describe('deepMerge', () => {
  it('merges nested objects, preserving sibling keys the patch omits', () => {
    const base = { identity: { name: 'Acme' }, website: { mainNav: '<nav/>', footer: '<old/>' } };
    const patch = { website: { footer: '<new/>' } };
    expect(deepMerge(base, patch)).toEqual({
      identity: { name: 'Acme' },
      website: { mainNav: '<nav/>', footer: '<new/>' },
    });
  });

  it('does not mutate either input', () => {
    const base = { a: { b: 1 } };
    const patch = { a: { c: 2 } };
    const out = deepMerge(base, patch) as { a: Record<string, number> };
    expect(base).toEqual({ a: { b: 1 } });
    expect(patch).toEqual({ a: { c: 2 } });
    expect(out.a).toEqual({ b: 1, c: 2 });
  });

  it('replaces arrays wholesale rather than merging positionally', () => {
    const base = { locales: ['en', 'de', 'es'] };
    const patch = { locales: ['en', 'fr'] };
    expect(deepMerge(base, patch)).toEqual({ locales: ['en', 'fr'] });
  });

  it('replaces a scalar with an object and an object with a scalar', () => {
    expect(deepMerge({ x: 1 }, { x: { y: 2 } })).toEqual({ x: { y: 2 } });
    expect(deepMerge({ x: { y: 2 } }, { x: 1 })).toEqual({ x: 1 });
  });

  it('ignores an undefined patch value (keeps the base) but writes null', () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: undefined })).toEqual({ a: 1, b: 2 });
    expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: null });
  });

  it('when base is not a plain object, patch wins (undefined keeps base)', () => {
    expect(deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(deepMerge('x', { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge(['x'], { a: 1 })).toEqual({ a: 1 });
  });

  it('is prototype-pollution safe against a crafted patch', () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"safe":1}');
    const out = deepMerge({ safe: 0 }, patch) as Record<string, unknown>;
    expect(out.safe).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('throws a RangeError when a matching-key patch nests past the depth cap', () => {
    // base + patch share a deeply-nested key path, so recursion actually descends past the cap.
    let base: Record<string, unknown> = { leaf: 1 };
    let patch: Record<string, unknown> = { leaf: 2 };
    for (let i = 0; i < 40; i++) {
      base = { n: base };
      patch = { n: patch };
    }
    expect(() => deepMerge(base, patch)).toThrow(RangeError);
    // A shallow patch is unaffected.
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  });

  it('does not descend into an inherited base key when patching', () => {
    const patch = { hasOwnProperty: 'shadowed' };
    const out = deepMerge({}, patch) as Record<string, unknown>;
    expect(out.hasOwnProperty).toBe('shadowed');
    // The real Object.prototype method is untouched for other objects.
    expect(typeof ({} as object).hasOwnProperty).toBe('function');
  });
});
