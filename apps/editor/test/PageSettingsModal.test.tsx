import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { applyPageSettings, pageSettingsFromPage } from '../src/views/PageSettingsModal';

const base: Page = {
  id: 'about',
  path: '/about',
  title: 'About',
  // Explicit status: applyPageSettings always writes one (absent = published in the
  // schema), so the round-trip normalizes to the explicit form.
  status: 'published',
  root: { id: 'r', type: 'Section' },
  seo: { title: 'SEO title', noindex: true, description: 'old description' },
  nav: { slots: ['header'], order: 2, dropdown: true },
  parent: 'home',
  template: 'global:text',
};

describe('pageSettingsFromPage ⇄ applyPageSettings', () => {
  it('round-trips a fully-configured page unchanged', () => {
    expect(applyPageSettings(base, pageSettingsFromPage(base))).toEqual(base);
  });

  it('drops cleared fields and keeps unmanaged SEO fields intact', () => {
    const values = {
      ...pageSettingsFromPage(base),
      seoDescription: '', // cleared
      seoOgImage: 'https://x.test/og.png', // set
      parent: '', // cleared
      template: '', // cleared
      navSlots: [], // cleared → whole nav object drops (incl. dropdown)
    };
    const next = applyPageSettings(base, values);
    // Unmanaged SEO fields survive; the cleared description is GONE (not '').
    expect(next.seo).toEqual({ title: 'SEO title', noindex: true, ogImage: 'https://x.test/og.png' });
    expect(next.parent).toBeUndefined();
    expect(next.template).toBeUndefined();
    expect(next.nav).toBeUndefined();
    // The input page was not mutated (immutability contract).
    expect(base.seo?.description).toBe('old description');
    expect(base.nav?.dropdown).toBe(true);
  });

  it('emits dropdown only when true and an entirely-empty seo as undefined', () => {
    const plain: Page = { id: 'p', path: '/p', title: 'P', root: { id: 'r', type: 'Section' } };
    const values = { ...pageSettingsFromPage(plain), navSlots: ['header' as const], navDropdown: false };
    const next = applyPageSettings(plain, values);
    expect(next.nav).toEqual({ slots: ['header'], order: 0 }); // no `dropdown: false` noise
    expect(next.seo).toBeUndefined(); // nothing set → no empty object persisted
  });
});
