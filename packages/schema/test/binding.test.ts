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
});
