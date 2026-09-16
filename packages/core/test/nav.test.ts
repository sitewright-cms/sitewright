import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { buildNav, isRichNavLabel, plainNavLabel } from '../src/index.js';
import { GLOBAL_SNIPPET_PARTIALS } from '../src/global-snippets.js';

// `path` is a SLUG SEGMENT; the full route is computed from the parent chain (pagePath),
// so the expected NavItem.path values below are the COMPUTED routes.
const page = (over: Partial<Page>): Page =>
  ({ id: 'p', path: '', title: 'T', ...over }) as Page;

describe('buildNav', () => {
  it('includes only pages whose nav.slots contains the slot, with label fallback', () => {
    const pages = [
      page({ id: 'home', path: '', title: 'Home', nav: { slots: ['header'], order: 0 } }),
      page({ id: 'about', path: 'about', parent: 'home', title: 'About Page', nav: { title: 'About', slots: ['header'], order: 1 } }),
      page({ id: 'contact', path: 'contact', parent: 'home', title: 'Contact', nav: { slots: ['footer'] } }),
      page({ id: 'hidden', path: 'hidden', parent: 'home', title: 'Hidden' }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Home', path: '/' },
      { label: 'About', path: '/about/' }, // nav.title overrides page title
    ]);
    expect(buildNav(pages, 'footer')).toEqual([{ label: 'Contact', path: '/contact/' }]);
    expect(buildNav(pages, 'mobile')).toEqual([]);
  });

  it('sorts by order then title', () => {
    const pages = [
      page({ id: 'b', path: 'b', title: 'Bravo', nav: { slots: ['header'], order: 2 } }),
      page({ id: 'a', path: 'a', title: 'Alpha', nav: { slots: ['header'], order: 1 } }),
      page({ id: 'z', path: 'z', title: 'Zeta', nav: { slots: ['header'], order: 1 } }),
    ];
    expect(buildNav(pages, 'header').map((i) => i.label)).toEqual(['Alpha', 'Zeta', 'Bravo']);
  });

  it('nests child pages under a dropdown parent (no own slots needed), ordered by nav.order', () => {
    const pages = [
      page({ id: 'services', path: 'services', title: 'Services', nav: { slots: ['header'], order: 1, dropdown: true } }),
      // Children: NO nav.slots of their own — nested purely via `parent`.
      page({ id: 'seo', path: 'seo', title: 'SEO', parent: 'services', nav: { slots: ['footer'], order: 2 } }),
      page({ id: 'web', path: 'web', title: 'Web', parent: 'services', nav: { slots: ['header'], order: 1 } }),
      page({ id: 'about', path: 'about', title: 'About', nav: { slots: ['header'], order: 2 } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      {
        label: 'Services',
        path: '/services/',
        children: [
          { label: 'Web', path: '/services/web/' },
          { label: 'SEO', path: '/services/seo/' },
        ],
      },
      { label: 'About', path: '/about/' }, // a nested child ('web') never ALSO appears flat
    ]);
  });

  it('children stay flat (own slots required) when the parent has no dropdown', () => {
    const pages = [
      page({ id: 'services', path: 'services', title: 'Services', nav: { slots: ['header'], order: 1 } }),
      page({ id: 'web', path: 'web', title: 'Web', parent: 'services', nav: { slots: ['header'], order: 2 } }),
      page({ id: 'silent', path: 'silent', title: 'Silent', parent: 'services' }), // no slots → absent
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Services', path: '/services/' },
      { label: 'Web', path: '/services/web/' },
    ]);
  });

  it('a dropdown parent with no children renders as a plain item', () => {
    const pages = [page({ id: 'p1', path: 'p1', title: 'P1', nav: { slots: ['header'], dropdown: true } })];
    expect(buildNav(pages, 'header')).toEqual([{ label: 'P1', path: '/p1/' }]);
  });

  it('resolves a link placeholder href from link.target (external/mailto/anchor/internal)', () => {
    const pages = [
      page({ id: 'ext', kind: 'link', title: 'Docs', link: { target: 'https://x.test', newTab: true }, nav: { slots: ['header'], order: 1 } }),
      page({ id: 'mail', kind: 'link', title: 'Mail', link: { target: 'mailto:a@b.test' }, nav: { slots: ['header'], order: 2 } }),
      page({ id: 'anch', kind: 'link', title: 'Top', link: { target: '#top' }, nav: { slots: ['header'], order: 3 } }),
      page({ id: 'int', kind: 'link', title: 'About', link: { target: '/about' }, nav: { slots: ['header'], order: 4 } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Docs', rich: true, placeholder: true, path: 'https://x.test', external: true, newTab: true },
      { label: 'Mail', rich: true, placeholder: true, path: 'mailto:a@b.test', external: true },
      { label: 'Top', rich: true, placeholder: true, path: '#top' }, // fragment: runtime opens a <dialog> or smooth-scrolls
      { label: 'About', rich: true, placeholder: true, path: '/about' }, // internal path: rebased per page at render
    ]);
  });

  it('an empty-target link is a pure dropdown-parent label ("#") that still nests children', () => {
    const pages = [
      page({ id: 'grp', kind: 'link', title: 'Group', link: { target: '' }, nav: { slots: ['header'], dropdown: true } }),
      // Child route skips the routing-transparent link parent (its path is ''): /a, not /grp/a.
      page({ id: 'a', path: 'a', title: 'A', parent: 'grp', nav: { slots: ['footer'] } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Group', rich: true, placeholder: true, path: '#', children: [{ label: 'A', path: '/a/' }] },
    ]);
  });

  it('a link placeholder can be BOTH a dropdown parent AND a link target', () => {
    const pages = [
      page({ id: 'p', kind: 'link', title: 'P', link: { target: 'https://x.test' }, nav: { slots: ['header'], dropdown: true } }),
      page({ id: 'c', path: 'c', title: 'C', parent: 'p', nav: { slots: ['header'] } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'P', rich: true, placeholder: true, path: 'https://x.test', external: true, children: [{ label: 'C', path: '/c/' }] },
    ]);
  });
});

describe('nav-header recipe — mobile drawer viewport height', () => {
  // A sticky-header ENTRANCE animation puts a transform on #main-nav, which makes it the containing
  // block for its position:fixed children — so the slide-in drawer + backdrop MUST pin their own
  // viewport height (h-dvh), else they get clamped to the header's height. (Regression: the mobile
  // nav rendered ~71px tall instead of full screen.)
  it('pins the slide-in drawer panel + backdrop to h-dvh', () => {
    const src = GLOBAL_SNIPPET_PARTIALS['nav-header'];
    expect(src).toBeTruthy();
    expect(src).toMatch(/fixed inset-0 h-dvh[^"]*bg-black\/40/); // backdrop
    expect(src).toMatch(/fixed inset-y-0 left-0 h-dvh[^"]*w-72/); // slide-in panel
  });
});

describe('nav items carry enough to build a MENU, not just a list of titles', () => {
  const nav = (over: Partial<Page> = {}): Page =>
    ({ id: 'about', path: 'about', title: 'About', nav: { slots: ['header'] }, ...over }) as Page;

  it('carries a page description so a dropdown can gloss each link', () => {
    const [item] = buildNav([nav({ description: 'Who runs the school.' })], 'header');
    expect(item).toBeDefined();
    expect(item!.description).toBe('Who runs the school.');
  });

  it('carries the page image so a dropdown can show a feature card', () => {
    const [item] = buildNav([nav({ image: '/media/x/hero.jpg' })], 'header');
    expect(item).toBeDefined();
    expect(item!.image).toBe('/media/x/hero.jpg');
  });

  it('OMITS both when absent — every item lands in every page context, so empties are pure weight', () => {
    const [item] = buildNav([nav()], 'header');
    expect(item).toBeDefined();
    expect('description' in item!).toBe(false);
    expect('image' in item!).toBe(false);
  });

  it('gives dropdown CHILDREN the same fields — a mega menu renders children, not parents', () => {
    const parent = nav({ id: 'learning', path: 'learning', title: 'Learning', nav: { slots: ['header'], dropdown: true } });
    const child = nav({ id: 'dia', path: 'dia', title: 'DIA', parent: 'learning', description: 'The Abitur route.', image: '/media/x/dia.jpg', nav: { slots: [] } });
    const [item] = buildNav([parent, child], 'header');
    expect(item).toBeDefined();
    expect(item!.children?.[0]?.description).toBe('The Abitur route.');
    expect(item!.children?.[0]?.image).toBe('/media/x/dia.jpg');
  });

  it('a link PLACEHOLDER gains neither — it has no page to take them from', () => {
    const ph = ({ id: 'grp', path: 'grp', title: 'Group', kind: 'link', link: { target: '/x' }, nav: { slots: ['header'] } }) as unknown as Page;
    const [item] = buildNav([ph], 'header');
    expect(item).toBeDefined();
    expect('description' in item!).toBe(false);
    expect('image' in item!).toBe(false);
  });
});

describe('nav.hidden — a child that is not a menu entry', () => {
  const parent = ({ id: 'news-events', path: 'news-events', title: 'News & Events', nav: { slots: ['header'], dropdown: true } }) as unknown as Page;
  const child = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, path: id, title: id, parent: 'news-events', ...over }) as unknown as Page;

  it('keeps a hidden child OUT of its parent dropdown, while ordinary children still fold in', () => {
    // A dropdown folds in every child by design; a paginated archive therefore put 40 "page N" entries
    // into the mega menu. `hidden` is the opt-out that did not exist.
    const [item] = buildNav([parent, child('news'), child('news-2', { nav: { hidden: true } })], 'header');
    expect(item).toBeDefined();
    expect(item!.children?.map((c) => c.label)).toEqual(['news']);
  });

  it('keeps a hidden page out of a FLAT slot too, even when it claims one', () => {
    const p = ({ id: 'x', path: 'x', title: 'X', nav: { slots: ['header'], hidden: true } }) as unknown as Page;
    expect(buildNav([p], 'header')).toEqual([]);
  });

  it('a nav object may carry hidden with NO slots — that combination used to be invalid', () => {
    const [item] = buildNav([parent, child('news-2', { nav: { hidden: true } }), child('calendar')], 'header');
    expect(item).toBeDefined();
    expect(item!.children?.map((c) => c.label)).toEqual(['calendar']);
  });
});

describe('a page MENU LABEL may be rich (HTML + {{sw-icon}}), like a link placeholder name', () => {
  const p = (navTitle?: string, over: Partial<Page> = {}): Page =>
    ({ id: 'about', path: 'about', title: 'About', nav: { slots: ['header'], ...(navTitle === undefined ? {} : { title: navTitle }) }, ...over }) as Page;

  it('marks a menu label carrying an icon helper as rich', () => {
    const [item] = buildNav([p('{{sw-icon "house"}} Home')], 'header');
    expect(item).toEqual({ label: '{{sw-icon "house"}} Home', rich: true, path: '/about/' });
  });

  it('marks a menu label carrying HTML as rich', () => {
    const [item] = buildNav([p('<span class="flex gap-2">Shop</span>')], 'header');
    expect(item!.rich).toBe(true);
  });

  it('leaves a PLAIN menu label alone — no rich flag, so it takes the escape path unchanged', () => {
    const [item] = buildNav([p('Über uns & mehr')], 'header');
    expect(item).toEqual({ label: 'Über uns & mehr', path: '/about/' });
    expect('rich' in item!).toBe(false);
  });

  it('NEVER marks the page TITLE fallback rich — the title is <title>/og/sitemap text, not menu markup', () => {
    // Markup in a page title is a mistake, not an opt-in: rendering it would change the document title
    // and every SEO surface. Only the dedicated Menu label opts in.
    const [item] = buildNav([p(undefined, { title: '{{sw-icon "house"}} Home' })], 'header');
    expect(item!.label).toBe('{{sw-icon "house"}} Home');
    expect('rich' in item!).toBe(false);
  });

  it('applies to a dropdown CHILD too — a mega menu renders children, not just parents', () => {
    const parent = ({ id: 'l', path: 'l', title: 'Learning', nav: { slots: ['header'], dropdown: true } }) as Page;
    const child = ({ id: 'c', path: 'c', title: 'DIA', parent: 'l', nav: { title: '{{sw-icon "star"}} DIA' } }) as Page;
    const [item] = buildNav([parent, child], 'header');
    expect(item!.children?.[0]?.rich).toBe(true);
  });

  it('is NOT a placeholder — a rich-labelled page is still the page, so {{sw-active}} can mark it', () => {
    const [item] = buildNav([p('{{sw-icon "house"}} Home')], 'header');
    expect('placeholder' in item!).toBe(false);
  });
});

describe('isRichNavLabel', () => {
  it('is true only for a label carrying HTML or a {{…}} helper', () => {
    expect(isRichNavLabel('{{sw-icon "house"}} Home')).toBe(true);
    expect(isRichNavLabel('<b>Home</b>')).toBe(true);
    expect(isRichNavLabel('Home')).toBe(false);
    expect(isRichNavLabel('Fish & Chips')).toBe(false);
    expect(isRichNavLabel('')).toBe(false);
  });
});

describe('plainNavLabel', () => {
  it('strips helpers, tags and entities down to readable text', () => {
    expect(plainNavLabel('<span class="flex">{{sw-icon "house"}} Home</span>')).toBe('Home');
    expect(plainNavLabel('{{sw-flag "de"}}&nbsp;Deutsch')).toBe('Deutsch');
  });

  it('leaves plain text exactly alone — including interior spacing', () => {
    expect(plainNavLabel('News  &  Events')).toBe('News  &  Events');
  });
});
