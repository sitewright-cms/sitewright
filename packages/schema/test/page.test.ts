import { describe, it, expect } from 'vitest';
import { PageSchema } from '../src/page.js';

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

  it('migrates the RETIRED content map into page.data (folded, content dropped)', () => {
    const node = { id: 'r', type: 'Section' };
    const a = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, content: { hero_h1: 'Hi', tagline: 'T' } });
    expect(a.data).toEqual({ hero_h1: 'Hi', tagline: 'T' });
    expect('content' in a).toBe(false);
    // page.data wins a collision with content.
    const b = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, content: { k: 'fromContent' }, data: { k: 'fromData' } });
    expect(b.data).toEqual({ k: 'fromData' });
    // a prototype-pollution content key is dropped (not migrated, no pollution).
    const c = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, content: JSON.parse('{"__proto__":"x","ok":"1"}') });
    expect(c.data).toEqual({ ok: '1' });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    // no content → data untouched.
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node }).data).toBeUndefined();
    // an empty-string content key is dropped (no directive can read it).
    const e = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, content: { '': 'x', ok: 'y' } });
    expect(e.data).toEqual({ ok: 'y' });
  });

  it('migrates the RETIRED richContent map into page.data too (single store)', () => {
    const node = { id: 'r', type: 'Section' };
    // bare-key rich HTML folds into a top-level page.data string; richContent is dropped.
    const a = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, richContent: { intro: '<p>Hi</p>' } });
    expect(a.data).toEqual({ intro: '<p>Hi</p>' });
    expect('richContent' in a).toBe(false);
    // page.data wins a collision with richContent; prototype-pollution + empty keys are dropped.
    const b = PageSchema.parse({
      id: 'p', path: 'p', title: 'P', root: node,
      richContent: JSON.parse('{"__proto__":"x","":"y","intro":"<p>fromRich</p>","keep":"<b>k</b>"}'),
      data: { intro: '<p>fromData</p>' },
    });
    expect(b.data).toEqual({ intro: '<p>fromData</p>', keep: '<b>k</b>' });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    // content + richContent both fold into the same page.data.
    const c = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, content: { a: '1' }, richContent: { b: '<i>2</i>' } });
    expect(c.data).toEqual({ a: '1', b: '<i>2</i>' });
    expect('content' in c).toBe(false);
    expect('richContent' in c).toBe(false);
    // Deterministic precedence when BOTH legacy stores hold the same key: `content` migrates first,
    // so it wins over `richContent` (pathological — the two stores never shared a key in practice).
    const d = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node, content: { x: 'plain' }, richContent: { x: '<p>rich</p>' } });
    expect(d.data).toEqual({ x: 'plain' });
  });

  it('migrates the RETIRED page.seo object onto flat page fields (ogImage→image, title dropped)', () => {
    const node = { id: 'r', type: 'Section' };
    // The whole seo object flattens: description/canonical/noindex keep their names, ogImage→image,
    // and the retired seo.title is DROPPED (the page title is the only title now).
    const a = PageSchema.parse({
      id: 'p', path: 'p', title: 'P', root: node,
      seo: { title: 'SEO title', description: 'Desc', ogImage: '/og.png', canonical: 'https://x.io/p', noindex: true },
    });
    expect(a.description).toBe('Desc');
    expect(a.image).toBe('/og.png');
    expect(a.canonical).toBe('https://x.io/p');
    expect(a.noindex).toBe(true);
    expect('seo' in a).toBe(false);
    expect((a as Record<string, unknown>).title).toBe('P'); // page title untouched; seo.title gone
    // A top-level field WINS a collision with the legacy seo object (forward-migrated data).
    const b = PageSchema.parse({
      id: 'p', path: 'p', title: 'P', root: node,
      description: 'top', image: '/top.png', seo: { description: 'legacy', ogImage: '/legacy.png' },
    });
    expect(b.description).toBe('top');
    expect(b.image).toBe('/top.png');
    expect('seo' in b).toBe(false);
    // No seo object → the flat fields stay absent (no empty object, no migration noise).
    const c = PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: node });
    expect(c.description).toBeUndefined();
    expect(c.image).toBeUndefined();
    // A prototype-pollution key inside the legacy seo object can't pollute (only the 4 fixed
    // field names are copied; the global prototype stays clean).
    const d = PageSchema.parse({
      id: 'p', path: 'p', title: 'P', root: node,
      seo: JSON.parse('{"__proto__":{"polluted":"x"},"description":"d"}'),
    });
    expect(d.description).toBe('d');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts an optional bounded, prototype-safe page.data object', () => {
    const data = { article_title: 'Hello', tags: ['a', 'b'], meta: { featured: true } };
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: { id: 'r', type: 'Section' }, data }).data).toEqual(data);
    // Optional — absent stays undefined.
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: { id: 'r', type: 'Section' } }).data).toBeUndefined();
    // Prototype-pollution key (own __proto__ via JSON.parse) is rejected.
    const polluted = JSON.parse('{"__proto__":{"x":1}}');
    expect(() => PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: { id: 'r', type: 'Section' }, data: polluted })).toThrow();
    // The root must be an OBJECT — an array or bare scalar is rejected (arrays are fine as nested values).
    const base = { id: 'p', path: 'p', title: 'P', root: { id: 'r', type: 'Section' } };
    expect(() => PageSchema.parse({ ...base, data: ['a', 'b'] })).toThrow();
    expect(() => PageSchema.parse({ ...base, data: 'just a string' })).toThrow();
    expect(() => PageSchema.parse({ ...base, data: 42 })).toThrow();
    expect(() => PageSchema.parse({ ...base, data: null })).toThrow();
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

describe('PageSchema — link placeholders (kind:"link")', () => {
  const STUB = { id: 'r', type: 'Section' as const, children: [] };
  const link = (over: Record<string, unknown>) =>
    PageSchema.parse({ id: 'nav-x', path: '', title: 'X', kind: 'link', root: STUB, ...over });

  it('absent kind still parses as a normal page (back-compat)', () => {
    expect(PageSchema.parse({ id: 'p', path: 'p', title: 'P', root: STUB }).kind).toBeUndefined();
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
    expect(() => PageSchema.parse({ id: 'nav-x', path: '', title: 'X', kind: 'link', root: STUB, nav: { slots: ['header'] } })).toThrow();
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
