import { describe, it, expect } from 'vitest';
import { dataPathOf, isSafeKey, dataLeafGet, dataLeafSet, mergeDefaults, isEmptyPageData, pageDataObject } from '../src/lib/page-data';

describe('dataPathOf / isSafeKey', () => {
  it('extracts the page.data path from a page.data.* key, else null (bare = top-level)', () => {
    expect(dataPathOf('page.data.article_title')).toBe('article_title');
    expect(dataPathOf('page.data.a.b')).toBe('a.b');
    expect(dataPathOf('plain_key')).toBeNull();
    expect(dataPathOf('data.article_title')).toBeNull(); // retired shorthand → no longer a nested path
  });

  it('rejects a prototype-pollution segment in ANY key form at the message boundary', () => {
    expect(isSafeKey('headline')).toBe(true);
    expect(isSafeKey('page.data.article_title')).toBe(true);
    expect(isSafeKey('__proto__')).toBe(false);
    expect(isSafeKey('page.data.__proto__')).toBe(false);
    expect(isSafeKey('page.data.a.constructor')).toBe(false);
    expect(isSafeKey('page.data.a..b')).toBe(false); // empty segment
    expect(isSafeKey('data.__proto__')).toBe(false); // retired shorthand still rejected (any dotted form)
    expect(isSafeKey('')).toBe(false);
  });
});

describe('dataLeafGet', () => {
  const data = { a: 'x', nested: { deep: 'y' }, n: 3, arr: ['z'] };
  it('reads a string leaf at a dotted path, else undefined', () => {
    expect(dataLeafGet(data, 'a')).toBe('x');
    expect(dataLeafGet(data, 'nested.deep')).toBe('y');
    expect(dataLeafGet(data, 'n')).toBeUndefined(); // non-string
    expect(dataLeafGet(data, 'missing')).toBeUndefined();
    expect(dataLeafGet(data, 'arr.0')).toBeUndefined(); // no array-index traversal
    expect(dataLeafGet(data, '__proto__')).toBeUndefined();
  });
});

describe('dataLeafSet', () => {
  it('sets a leaf immutably, creating intermediate objects', () => {
    const before = { keep: 'me' };
    const after = dataLeafSet(before, 'a.b', 'v');
    expect(after).toEqual({ keep: 'me', a: { b: 'v' } });
    expect(before).toEqual({ keep: 'me' }); // immutable — input untouched
    expect(after).not.toBe(before);
  });

  it('replaces an existing leaf without dropping siblings', () => {
    expect(dataLeafSet({ a: { b: '1', c: '2' } }, 'a.b', '9')).toEqual({ a: { b: '9', c: '2' } });
  });

  it('is a no-op for a prototype-pollution or empty segment', () => {
    const d = { a: '1' };
    expect(dataLeafSet(d, '__proto__', 'x')).toBe(d);
    expect(dataLeafSet(d, 'a.__proto__.y', 'x')).toBe(d);
    expect(dataLeafSet(d, 'a..b', 'x')).toBe(d);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined(); // Object.prototype intact
  });

  it('starts a fresh object when the root is not a plain object', () => {
    expect(dataLeafSet([], 'a', 'v')).toEqual({ a: 'v' });
  });
});

describe('mergeDefaults', () => {
  it('fills missing keys without clobbering existing ones (deep)', () => {
    const into = { title: 'Mine', meta: { keep: '1' } };
    const out = mergeDefaults(into, { title: 'Default', subtitle: 'Sub', meta: { keep: 'X', extra: '2' } });
    expect(out).toEqual({ title: 'Mine', subtitle: 'Sub', meta: { keep: '1', extra: '2' } });
    expect(into).toEqual({ title: 'Mine', meta: { keep: '1' } }); // immutable
    expect(out).not.toBe(into);
  });

  it('seeds defaults onto an empty object', () => {
    expect(mergeDefaults({}, { a: '1', b: '2' })).toEqual({ a: '1', b: '2' });
  });

  it('uses an OWN-property check (inherited names like toString are still seeded)', () => {
    expect(mergeDefaults({}, { toString: 'custom', valueOf: 'v' })).toEqual({ toString: 'custom', valueOf: 'v' });
  });

  it('skips prototype-pollution default keys and never pollutes Object.prototype', () => {
    const polluted = JSON.parse('{"__proto__":{"bad":"x"},"ok":"1"}');
    expect(mergeDefaults({}, polluted)).toEqual({ ok: '1' });
    expect(({} as Record<string, unknown>).bad).toBeUndefined();
  });

  it('preserves a non-object (array/scalar) root rather than clobbering it', () => {
    expect(mergeDefaults(['x'], { a: '1' })).toEqual(['x']);
    expect(mergeDefaults('scalar', { a: '1' })).toBe('scalar');
  });

  it('returns `into` unchanged when defaults is not an object', () => {
    expect(mergeDefaults({ a: '1' }, null)).toEqual({ a: '1' });
    expect(mergeDefaults({ a: '1' }, ['x'])).toEqual({ a: '1' });
  });
});

describe('isEmptyPageData', () => {
  it('treats absent/null/{}/[] as empty, a real value as non-empty', () => {
    expect(isEmptyPageData(null)).toBe(true);
    expect(isEmptyPageData({})).toBe(true);
    expect(isEmptyPageData([])).toBe(true);
    expect(isEmptyPageData({ a: '1' })).toBe(false);
    expect(isEmptyPageData('x')).toBe(false);
    expect(isEmptyPageData(0)).toBe(false);
  });
});

describe('pageDataObject (persist coercion — object-only store)', () => {
  it('returns a non-empty plain object as-is', () => {
    const obj = { a: '1', nested: { b: 2 } };
    expect(pageDataObject(obj)).toBe(obj);
  });
  it('omits an empty object, and any non-object root (array/scalar/null)', () => {
    expect(pageDataObject({})).toBeUndefined();
    expect(pageDataObject(null)).toBeUndefined();
    expect(pageDataObject(['a', 'b'])).toBeUndefined(); // arrays are valid as NESTED values, never as the root
    expect(pageDataObject('x')).toBeUndefined();
    expect(pageDataObject(0)).toBeUndefined();
    expect(pageDataObject(false)).toBeUndefined();
  });
});
