import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Page } from '@sitewright/schema';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage } from '../src/views/PageSettingsModal';

const base: Page = {
  id: 'about',
  path: 'about',
  title: 'About',
  // Explicit status: applyPageSettings always writes one (absent = published in the
  // schema), so the round-trip normalizes to the explicit form.
  status: 'published',
  root: { id: 'r', type: 'Section' },
  // Flat SEO fields: description/image are managed by the modal; noindex is NOT (it passes through).
  noindex: true,
  description: 'old description',
  nav: { slots: ['header'], order: 2, dropdown: true },
  parent: 'home',
  template: 'global:text',
};

describe('pageSettingsFromPage ⇄ applyPageSettings', () => {
  it('round-trips a fully-configured page unchanged', () => {
    expect(applyPageSettings(base, pageSettingsFromPage(base))).toEqual(base);
  });

  it('drops cleared SEO fields and leaves unmanaged page fields intact', () => {
    const values = {
      ...pageSettingsFromPage(base),
      description: '', // cleared
      image: 'https://x.test/og.png', // set
      parent: '', // cleared
      template: '', // cleared
      navSlots: [], // cleared → whole nav object drops (incl. dropdown)
    };
    const next = applyPageSettings(base, values);
    // The cleared description is GONE (not ''); the set image persists.
    expect(next.description).toBeUndefined();
    expect(next.image).toBe('https://x.test/og.png');
    // The unmanaged flat page field (noindex) passes through untouched.
    expect(next.noindex).toBe(true);
    expect(next.parent).toBeUndefined();
    expect(next.template).toBeUndefined();
    expect(next.nav).toBeUndefined();
    // The input page was not mutated (immutability contract).
    expect(base.description).toBe('old description');
    expect(base.nav?.dropdown).toBe(true);
  });

  it('emits dropdown only when true and drops empty SEO fields', () => {
    const plain: Page = { id: 'p', path: 'p', title: 'P', root: { id: 'r', type: 'Section' } };
    const values = { ...pageSettingsFromPage(plain), navSlots: ['header' as const], navDropdown: false };
    const next = applyPageSettings(plain, values);
    expect(next.nav).toEqual({ slots: ['header'], order: 0 }); // no `dropdown: false` noise
    expect(next.description).toBeUndefined(); // nothing set → no empty field persisted
    expect(next.image).toBeUndefined();
  });

  it('round-trips locale and preserves the translation group it does not edit', () => {
    const de: Page = {
      id: 'about-de',
      path: 'about',
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
      path: 'about',
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

describe('PageSettingsModal — link placeholders (kind:"link")', () => {
  const linkBase: Page = {
    id: 'nav-services',
    path: '',
    title: 'Services',
    status: 'published',
    root: { id: 'r', type: 'Section', children: [] },
    kind: 'link',
    link: { target: 'https://x.test', newTab: true },
    nav: { slots: ['header'], order: 0, dropdown: true },
    parent: 'home',
  };

  it('round-trips a link placeholder (keeps kind/link/path; never gains code/SEO)', () => {
    expect(applyPageSettings(linkBase, pageSettingsFromPage(linkBase))).toEqual(linkBase);
  });

  it('persists an edited target + drops it to a dropdown-only when cleared', () => {
    const withTarget = applyPageSettings(linkBase, { ...pageSettingsFromPage(linkBase), linkTarget: '/about', linkNewTab: false });
    expect(withTarget.link).toEqual({ target: '/about' }); // newTab false → omitted
    expect(withTarget.path).toBe(''); // stays routing-transparent
    expect(withTarget.source).toBeUndefined();
    const cleared = applyPageSettings(linkBase, { ...pageSettingsFromPage(linkBase), linkTarget: '' });
    expect(cleared.link).toEqual({ newTab: true }); // no target — a dropdown-only parent
  });

  it('renders the link target + new-tab controls and hides the slug/meta fields', () => {
    const home: Page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={linkBase} projectId="p" initial={pageSettingsFromPage(linkBase)} pages={[home, linkBase]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    expect((screen.getByLabelText('Link target') as HTMLInputElement).value).toBe('https://x.test');
    expect((screen.getByLabelText('Open in new tab') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Page path')).toBeNull(); // no slug for a placeholder
    expect(screen.queryByLabelText('Meta description')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ linkTarget: 'https://x.test', linkNewTab: true }));
  });
});

describe('PageSettingsModal parent selector — home is the tree root', () => {
  const home: Page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };
  const other: Page = { id: 'about', path: 'about', title: 'About', root: { id: 'r', type: 'Section' } };

  it('offers no "None" choice for a non-home page and defaults + submits Home', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={other} projectId="p" initial={pageSettingsFromPage(other)} pages={[home, other]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
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
      <PageSettingsModal page={home} projectId="p" initial={pageSettingsFromPage(home)} pages={[home, other]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    expect((screen.getByLabelText('Parent page') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ parent: '' }));
  });
});
