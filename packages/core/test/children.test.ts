import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { childrenOf, parentPageView, referencesChildren, referencesParentPage, MAX_PAGE_CHILDREN, extractRegions, extractClassNames, MAX_EXTRACTED_CLASS_TOKENS } from '../src/index.js';

const page = (over: Partial<Page>): Page =>
  ({ id: 'p', path: '', title: 'T', ...over }) as Page;

describe('childrenOf', () => {
  const pages = [
    page({ id: 'blog', path: 'blog', title: 'Blog' }),
    page({
      id: 'a2', path: 'second', parent: 'blog', order: 2, title: 'Second',
      description: 'Two', image: '/two.jpg', data: { article_title: 'Two!' },
    }),
    page({
      id: 'a1', path: 'first', parent: 'blog', order: 1, title: 'First', status: 'draft',
      description: 'One', image: '/one.jpg', nav: { title: 'First (nav)', slots: ['header'] }, data: { article_title: 'One!' },
    }),
    page({ id: 'elsewhere', path: 'x', parent: 'home', title: 'Elsewhere' }),
    page({ id: 'product', path: '[slug]', parent: 'blog', title: 'Product', collection: { dataset: 'products', param: 'slug' } }),
  ];

  it('returns the direct children, flattened and ordered by order then title', () => {
    const kids = childrenOf(pages, pages[0]!, 'en');
    expect(kids.map((k) => k.slug)).toEqual(['first', 'second']); // order 1, 2 — not the collection page
    expect(kids[0]).toMatchObject({
      id: 'a1', title: 'First', slug: 'first', path: '/blog/first',
      description: 'One', image: '/one.jpg', navTitle: 'First (nav)',
      status: 'draft', order: 1, data: { article_title: 'One!' },
    });
    expect(kids[1]).toMatchObject({ slug: 'second', path: '/blog/second', description: 'Two', image: '/two.jpg', status: 'published' });
  });

  it('excludes collection pages and pages parented elsewhere', () => {
    const kids = childrenOf(pages, pages[0]!, 'en');
    expect(kids.find((k) => k.id === 'product')).toBeUndefined(); // [param] collection page
    expect(kids.find((k) => k.id === 'elsewhere')).toBeUndefined(); // parent !== blog
  });

  it('defaults missing fields (no description/image/data/nav/status) sanely', () => {
    const ps = [page({ id: 'parent', path: 'p', title: 'Parent' }), page({ id: 'c', path: 'c', parent: 'parent', title: 'Child' })];
    expect(childrenOf(ps, ps[0]!, 'en')[0]).toMatchObject({
      description: '', image: '', noindex: false, navTitle: 'Child', status: 'published', order: 0, data: {},
    });
  });

  it(`caps the result at MAX_PAGE_CHILDREN (${MAX_PAGE_CHILDREN}), keeping the lowest-ordered`, () => {
    const parent = page({ id: 'p', path: 'p', title: 'P' });
    const kids = Array.from({ length: MAX_PAGE_CHILDREN + 100 }, (_, i) =>
      page({ id: `c${i}`, path: `c${i}`, parent: 'p', order: i, title: `C${i}` }),
    );
    const out = childrenOf([parent, ...kids], parent, 'en');
    expect(out).toHaveLength(MAX_PAGE_CHILDREN);
    expect(out[0]!.id).toBe('c0'); // lowest order kept
    expect(out.at(-1)!.id).toBe(`c${MAX_PAGE_CHILDREN - 1}`);
  });

  it('lists only same-locale children (an overview lists its own language)', () => {
    const ps = [
      page({ id: 'blog', path: 'blog', title: 'Blog' }),
      page({ id: 'en1', path: 'en1', parent: 'blog', title: 'EN' }),
      page({ id: 'de1', path: 'de1', parent: 'blog', title: 'DE', locale: 'de' }),
    ];
    expect(childrenOf(ps, ps[0]!, 'en').map((k) => k.id)).toEqual(['en1']); // default-locale parent → en child only
    const deBlog = page({ id: 'blog', path: 'blog', title: 'Blog', locale: 'de' });
    expect(childrenOf([deBlog, ps[1]!, ps[2]!], deBlog, 'en').map((k) => k.id)).toEqual(['de1']);
  });
});

describe('parentPageView', () => {
  const pages = [
    page({ id: 'home', path: '', title: 'Home', data: { brand: 'Acme' } }),
    page({ id: 'services', path: 'services', parent: 'home', title: 'Services', data: { eyebrow: 'What we do' } }),
    page({ id: 'web', path: 'web', parent: 'services', title: 'Web', locale: 'de' }),
  ];

  it('flattens the parent: own slug, FULL computed path, locale, and its page.data', () => {
    // services' parent is home (empty slug → path "/", its own data).
    expect(parentPageView(pages, pages[1]!, 'en')).toEqual({
      title: 'Home', slug: '', path: '/', locale: 'en', data: { brand: 'Acme' },
    });
    // web's parent is services — `path` is the FULL route (not the bare segment), `data` is the parent's own.
    expect(parentPageView(pages, pages[2]!, 'en')).toMatchObject({ slug: 'services', path: '/services', data: { eyebrow: 'What we do' } });
  });

  it('reports the PARENT’s own locale, not the child’s (no same-locale filter, unlike childrenOf)', () => {
    // `web` is `de`, its parent `services` has no locale → defaults to `en`. parentPage crosses locales.
    expect(parentPageView(pages, pages[2]!, 'en')?.locale).toBe('en');
  });

  it('is undefined at the tree root / home (no parent) and for an unresolved parent id', () => {
    expect(parentPageView(pages, pages[0]!, 'en')).toBeUndefined(); // home: no parent
    expect(parentPageView(pages, page({ id: 'orphan', path: 'x', parent: 'gone', title: 'O' }), 'en')).toBeUndefined();
  });

  it('defaults the parent data to {} when unset', () => {
    const ps = [page({ id: 'p', path: 'p', title: 'P' }), page({ id: 'c', path: 'c', parent: 'p', title: 'C' })];
    expect(parentPageView(ps, ps[1]!, 'en')?.data).toEqual({});
  });
});

describe('referencesChildren', () => {
  it('matches a page.children reference but not look-alikes', () => {
    expect(referencesChildren('{{#each page.children}}x{{/each}}')).toBe(true);
    expect(referencesChildren('{{ page.children.length }}')).toBe(true);
    expect(referencesChildren('no children here')).toBe(false);
    expect(referencesChildren('nav-page.children')).toBe(false); // preceded by an identifier/-
    expect(referencesChildren('mypage.children')).toBe(false);
  });
});

describe('referencesParentPage', () => {
  it('matches a parentPage reference but not look-alikes', () => {
    expect(referencesParentPage('<a href="{{sw-url parentPage.path}}">up</a>')).toBe(true);
    expect(referencesParentPage('{{ parentPage.title }}')).toBe(true);
    expect(referencesParentPage('{{parentPage.data.section_color}}')).toBe(true);
    expect(referencesParentPage('no parent here')).toBe(false);
    expect(referencesParentPage('{{ parentPageView }}')).toBe(false); // longer word
    expect(referencesParentPage('nav-parentPage')).toBe(false); // preceded by an identifier/-
    expect(referencesParentPage('myparentPage.path')).toBe(false);
  });
});

describe('extractRegions', () => {
  it('extracts data-sw-text regions with their default content', () => {
    const regions = extractRegions('<h1 data-sw-text="headline">Hello world</h1>');
    expect(regions).toEqual([{ key: 'headline', default: 'Hello world', kind: 'text' }]);
  });

  it('extracts data-sw-html regions as kind "rich"', () => {
    const regions = extractRegions('<div data-sw-html="body"><p>Default body</p></div>');
    expect(regions).toEqual([{ key: 'body', default: '<p>Default body</p>', kind: 'rich' }]);
  });

  it('extracts data-sw-href regions as kind "link"', () => {
    const regions = extractRegions('<a data-sw-href="cta" href="/x">Click</a>');
    expect(regions.find((r) => r.key === 'cta')).toEqual({ key: 'cta', default: '', kind: 'link' });
  });

  it('extracts data-sw-src regions as kind "image"', () => {
    const regions = extractRegions('<img data-sw-src="hero" src="/x.png" />');
    expect(regions.find((r) => r.key === 'hero')).toEqual({ key: 'hero', default: '', kind: 'image' });
  });

  it('extracts data-sw-bg regions as kind "bg"', () => {
    const regions = extractRegions('<div data-sw-bg="banner"></div>');
    expect(regions.find((r) => r.key === 'banner')).toEqual({ key: 'banner', default: '', kind: 'bg' });
  });

  it('deduplicates regions by key (first occurrence wins)', () => {
    const src = '<p data-sw-text="k">First</p><p data-sw-text="k">Second</p>';
    const regions = extractRegions(src);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.default).toBe('First');
  });

  it('returns an empty array when no directives are present', () => {
    expect(extractRegions('<div><h1>Static</h1></div>')).toHaveLength(0);
    expect(extractRegions('')).toHaveLength(0);
  });
});

describe('extractClassNames', () => {
  it('extracts tokens from class attributes', () => {
    const classes = extractClassNames('<div class="flex gap-4 text-blue-500">x</div>');
    expect(classes).toEqual(['flex', 'gap-4', 'text-blue-500']);
  });

  it('deduplicates tokens across multiple elements', () => {
    const classes = extractClassNames('<div class="flex"><span class="flex gap-4">x</span></div>');
    expect(classes.filter((c) => c === 'flex')).toHaveLength(1);
    expect(classes).toContain('gap-4');
  });

  it('strips Handlebars expressions from class values before tokenizing', () => {
    const classes = extractClassNames('<div class="p-4 {{ dynamicClass }} text-sm">x</div>');
    expect(classes).toContain('p-4');
    expect(classes).toContain('text-sm');
    expect(classes.every((c) => !c.includes('{{'))).toBe(true);
  });

  it('returns an empty array when there are no class attributes', () => {
    expect(extractClassNames('<div>x</div>')).toHaveLength(0);
    expect(extractClassNames('')).toHaveLength(0);
  });

  it('extracts the class argument of {{sw-icon}} and {{sw-flag}} helper calls', () => {
    const classes = extractClassNames(
      '<button>{{sw-icon "chevron-left" "size-6 drop-shadow-lg"}}</button>' +
        "<span>{{sw-flag 'de' 'size-4 rounded'}}</span>",
    );
    expect(classes).toEqual(expect.arrayContaining(['size-6', 'drop-shadow-lg', 'size-4', 'rounded']));
  });

  it('ignores {{sw-icon}} calls without a class argument', () => {
    expect(extractClassNames('{{sw-icon "x"}}')).toHaveLength(0);
  });

  it('handles mixed quote styles across the two helper arguments', () => {
    expect(extractClassNames('{{sw-icon \'menu\' "size-5 shrink-0"}}')).toEqual(
      expect.arrayContaining(['size-5', 'shrink-0']),
    );
  });

  it('caps the result at max tokens (default MAX_EXTRACTED_CLASS_TOKENS)', () => {
    // Build a source with more than max unique classes
    const src = Array.from({ length: MAX_EXTRACTED_CLASS_TOKENS + 10 }, (_, i) => `c${i}`).join(' ');
    const classes = extractClassNames(`<div class="${src}">x</div>`);
    expect(classes.length).toBe(MAX_EXTRACTED_CLASS_TOKENS);
  });

  it('respects a custom max parameter', () => {
    const src = '<div class="a b c d e">x</div>';
    expect(extractClassNames(src, 3)).toHaveLength(3);
  });
});
