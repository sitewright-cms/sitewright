import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { buildNav } from '../src/index.js';

const page = (over: Partial<Page>): Page =>
  ({ id: 'p', path: '/', title: 'T', root: { id: 'r', type: 'Section' }, ...over }) as Page;

describe('buildNav', () => {
  it('includes only pages whose nav.slots contains the slot, with label fallback', () => {
    const pages = [
      page({ id: 'home', path: '/', title: 'Home', nav: { slots: ['header'], order: 0 } }),
      page({ id: 'about', path: '/about', title: 'About Page', nav: { title: 'About', slots: ['header'], order: 1 } }),
      page({ id: 'contact', path: '/contact', title: 'Contact', nav: { slots: ['footer'] } }),
      page({ id: 'hidden', path: '/hidden', title: 'Hidden' }),
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
      page({ id: 'b', path: '/b', title: 'Bravo', nav: { slots: ['header'], order: 2 } }),
      page({ id: 'a', path: '/a', title: 'Alpha', nav: { slots: ['header'], order: 1 } }),
      page({ id: 'z', path: '/z', title: 'Zeta', nav: { slots: ['header'], order: 1 } }),
    ];
    expect(buildNav(pages, 'header').map((i) => i.label)).toEqual(['Alpha', 'Zeta', 'Bravo']);
  });

  it('excludes collection pages', () => {
    const pages = [
      page({ id: 'c', path: '/x/[slug]', title: 'C', collection: { dataset: 'd', param: 'slug' }, nav: { slots: ['header'] } }),
    ];
    expect(buildNav(pages, 'header')).toEqual([]);
  });
});
