import { describe, it, expect } from 'vitest';
import { TemplateSchema } from '../src/template.js';

describe('TemplateSchema', () => {
  it('accepts a template with id/name/root (incl. an Outlet node)', () => {
    const t = {
      id: 'blog',
      name: 'Blog Layout',
      root: { id: 'r', type: 'Section', children: [{ id: 'o', type: 'Outlet' }] },
    };
    expect(TemplateSchema.parse(t)).toEqual(t);
  });

  it('rejects a missing name or root', () => {
    expect(() => TemplateSchema.parse({ id: 'x', root: { id: 'r', type: 'Section' } })).toThrow();
    expect(() => TemplateSchema.parse({ id: 'x', name: 'N' })).toThrow();
  });
});
