import { describe, it, expect } from 'vitest';
import { DatasetSchema, EntrySchema, FieldSchema } from '../src/dataset.js';

describe('Dataset schemas', () => {
  it('parses a dataset and applies field defaults', () => {
    const ds = DatasetSchema.parse({
      id: 'd1',
      name: 'Products',
      slug: 'products',
      fields: [{ name: 'title', type: 'text', required: true }],
    });
    expect(ds.fields[0]?.required).toBe(true);
    expect(ds.fields[0]?.localized).toBe(false);
  });

  it('defaults a dataset with no fields to an empty array', () => {
    const ds = DatasetSchema.parse({ id: 'd2', name: 'Empty', slug: 'empty' });
    expect(ds.fields).toEqual([]);
  });

  it('rejects an unknown field type', () => {
    expect(() => FieldSchema.parse({ name: 'x', type: 'nope' })).toThrow();
  });

  it('defaults entry status to draft', () => {
    const e = EntrySchema.parse({
      id: 'e1',
      dataset: 'products',
      values: { title: 'Hat' },
    });
    expect(e.status).toBe('draft');
  });
});
