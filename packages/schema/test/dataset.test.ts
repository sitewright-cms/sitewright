import { describe, it, expect } from 'vitest';
import { DatasetSchema, EntrySchema, FieldSchema, MAX_FIELD_DEPTH } from '../src/dataset.js';

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

  // ---- nested datasets (list / object field types) -------------------------------------------

  it('parses a nested list field (settings + a repeatable group), recursively', () => {
    const ds = DatasetSchema.parse({
      id: 'hero',
      name: 'Hero',
      slug: 'hero',
      fields: [
        { name: 'show_navigation', type: 'boolean' },
        {
          name: 'slides',
          type: 'list',
          fields: [
            { name: 'image', type: 'image' },
            { name: 'caption', type: 'text' },
          ],
        },
      ],
    });
    const slides = ds.fields.find((f) => f.name === 'slides')!;
    expect(slides.type).toBe('list');
    expect(slides.fields).toHaveLength(2);
    expect(slides.fields?.[0]?.required).toBe(false); // child defaults applied recursively
  });

  it('requires list/object fields to carry child fields, and forbids children on scalar fields', () => {
    expect(() => FieldSchema.parse({ name: 'slides', type: 'list' })).toThrow();
    expect(() => FieldSchema.parse({ name: 'slides', type: 'list', fields: [] })).toThrow();
    expect(() => FieldSchema.parse({ name: 'title', type: 'text', fields: [{ name: 'x', type: 'text' }] })).toThrow();
  });

  it('enforces the nesting-depth cap structurally (parse fails one level past MAX_FIELD_DEPTH)', () => {
    // A chain one level deeper than allowed: MAX_FIELD_DEPTH object levels + a text leaf.
    let field: Record<string, unknown> = { name: 'leaf', type: 'text' };
    for (let d = 0; d < MAX_FIELD_DEPTH; d += 1) field = { name: `lvl${d}`, type: 'object', fields: [field] };
    expect(() => DatasetSchema.parse({ id: 'deep', name: 'Deep', slug: 'deep', fields: [field] })).toThrow();
  });

  it('accepts nesting exactly at the depth cap', () => {
    let field: Record<string, unknown> = { name: 'leaf', type: 'text' };
    for (let d = 0; d < MAX_FIELD_DEPTH - 1; d += 1) field = { name: `lvl${d}`, type: 'object', fields: [field] };
    expect(() => DatasetSchema.parse({ id: 'ok', name: 'OK', slug: 'ok', fields: [field] })).not.toThrow();
  });

  it('does NOT stack-overflow on a pathologically deep input (structural cap, not z.lazy recursion)', () => {
    let field: Record<string, unknown> = { name: 'leaf', type: 'text' };
    for (let d = 0; d < 5000; d += 1) field = { name: `l${d}`, type: 'object', fields: [field] };
    expect(() => DatasetSchema.parse({ id: 'x', name: 'X', slug: 'x', fields: [field] })).toThrow();
  });

  it('entries store nested values verbatim (permissive values record)', () => {
    const e = EntrySchema.parse({
      id: 'e-hero',
      dataset: 'hero',
      values: { show_navigation: true, slides: [{ image: '/a.jpg', caption: 'A' }, { image: '/b.jpg', caption: 'B' }] },
    });
    expect((e.values.slides as unknown[]).length).toBe(2);
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
