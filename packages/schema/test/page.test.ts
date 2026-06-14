import { describe, it, expect } from 'vitest';
import { PageSchema } from '../src/page.js';

describe('PageSchema', () => {
  it('parses a minimal page (home = empty slug)', () => {
    const page = PageSchema.parse({
      id: 'home',
      path: '',
      title: 'Home',
    });
    expect(page.path).toBe('');
    expect(page.title).toBe('Home');
  });

  it('accepts a single slug segment (no slashes) and an optional Handlebars `source`', () => {
    const page = PageSchema.parse({
      id: 'about', path: 'about', title: 'About',
      source: '<section><h1>{{ company.name }}</h1></section>',
    });
    expect(page.path).toBe('about');
    expect(page.source).toContain('{{ company.name }}');
    expect(PageSchema.parse({ id: 'p', path: '', title: 'P' }).source).toBeUndefined();
  });

  it('treats status as optional (absent = published) and accepts draft/published', () => {
    expect(PageSchema.parse({ id: 'p', path: '', title: 'P' }).status).toBeUndefined();
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', status: 'draft' }).status).toBe('draft');
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', status: 'archived' })).toThrow();
  });

  it('accepts an optional bounded, prototype-safe page.data object', () => {
    const data = { article_title: 'Hello', tags: ['a', 'b'], meta: { featured: true } };
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', data }).data).toEqual(data);
    // Optional — absent stays undefined.
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P' }).data).toBeUndefined();
    // Prototype-pollution key (own __proto__ via JSON.parse) is rejected.
    const polluted = JSON.parse('{"__proto__":{"x":1}}');
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', data: polluted })).toThrow();
    // The root must be an OBJECT — an array or bare scalar is rejected (arrays are fine as nested values).
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', data: ['a', 'b'] })).toThrow();
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', data: 'just a string' })).toThrow();
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', data: 42 })).toThrow();
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', data: null })).toThrow();
  });

  it('parses a collection page (leaf slug is the [param] segment)', () => {
    const page = PageSchema.parse({
      id: 'product',
      path: '[slug]',
      title: 'Product',
      collection: { dataset: 'products', param: 'slug' },
    });
    expect(page.collection?.dataset).toBe('products');
  });

  it('rejects a slug containing slashes (nesting comes from `parent`, not the path)', () => {
    for (const path of ['de/services', '/about', '//evil.com', 'a/b']) {
      expect(() => PageSchema.parse({ id: 'x', path, title: 'X' }), path).toThrow();
    }
  });

  it('rejects a collection without a [param] segment in the slug', () => {
    expect(() =>
      PageSchema.parse({
        id: 'product',
        path: 'products',
        title: 'Product',
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
      }),
    ).toThrow();
  });
});

describe('PageSchema — link placeholders (kind:"link")', () => {
  const link = (over: Record<string, unknown>) =>
    PageSchema.parse({ id: 'nav-x', path: '', title: 'X', kind: 'link', ...over });

  it('absent kind still parses as a normal page (back-compat)', () => {
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P' }).kind).toBeUndefined();
  });

  it('parses each target shape (anchor / internal / internal#hash / http / mailto / tel)', () => {
    for (const target of ['#sec', '/about', '/about#team', 'https://x.test', 'mailto:a@b.test', 'tel:+15551234']) {
      expect(link({ link: { target }, nav: { slots: ['header'] } }).link?.target).toBe(target);
    }
    expect(link({ link: { target: 'https://x.test', newTab: true }, nav: { slots: ['header'] } }).link?.newTab).toBe(true);
  });

  it('accepts an empty target when it is a dropdown parent', () => {
    expect(link({ link: { target: '' }, nav: { slots: ['header'], dropdown: true } }).nav?.dropdown).toBe(true);
  });

  it('rejects a link page with no link definition', () => {
    expect(() => PageSchema.parse({ id: 'nav-x', path: '', title: 'X', kind: 'link', nav: { slots: ['header'] } })).toThrow();
  });

  it('rejects a link with neither a target nor dropdown (does nothing)', () => {
    expect(() => link({ link: {}, nav: { slots: ['header'] } })).toThrow();
    expect(() => link({ link: { target: '' }, nav: { slots: ['header'] } })).toThrow();
  });

  it('rejects unsafe target schemes (javascript:/data:) and protocol-relative', () => {
    expect(() => link({ link: { target: 'javascript:alert(1)' }, nav: { slots: ['header'] } })).toThrow();
    expect(() => link({ link: { target: 'data:text/html,<script>' }, nav: { slots: ['header'] } })).toThrow();
    expect(() => link({ link: { target: '//evil.test' }, nav: { slots: ['header'] } })).toThrow();
  });
});
