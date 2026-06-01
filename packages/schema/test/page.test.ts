import { describe, it, expect } from 'vitest';
import { PageSchema } from '../src/page.js';
import { PartialSchema } from '../src/partial.js';

describe('PageSchema', () => {
  it('parses a page with a block tree', () => {
    const page = PageSchema.parse({
      id: 'home',
      path: '/',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 't', type: 'RichText' }] },
    });
    expect(page.path).toBe('/');
    expect(page.root.children?.[0]?.type).toBe('RichText');
  });

  it('accepts an optional code-first Handlebars `source` alongside the block tree', () => {
    const page = PageSchema.parse({
      id: 'home', path: '/', title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>{{ company.name }}</h1></section>',
    });
    expect(page.source).toContain('{{ company.name }}');
    // Absent by default (existing block pages are unaffected).
    expect(PageSchema.parse({ id: 'p', path: '/', title: 'P', root: { id: 'r', type: 'Section' } }).source).toBeUndefined();
  });

  it('treats status as optional (absent = published) and accepts draft/published', () => {
    expect(PageSchema.parse({ id: 'p', path: '/', title: 'P', root: { id: 'r', type: 'Section' } }).status).toBeUndefined();
    expect(PageSchema.parse({ id: 'p', path: '/', title: 'P', status: 'draft', root: { id: 'r', type: 'Section' } }).status).toBe('draft');
    expect(() => PageSchema.parse({ id: 'p', path: '/', title: 'P', status: 'archived', root: { id: 'r', type: 'Section' } })).toThrow();
  });

  it('parses a collection page', () => {
    const page = PageSchema.parse({
      id: 'product',
      path: '/products/[slug]',
      title: 'Product',
      root: { id: 'r', type: 'Section' },
      collection: { dataset: 'products', param: 'slug' },
    });
    expect(page.collection?.dataset).toBe('products');
  });

  it('rejects a page without a root block', () => {
    expect(() => PageSchema.parse({ id: 'x', path: '/x', title: 'X' })).toThrow();
  });

  it('rejects a collection without a [param] segment in the path', () => {
    expect(() =>
      PageSchema.parse({
        id: 'product',
        path: '/products',
        title: 'Product',
        root: { id: 'r', type: 'Section' },
        collection: { dataset: 'products', param: 'slug' },
      }),
    ).toThrow();
  });

  it('rejects a [param] path with no collection definition', () => {
    expect(() =>
      PageSchema.parse({
        id: 'product',
        path: '/products/[slug]',
        title: 'Product',
        root: { id: 'r', type: 'Section' },
      }),
    ).toThrow();
  });

  it('rejects a protocol-relative path (open-redirect surface)', () => {
    expect(() =>
      PageSchema.parse({
        id: 'x',
        path: '//evil.com',
        title: 'X',
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
