import { describe, it, expect } from 'vitest';
import type { Binding, Entry } from '@sitewright/schema';
import { resolveBinding, compareEntryOrder } from '../src/index.js';

describe('compareEntryOrder', () => {
  it('sorts by order ascending, absent last, with an id tie-break', () => {
    const mk = (id: string, order?: number): Entry => ({ id, dataset: 'd', status: 'published', values: {}, ...(order !== undefined ? { order } : {}) });
    const sorted = [mk('b', 2), mk('a', 1), mk('z'), mk('y'), mk('c', 1)].slice().sort(compareEntryOrder).map((e) => e.id);
    expect(sorted).toEqual(['a', 'c', 'b', 'y', 'z']);
  });
});

const entries: Entry[] = [
  { id: 'e1', dataset: 'products', status: 'published', values: { name: 'B', price: 20, featured: true } },
  { id: 'e2', dataset: 'products', status: 'published', values: { name: 'A', price: 10, featured: false } },
  { id: 'e3', dataset: 'products', status: 'draft', values: { name: 'C', price: 5, featured: true } },
  { id: 'e4', dataset: 'other', status: 'published', values: { name: 'Z' } },
  { id: 'e5', dataset: 'products', status: 'published', values: { name: 'D', meta: { tag: 'x' } } },
];

function binding(over: Partial<Binding> = {}): Binding {
  return { dataset: 'products', mode: 'list', ...over };
}

describe('resolveBinding', () => {
  it('returns only published entries of the matching dataset', () => {
    const result = resolveBinding(binding(), entries);
    expect(result.map((e) => e.id)).toEqual(['e1', 'e2', 'e5']);
  });

  it('includes drafts when requested', () => {
    const result = resolveBinding(binding(), entries, { includeDrafts: true });
    expect(result.map((e) => e.id)).toContain('e3');
  });

  it('applies a where equality filter', () => {
    const result = resolveBinding(binding({ query: { where: { featured: true } } }), entries);
    expect(result.map((e) => e.id)).toEqual(['e1']); // e3 is a draft, excluded
  });

  it('matches object-valued where filters by structural equality', () => {
    const result = resolveBinding(binding({ query: { where: { meta: { tag: 'x' } } } }), entries);
    expect(result.map((e) => e.id)).toEqual(['e5']);
  });

  it('sorts ascending and descending by a string field', () => {
    const asc = resolveBinding(binding({ query: { sort: { field: 'name', dir: 'asc' } } }), entries);
    expect(asc.map((e) => e.values.name)).toEqual(['A', 'B', 'D']);
    const desc = resolveBinding(
      binding({ query: { sort: { field: 'name', dir: 'desc' } } }),
      entries,
    );
    expect(desc.map((e) => e.values.name)).toEqual(['D', 'B', 'A']);
  });

  it('sorts numeric fields numerically, not lexicographically', () => {
    const nums: Entry[] = [
      { id: 'n1', dataset: 'n', status: 'published', values: { v: 100 } },
      { id: 'n2', dataset: 'n', status: 'published', values: { v: 9 } },
      { id: 'n3', dataset: 'n', status: 'published', values: { v: 20 } },
    ];
    const result = resolveBinding(
      { dataset: 'n', mode: 'list', query: { sort: { field: 'v', dir: 'asc' } } },
      nums,
    );
    expect(result.map((e) => e.values.v)).toEqual([9, 20, 100]);
  });

  it('mode "single" returns at most one entry', () => {
    const result = resolveBinding(binding({ mode: 'single' }), entries);
    expect(result.map((e) => e.id)).toEqual(['e1']);
  });

  it('mode "list" honours the limit', () => {
    const result = resolveBinding(binding({ mode: 'list', limit: 2 }), entries);
    expect(result.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('sorts without throwing when some entries lack the sort field', () => {
    const mixed: Entry[] = [
      { id: 'm1', dataset: 'm', status: 'published', values: { name: 'B' } },
      { id: 'm2', dataset: 'm', status: 'published', values: {} },
    ];
    const result = resolveBinding(
      { dataset: 'm', mode: 'list', query: { sort: { field: 'name' } } },
      mixed,
    );
    expect(result).toHaveLength(2);
  });

  it('returns an empty array for a dataset with no entries', () => {
    expect(resolveBinding(binding({ dataset: 'empty' }), entries)).toEqual([]);
  });
});
