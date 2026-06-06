import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Page } from '@sitewright/schema';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage } from '../src/views/PageSettingsModal';

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

  it('round-trips locale and preserves the translation group it does not edit', () => {
    const de: Page = {
      id: 'about-de',
      path: '/de/about',
      title: 'Über uns',
      status: 'published',
      root: { id: 'r', type: 'Section' },
      locale: 'de',
      translationGroup: 'about', // set by "Add translation", NOT by this modal
    };
    expect(applyPageSettings(de, pageSettingsFromPage(de))).toEqual(de);
  });

  it('clears the locale back to the project default (empty → undefined)', () => {
    const de: Page = {
      id: 'about-de',
      path: '/de/about',
      title: 'Über uns',
      status: 'published',
      root: { id: 'r', type: 'Section' },
      locale: 'de',
      translationGroup: 'about',
    };
    const next = applyPageSettings(de, { ...pageSettingsFromPage(de), locale: '' });
    expect(next.locale).toBeUndefined(); // default locale stored as absence
    expect(next.translationGroup).toBe('about'); // group untouched
  });
});

describe('PageSettingsModal parent selector — home is the tree root', () => {
  const home: Page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };
  const other: Page = { id: 'about', path: '/about', title: 'About', root: { id: 'r', type: 'Section' } };

  it('offers no "None" choice for a non-home page and defaults + submits Home', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={other} initial={pageSettingsFromPage(other)} pages={[home, other]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    const select = screen.getByLabelText('Parent page') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).some((o) => /none/i.test(o.text))).toBe(false); // no top-level escape
    expect(select.value).toBe('home'); // defaults to the home root
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ parent: 'home' }));
  });

  it('keeps the home page itself parentless (selector disabled)', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={home} initial={pageSettingsFromPage(home)} pages={[home, other]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    expect((screen.getByLabelText('Parent page') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ parent: '' }));
  });
});
