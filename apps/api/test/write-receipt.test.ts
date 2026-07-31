import { describe, it, expect } from 'vitest';
import { writeReceipt } from '../src/repo/write-receipt.js';

describe('writeReceipt', () => {
  it('names the row, sizes it, and lists only the top-level keys that actually differ', () => {
    const before = { id: 'settings', identity: { name: 'Acme' }, website: { footer: '<p>a</p>' } };
    const after = { id: 'settings', identity: { name: 'Acme' }, website: { footer: '<p>b</p>' } };
    const r = writeReceipt('settings', 'settings', before, after);
    expect(r.kind).toBe('settings');
    expect(r.id).toBe('settings');
    expect(r.created).toBe(false);
    expect(r.changed).toEqual(['website']); // identity is untouched and is NOT listed
    expect(r.bytes).toBe(Buffer.byteLength(JSON.stringify(after), 'utf8'));
  });

  it('reports an empty `changed` for a no-op write — the signal the full echo never gave', () => {
    const same = { id: 'p', title: 'A', data: { x: [1, 2] } };
    expect(writeReceipt('page', 'p', same, { ...same, data: { x: [1, 2] } }).changed).toEqual([]);
  });

  it('marks a CREATE and lists every key of the new entity', () => {
    const r = writeReceipt('page', 'about', undefined, { id: 'about', path: 'about', title: 'About' });
    expect(r.created).toBe(true);
    expect(r.changed).toEqual(['id', 'path', 'title']); // sorted
    // A null prior counts as "nothing was there" too.
    expect(writeReceipt('page', 'about', null, { id: 'about' }).created).toBe(true);
  });

  it('reports a key that was ADDED or REMOVED, not just changed in place', () => {
    expect(writeReceipt('page', 'p', { id: 'p' }, { id: 'p', source: '<p>x</p>' }).changed).toEqual(['source']);
    expect(writeReceipt('page', 'p', { id: 'p', source: '<p>x</p>' }, { id: 'p' }).changed).toEqual(['source']);
    // An explicit `undefined` must not read as "absent" — both are reported the same way, but a key
    // going from a VALUE to undefined is still a change.
    expect(writeReceipt('page', 'p', { id: 'p', title: 'A' }, { id: 'p', title: undefined }).changed).toEqual(['title']);
  });

  it('surfaces a nested edit as its owning TOP-LEVEL key (deliberately shallow)', () => {
    const r = writeReceipt('page', 'p', { data: { a: 1, b: 2 } }, { data: { a: 1, b: 3 } });
    expect(r.changed).toEqual(['data']);
  });

  it('never throws on a circular or non-object entity', () => {
    const circular: Record<string, unknown> = { id: 'p' };
    circular.self = circular;
    expect(() => writeReceipt('page', 'p', {}, circular)).not.toThrow();
    expect(writeReceipt('page', 'p', {}, circular).bytes).toBe(0); // size is informational only
    // A non-record entity has no top-level keys to diff.
    expect(writeReceipt('page', 'p', 'x', 'y').changed).toEqual([]);
  });
});
