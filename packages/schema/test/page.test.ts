import { describe, it, expect } from 'vitest';
import { PageSchema } from '../src/page.js';
import { PartialSchema } from '../src/partial.js';

describe('PageSchema', () => {
  it('parses a page with a block tree (home = empty slug)', () => {
    const page = PageSchema.parse({
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 't', type: 'RichText' }] },
    });
    expect(page.path).toBe('');
    expect(page.root.children?.[0]?.type).toBe('RichText');
  });

  it('accepts a single slug segment (no slashes) and an optional Handlebars `source`', () => {
    const page = PageSchema.parse({
      id: 'about', path: 'about', title: 'About',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>{{ company.name }}</h1></section>',
    });
    expect(page.path).toBe('about');
    expect(page.source).toContain('{{ company.name }}');
    expect(PageSchema.parse({ id: 'p', path: '', title: 'P', root: { id: 'r', type: 'Section' } }).source).toBeUndefined();
  });

  it('treats status as optional (absent = published) and accepts draft/published', () => {
    expect(PageSchema.parse({ id: 'p', path: '', title: 'P', root: { id: 'r', type: 'Section' } }).status).toBeUndefined();
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', status: 'draft', root: { id: 'r', type: 'Section' } }).status).toBe('draft');
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', status: 'archived', root: { id: 'r', type: 'Section' } })).toThrow();
  });

  it('parses a collection page (leaf slug is the [param] segment)', () => {
    const page = PageSchema.parse({
      id: 'product',
      path: '[slug]',
      title: 'Product',
      root: { id: 'r', type: 'Section' },
      collection: { dataset: 'products', param: 'slug' },
    });
    expect(page.collection?.dataset).toBe('products');
  });

  it('rejects a page without a root block', () => {
    expect(() => PageSchema.parse({ id: 'x', path: 'x', title: 'X' })).toThrow();
  });

  it('rejects a slug containing slashes (nesting comes from `parent`, not the path)', () => {
    for (const path of ['de/services', '/about', '//evil.com', 'a/b']) {
      expect(() => PageSchema.parse({ id: 'x', path, title: 'X', root: { id: 'r', type: 'Section' } }), path).toThrow();
    }
  });

  it('rejects a collection without a [param] segment in the slug', () => {
    expect(() =>
      PageSchema.parse({
        id: 'product',
        path: 'products',
        title: 'Product',
        root: { id: 'r', type: 'Section' },
        collection: { dataset: 'products', param: 'slug' },
      }),
    ).toThrow();
  });

  it('rejects a [param] slug with no collection definition', () => {
    expect(() =>
      PageSchema.parse({
        id: 'product',
        path: '[slug]',
        title: 'Product',
        root: { id: 'r', type: 'Section' },
      }),
    ).toThrow();
  });
});

describe('PartialSchema', () => {
  it('parses a partial', () => {
    const p = PartialSchema.parse({
      id: 'header',
      name: 'Site Header',
      root: { id: 'r', type: 'Header' },
    });
    expect(p.name).toBe('Site Header');
  });
});
