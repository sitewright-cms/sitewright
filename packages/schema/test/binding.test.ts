import { describe, it, expect } from 'vitest';
import { BindingSchema } from '../src/binding.js';

describe('BindingSchema', () => {
  it('defaults mode to "single"', () => {
    expect(BindingSchema.parse({ dataset: 'products' }).mode).toBe('single');
  });

  it('accepts list mode with a limit and a query', () => {
    const b = BindingSchema.parse({
      dataset: 'products',
      mode: 'list',
      limit: 12,
      query: { where: { featured: true } },
    });
    expect(b.mode).toBe('list');
    expect(b.limit).toBe(12);
  });

  it('rejects a non-positive limit', () => {
    expect(() => BindingSchema.parse({ dataset: 'p', limit: 0 })).toThrow();
  });

  it('rejects a missing dataset', () => {
    expect(() => BindingSchema.parse({ mode: 'single' })).toThrow();
  });

  it('accepts a typed sort directive', () => {
    const b = BindingSchema.parse({
      dataset: 'products',
      query: { sort: { field: 'price', dir: 'desc' } },
    });
    expect(b.query?.sort?.dir).toBe('desc');
  });

  it('rejects a sort field that is not a valid identifier', () => {
    expect(() =>
      BindingSchema.parse({ dataset: 'products', query: { sort: { field: '../x' } } }),
    ).toThrow();
  });

  it('rejects a prototype-pollution key in a where filter', () => {
    const where = JSON.parse('{"__proto__": 1}');
    expect(() => BindingSchema.parse({ dataset: 'products', query: { where } })).toThrow();
  });
});
