import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { buildNav } from '../src/index.js';

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
      { label: 'About', path: '/about' }, // nav.title overrides page title
    ]);
    expect(buildNav(pages, 'footer')).toEqual([{ label: 'Contact', path: '/contact' }]);
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

  it('excludes collection pages', () => {
    const pages = [
      page({ id: 'c', path: '[slug]', title: 'C', collection: { dataset: 'd', param: 'slug' }, nav: { slots: ['header'] } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([]);
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
        path: '/services',
        children: [
          { label: 'Web', path: '/services/web' },
          { label: 'SEO', path: '/services/seo' },
        ],
      },
      { label: 'About', path: '/about' }, // a nested child ('web') never ALSO appears flat
    ]);
  });

  it('children stay flat (own slots required) when the parent has no dropdown', () => {
    const pages = [
      page({ id: 'services', path: 'services', title: 'Services', nav: { slots: ['header'], order: 1 } }),
      page({ id: 'web', path: 'web', title: 'Web', parent: 'services', nav: { slots: ['header'], order: 2 } }),
      page({ id: 'silent', path: 'silent', title: 'Silent', parent: 'services' }), // no slots → absent
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Services', path: '/services' },
      { label: 'Web', path: '/services/web' },
    ]);
  });

  it('a dropdown parent with no children renders as a plain item', () => {
    const pages = [page({ id: 'p1', path: 'p1', title: 'P1', nav: { slots: ['header'], dropdown: true } })];
    expect(buildNav(pages, 'header')).toEqual([{ label: 'P1', path: '/p1' }]);
  });

  it('resolves a link placeholder href from link.target (external/mailto/anchor/internal)', () => {
    const pages = [
      page({ id: 'ext', kind: 'link', title: 'Docs', link: { target: 'https://x.test', newTab: true }, nav: { slots: ['header'], order: 1 } }),
      page({ id: 'mail', kind: 'link', title: 'Mail', link: { target: 'mailto:a@b.test' }, nav: { slots: ['header'], order: 2 } }),
      page({ id: 'anch', kind: 'link', title: 'Top', link: { target: '#top' }, nav: { slots: ['header'], order: 3 } }),
      page({ id: 'int', kind: 'link', title: 'About', link: { target: '/about' }, nav: { slots: ['header'], order: 4 } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Docs', rich: true, path: 'https://x.test', external: true, newTab: true },
      { label: 'Mail', rich: true, path: 'mailto:a@b.test', external: true },
      { label: 'Top', rich: true, path: '#top' }, // fragment: runtime opens a <dialog> or smooth-scrolls
      { label: 'About', rich: true, path: '/about' }, // internal path: rebased per page at render
    ]);
  });

  it('an empty-target link is a pure dropdown-parent label ("#") that still nests children', () => {
    const pages = [
      page({ id: 'grp', kind: 'link', title: 'Group', link: { target: '' }, nav: { slots: ['header'], dropdown: true } }),
      // Child route skips the routing-transparent link parent (its path is ''): /a, not /grp/a.
      page({ id: 'a', path: 'a', title: 'A', parent: 'grp', nav: { slots: ['footer'] } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'Group', rich: true, path: '#', children: [{ label: 'A', path: '/a' }] },
    ]);
  });

  it('a link placeholder can be BOTH a dropdown parent AND a link target', () => {
    const pages = [
      page({ id: 'p', kind: 'link', title: 'P', link: { target: 'https://x.test' }, nav: { slots: ['header'], dropdown: true } }),
      page({ id: 'c', path: 'c', title: 'C', parent: 'p', nav: { slots: ['header'] } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([
      { label: 'P', rich: true, path: 'https://x.test', external: true, children: [{ label: 'C', path: '/c' }] },
    ]);
  });
});
