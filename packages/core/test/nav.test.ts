import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { buildNav } from '../src/index.js';

// `path` is a SLUG SEGMENT; the full route is computed from the parent chain (pagePath),
// so the expected NavItem.path values below are the COMPUTED routes.
const page = (over: Partial<Page>): Page =>
  ({ id: 'p', path: '', title: 'T', root: { id: 'r', type: 'Section' }, ...over }) as Page;

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
});
