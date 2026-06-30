import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { referencesPages, referencedPagePaths, pagesContext, MAX_PAGES_NODES } from '../src/index.js';

const page = (over: Partial<Page>): Page => ({ id: 'p', path: '', title: 'T', ...over }) as Page;

/** Walk a built `pages` object by keys without leaning on `any` (the nodes are plain nested records). */
const dig = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], o);

// A small bilingual tree:
//   home("")            de-home("de", group=home, locale=de)
//     services            de-services("leistungen", group=services, locale=de)
//       seo("seo")          de-seo("seo", group=service-seo, locale=de)
const PAGES: Page[] = [
  page({ id: 'home', path: '', title: 'Home', data: { home_x: 'H' } }),
  page({ id: 'services', path: 'services', parent: 'home', title: 'Services', data: { svc_title: 'Our Services' } }),
  page({ id: 'service-seo', path: 'seo', parent: 'services', title: 'SEO', data: { header_title: 'SEO & Performance' } }),
  page({ id: 'de-home', path: 'de', parent: 'home', locale: 'de', translationGroup: 'home', title: 'Start', data: {} }),
  page({ id: 'de-services', path: 'leistungen', parent: 'de-home', locale: 'de', translationGroup: 'services', title: 'Leistungen', data: { svc_title: 'Unsere Leistungen' } }),
  page({ id: 'de-seo', path: 'seo', parent: 'de-services', locale: 'de', translationGroup: 'service-seo', title: 'SEO', data: { header_title: 'SEO & Leistung' } }),
];
const home = PAGES[0]!;
const deHome = PAGES[3]!;

describe('referencesPages (gate)', () => {
  it('matches a real pages binding only', () => {
    expect(referencesPages('{{pages.services.seo._attributes.data.x}}')).toBe(true);
    expect(referencesPages('{{ pages.services._attributes.path }}')).toBe(true);
    expect(referencesPages('{{pages._attributes.data.x}}')).toBe(true); // _attributes hop fires the gate
    expect(referencesPages('{{pages.[web-design]._attributes.data.x}}')).toBe(true); // bracketed slug
    expect(referencesPages('{{#with pages}}…{{/with}}')).toBe(true); // bare object
    expect(referencesPages('mypages.x')).toBe(false); // preceded by an identifier
    expect(referencesPages('a.pages.x')).toBe(false); // preceded by a dot
    expect(referencesPages('subpages-thing')).toBe(false);
    // PROSE must NOT trip the gate (it would needlessly build a node on every content page):
    expect(referencesPages('<p>Our pages are fast.</p>')).toBe(false); // "pages " + whitespace
    expect(referencesPages('<p>Browse the pages.</p>')).toBe(false); // "pages." sentence-end (bare dot)
    expect(referencesPages('')).toBe(false);
    expect(referencesPages(undefined)).toBe(false);
  });
});

describe('referencedPagePaths', () => {
  it('extracts dotted + bracketed chains (incl. the _attributes hop)', () => {
    const chains = referencedPagePaths('{{pages.services.seo._attributes.data.header_title}} {{sw-url pages.[web-design]._attributes.path}}');
    expect(chains).toEqual([
      ['services', 'seo', '_attributes', 'data', 'header_title'],
      ['web-design', '_attributes', 'path'],
    ]);
  });
});

describe('pagesContext', () => {
  it('walks the tree by slug and exposes a node’s own fields under _attributes', () => {
    const ctx = pagesContext(PAGES, home, 'en', '{{pages.services.seo._attributes.data.header_title}} {{pages.services._attributes.path}}');
    expect(dig(ctx, 'services', 'seo', '_attributes', 'data', 'header_title')).toBe('SEO & Performance');
    expect(dig(ctx, 'services', '_attributes', 'title')).toBe('Services');
    expect(dig(ctx, 'services', '_attributes', 'path')).toBe('/services');
    expect(dig(ctx, 'services', 'seo', '_attributes', 'path')).toBe('/services/seo');
  });

  it('exposes the HOME node’s own fields under pages._attributes', () => {
    const ctx = pagesContext(PAGES, home, 'en', '{{pages._attributes.title}} {{pages._attributes.data.home_x}}');
    expect(dig(ctx, '_attributes', 'title')).toBe('Home');
    expect(dig(ctx, '_attributes', 'data', 'home_x')).toBe('H');
  });

  it('resolves to the CURRENT page locale (German slugs + German data)', () => {
    const ctx = pagesContext(PAGES, deHome, 'en', '{{pages.leistungen.seo._attributes.data.header_title}}');
    expect(dig(ctx, 'leistungen', 'seo', '_attributes', 'data', 'header_title')).toBe('SEO & Leistung');
    expect(dig(ctx, 'leistungen', '_attributes', 'title')).toBe('Leistungen');
    // the English slug path does NOT resolve on a German page
    const enOnDe = pagesContext(PAGES, deHome, 'en', '{{pages.services.seo._attributes.data.header_title}}');
    expect(dig(enOnDe, 'services')).toBeUndefined();
  });

  it('is referenced-only: an unreferenced page is absent; data is gated to _attributes.data uses', () => {
    const ctx = pagesContext(PAGES, home, 'en', '{{pages.services._attributes.path}}');
    expect(dig(ctx, 'services')).toBeDefined();
    expect(dig(ctx, 'services', '_attributes', 'path')).toBe('/services');
    expect(dig(ctx, 'services', '_attributes', 'data')).toEqual({}); // .data not referenced → empty (payload gate)
    expect(dig(ctx, 'services', 'seo')).toBeUndefined(); // seo never referenced
  });

  it('exposes _attributes.children (same view as page.children) so another page can list a subtree', () => {
    // The home page lists the services page's children via pages.services._attributes.children.
    const ctx = pagesContext(PAGES, home, 'en', '{{#each pages.services._attributes.children}}{{path}}{{/each}}');
    const kids = dig(ctx, 'services', '_attributes', 'children') as Array<Record<string, unknown>>;
    expect(Array.isArray(kids)).toBe(true);
    expect(kids.map((k) => k.path)).toEqual(['/services/seo']); // the one child of /services, full route
    expect(kids[0]!.title).toBe('SEO');
    // children is GATED to referenced uses: when not referenced it is an empty array.
    const unref = pagesContext(PAGES, home, 'en', '{{pages.services._attributes.path}}');
    expect(dig(unref, 'services', '_attributes', 'children')).toEqual([]);
  });

  it('exposes a node’s image + description under _attributes (always present, like title)', () => {
    const withMeta = [...PAGES, page({ id: 'about', path: 'about', title: 'About', description: 'Who we are', image: '/media/og.jpg' })];
    const ctx = pagesContext(withMeta, home, 'en', '{{pages.about._attributes.image}} {{pages.about._attributes.description}} {{pages.services._attributes.image}}');
    expect(dig(ctx, 'about', '_attributes', 'image')).toBe('/media/og.jpg');
    expect(dig(ctx, 'about', '_attributes', 'description')).toBe('Who we are');
    expect(dig(ctx, 'services', '_attributes', 'image')).toBe(''); // present-but-empty when the page has none
  });

  it('exposes a node’s template id (always) and its own code (gated)', () => {
    const withCode = [...PAGES, page({ id: 'tpl', path: 'tpl', parent: 'home', title: 'T', template: 'global:hero', source: '<h1>raw</h1>' })];
    const ctx = pagesContext(withCode, home, 'en', '{{pages.tpl._attributes.template}} {{pages.tpl._attributes.code}}');
    expect(dig(ctx, 'tpl', '_attributes', 'template')).toBe('global:hero');
    expect(dig(ctx, 'tpl', '_attributes', 'code')).toBe('<h1>raw</h1>');
    // template is ALWAYS present; code is GATED (large) → empty when not referenced.
    const unref = pagesContext(withCode, home, 'en', '{{pages.tpl._attributes.title}}');
    expect(dig(unref, 'tpl', '_attributes', 'template')).toBe('global:hero');
    expect(dig(unref, 'tpl', '_attributes', 'code')).toBe('');
  });

  it('ANY slug is reachable — a page slugged exactly "data" never clashes with a node’s own data', () => {
    // No reserved words / no SEO restriction: a top-level page may be slugged "data".
    const withData = [...PAGES, page({ id: 'datapage', path: 'data', parent: 'home', title: 'Data Page', data: { secret: 1 } })];
    const ctx = pagesContext(
      withData,
      home,
      'en',
      '{{pages.data._attributes.title}} {{pages.data._attributes.data.secret}} {{pages._attributes.data.home_x}} {{pages.services._attributes.data.svc_title}}',
    );
    // the child page slugged "data" is reachable and unambiguous
    expect(dig(ctx, 'data', '_attributes', 'title')).toBe('Data Page');
    expect(dig(ctx, 'data', '_attributes', 'data', 'secret')).toBe(1);
    // home's OWN data is under pages._attributes — NEVER shadowed by the "data" page
    expect(dig(ctx, '_attributes', 'data', 'home_x')).toBe('H');
    // a normal page's data still resolves via _attributes
    expect(dig(ctx, 'services', '_attributes', 'data', 'svc_title')).toBe('Our Services');
  });

  it('reaches a ROOT-LEVEL sibling of home (not just home’s children) — the import structure', () => {
    // `contact` is a top-level page with NO parent (a sibling of home), like an imported site's pages.
    const withSibling = [...PAGES, page({ id: 'contact', path: 'contact', title: 'Contact', data: { phone: '123' } })];
    const ctx = pagesContext(withSibling, home, 'en', '{{pages.contact._attributes.data.phone}} {{#each pages.services._attributes.children}}{{path}}{{/each}}');
    expect(dig(ctx, 'contact', '_attributes', 'data', 'phone')).toBe('123'); // root sibling resolves
    expect((dig(ctx, 'services', '_attributes', 'children') as Array<Record<string, unknown>>).map((k) => k.path)).toEqual(['/services/seo']);
  });

  it('returns undefined when pages is not referenced or the locale has no home', () => {
    expect(pagesContext(PAGES, home, 'en', '<p>no refs</p>')).toBeUndefined();
    expect(pagesContext(PAGES, page({ id: 'x', locale: 'fr' }), 'en', '{{pages.x}}')).toBeUndefined();
  });

  it('caps total nodes built', () => {
    // a wide tree of siblings, all referenced
    const many: Page[] = [home];
    let src = '';
    for (let i = 0; i < MAX_PAGES_NODES + 50; i++) {
      many.push(page({ id: `n${i}`, path: `n${i}`, parent: 'home', title: `N${i}`, data: {} }));
      src += `{{pages.n${i}._attributes.path}}`;
    }
    const ctx = pagesContext(many, home, 'en', src) as Record<string, unknown>;
    const built = Object.keys(ctx).filter((k) => k.startsWith('n')).length;
    expect(built).toBeLessThanOrEqual(MAX_PAGES_NODES);
  });
});
