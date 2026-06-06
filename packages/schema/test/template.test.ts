import { describe, it, expect } from 'vitest';
import { TemplateRefSchema, TemplateSchema } from '../src/template.js';

describe('TemplateSchema (code-first: Handlebars source, no block tree)', () => {
  it('accepts a template with id/name/source', () => {
    const t = {
      id: 'blog',
      name: 'Blog Layout',
      source: '<article class="prose">{{edit "body" "Write here"}}</article>',
    };
    expect(TemplateSchema.parse(t)).toEqual(t);
  });

  it('rejects a missing name or source — and the retired block-tree shape', () => {
    expect(() => TemplateSchema.parse({ id: 'x', source: '<p>hi</p>' })).toThrow();
    expect(() => TemplateSchema.parse({ id: 'x', name: 'N' })).toThrow();
    // The legacy Outlet/root model no longer parses (root is not a source).
    expect(() =>
      TemplateSchema.parse({ id: 'x', name: 'N', root: { id: 'r', type: 'Section' } }),
    ).toThrow();
  });

  it('bounds the source like a page source (256 KiB)', () => {
    expect(() =>
      TemplateSchema.parse({ id: 'x', name: 'N', source: 'a'.repeat(256 * 1024 + 1) }),
    ).toThrow();
  });
});

describe('TemplateRefSchema', () => {
  it('accepts plain project ids and global: refs', () => {
    expect(TemplateRefSchema.parse('blog')).toBe('blog');
    expect(TemplateRefSchema.parse('global:landing')).toBe('global:landing');
  });

  it('rejects other prefixes and unsafe characters', () => {
    expect(() => TemplateRefSchema.parse('other:landing')).toThrow();
    expect(() => TemplateRefSchema.parse('global:')).toThrow();
    expect(() => TemplateRefSchema.parse('a b')).toThrow();
  });
});
