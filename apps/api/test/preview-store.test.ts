import { describe, it, expect } from 'vitest';
import { PreviewStore } from '../src/http/preview-store.js';

const scope = { orgId: 'o', projectId: 'p', userId: 'u' };

describe('PreviewStore', () => {
  it('round-trips html for a valid, scope-matching token', () => {
    const store = new PreviewStore();
    const token = store.put('<h1>hi</h1>', scope);
    expect(store.get(token, scope)).toBe('<h1>hi</h1>');
  });

  it('returns null for an unknown token', () => {
    expect(new PreviewStore().get('nope', scope)).toBeNull();
  });

  it('rejects a token used from a different org/project/user', () => {
    const store = new PreviewStore();
    const token = store.put('x', scope);
    expect(store.get(token, { ...scope, orgId: 'other' })).toBeNull();
    expect(store.get(token, { ...scope, projectId: 'other' })).toBeNull();
    expect(store.get(token, { ...scope, userId: 'other' })).toBeNull();
  });

  it('expires tokens after the TTL', () => {
    let t = 1000;
    const store = new PreviewStore({ ttlMs: 100, now: () => t });
    const token = store.put('x', scope);
    t = 1099;
    expect(store.get(token, scope)).toBe('x'); // still valid
    t = 1101;
    expect(store.get(token, scope)).toBeNull(); // expired
  });

  it('evicts the oldest tokens beyond the cap', () => {
    const store = new PreviewStore({ maxEntries: 2 });
    const a = store.put('a', scope);
    const b = store.put('b', scope);
    const c = store.put('c', scope); // pushes out `a`
    expect(store.get(a, scope)).toBeNull();
    expect(store.get(b, scope)).toBe('b');
    expect(store.get(c, scope)).toBe('c');
  });

  it('issues distinct, opaque tokens', () => {
    const store = new PreviewStore();
    expect(store.put('x', scope)).not.toBe(store.put('x', scope));
  });
});
