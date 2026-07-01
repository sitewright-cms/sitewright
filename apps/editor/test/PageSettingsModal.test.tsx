import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Page } from '@sitewright/schema';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage } from '../src/views/PageSettingsModal';

const base: Page = {
  id: 'about',
  path: 'about',
  title: 'About',
  // Explicit status: applyPageSettings always writes one (absent = published in the
  // schema), so the round-trip normalizes to the explicit form.
  status: 'published',
  
  // Flat SEO fields managed by the modal: description, image, and (now) noindex.
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
    // noindex is managed now — base had it set and these values keep it on, so it persists.
    expect(next.noindex).toBe(true);
    expect(next.parent).toBeUndefined();
    expect(next.template).toBeUndefined();
    expect(next.nav).toBeUndefined();
    // The input page was not mutated (immutability contract).
    expect(base.description).toBe('old description');
    expect(base.nav?.dropdown).toBe(true);
  });

  it('emits dropdown only when true and drops empty SEO fields', () => {
    const plain: Page = { id: 'p', path: 'p', title: 'P' };
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
      
      locale: 'de',
      translationGroup: 'about',
    };
    const next = applyPageSettings(de, { ...pageSettingsFromPage(de), locale: '' });
    expect(next.locale).toBeUndefined(); // default locale stored as absence
    expect(next.translationGroup).toBe('about'); // group untouched
  });
});

describe('PageSettingsModal — noindex (hide from search) toggle', () => {
  const home: Page = { id: 'home', path: '', title: 'Home' };

  it('reflects + toggles the noindex flag and submits it', () => {
    const page: Page = { id: 'p', path: 'p', title: 'P', status: 'published', noindex: false };
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={page} projectId="p" initial={pageSettingsFromPage(page)} pages={[home, page]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    const toggle = screen.getByLabelText('Hide from search engines (noindex)') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ noindex: true }));
  });

  it('applyPageSettings persists noindex true and drops it when false (absence = indexable)', () => {
    const page: Page = { id: 'p', path: 'p', title: 'P', status: 'published' };
    expect(applyPageSettings(page, { ...pageSettingsFromPage(page), noindex: true }).noindex).toBe(true);
    const on: Page = { ...page, noindex: true };
    expect(applyPageSettings(on, { ...pageSettingsFromPage(on), noindex: false }).noindex).toBeUndefined();
  });
});

describe('PageSettingsModal — link placeholders (kind:"link")', () => {
  const linkBase: Page = {
    id: 'nav-services',
    path: '',
    title: 'Services',
    status: 'published',
    
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
    const home: Page = { id: 'home', path: '', title: 'Home' };
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
  const home: Page = { id: 'home', path: '', title: 'Home' };
  const other: Page = { id: 'about', path: 'about', title: 'About' };

  it('offers no "None" choice for a non-home page and defaults + submits Home', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={other} projectId="p" initial={pageSettingsFromPage(other)} pages={[home, other]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    const combo = screen.getByRole('combobox', { name: 'Parent page' });
    expect(combo).not.toBeDisabled();
    // Open the searchable list — it offers the home page (by path) but NO "None"/top-level escape.
    fireEvent.click(combo);
    const listbox = screen.getByRole('listbox', { name: 'Parent page' });
    expect(within(listbox).queryByText(/none/i)).toBeNull();
    expect(within(listbox).getByText('/')).toBeInTheDocument(); // home shown by its PATH, not its title
    // Default parent is the home root; saving submits it.
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ parent: 'home' }));
  });

  it('keeps the home page itself parentless (selector disabled)', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={home} projectId="p" initial={pageSettingsFromPage(home)} pages={[home, other]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('combobox', { name: 'Parent page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ parent: '' }));
  });

  it('parent options show the PATH (not the long title) and are searchable by title', () => {
    const svc: Page = { id: 'services', path: 'services', title: 'Our Services & Care Plans' };
    const about: Page = { id: 'about', path: 'about', title: 'About' };
    render(
      <PageSettingsModal page={about} projectId="p" initial={pageSettingsFromPage(about)} pages={[home, svc, about]} templates={[]} onClose={() => {}} onSubmit={() => {}} />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent page' }));
    const listbox = screen.getByRole('listbox', { name: 'Parent page' });
    // Options are the PATH, not the (long) title.
    expect(within(listbox).getByText('/services')).toBeInTheDocument();
    expect(within(listbox).queryByText(/Our Services/)).toBeNull();
    // …but typing the TITLE still finds it (keywords), shown by its path.
    fireEvent.change(screen.getByLabelText('Search Parent page'), { target: { value: 'care plans' } });
    const shown = within(listbox).getAllByRole('option');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent('/services');
  });

  it('labels a nav placeholder parent by its NAME (menu), not its collapsed "/" — so home is not duplicated', () => {
    // A routing-transparent placeholder (kind:'link', path:'') parented to home resolves to pagePath "/".
    // It must NOT show as a second "/" — it shows its (de-marked-up) name + a "(menu)" marker.
    const ph = { id: 'nav-audit', path: '', title: '<span class="x">Free site audit</span>', kind: 'link', parent: 'home' } as Page;
    const about: Page = { id: 'about', path: 'about', title: 'About' };
    render(
      <PageSettingsModal page={about} projectId="p" initial={pageSettingsFromPage(about)} pages={[home, ph, about]} templates={[]} onClose={() => {}} onSubmit={() => {}} />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent page' }));
    const listbox = screen.getByRole('listbox', { name: 'Parent page' });
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent?.trim());
    expect(labels.filter((t) => t === '/')).toHaveLength(1); // ONLY the home page, not the placeholder
    expect(within(listbox).getByText('Free site audit (menu)')).toBeInTheDocument();
    // …and it's still findable by typing its name.
    fireEvent.change(screen.getByLabelText('Search Parent page'), { target: { value: 'audit' } });
    const shown = within(listbox).getAllByRole('option');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent('Free site audit (menu)');
  });
});

describe('PageSettingsModal — create mode (the New-page form)', () => {
  const home: Page = { id: 'home', path: '', title: 'Home' };
  const draft = { id: '__new__', path: '', title: '' } as Page;

  it('shows the New-page chrome: editable slug, a Create button, and full fields — not the home form', () => {
    render(
      <PageSettingsModal mode="create" page={draft} projectId="p" initial={pageSettingsFromPage(draft)} pages={[home]} templates={[]} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.getByText('New page')).toBeInTheDocument();
    // A blank-slug draft must NOT be mistaken for the home page: the slug is editable and defaults
    // its parent to home (not "None (home is the root)").
    const slug = screen.getByLabelText('Page path') as HTMLInputElement;
    expect(slug.disabled).toBe(false);
    // The Parent combobox defaults to the home root — shown by home's path "/", not "None".
    const parent = screen.getByRole('combobox', { name: 'Parent page' });
    expect(parent).toHaveTextContent('/');
    // The full field set is present (this is the whole point of the change).
    expect(screen.getByLabelText('Meta description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create page' })).toBeInTheDocument();
  });

  it('submits the entered title + slug and the chosen parent', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal mode="create" page={draft} projectId="p" initial={pageSettingsFromPage(draft)} pages={[home]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'About us' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'about' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'About us', path: 'about', parent: 'home' }));
  });

  it('renders a caller error inline and keeps the form open', () => {
    render(
      <PageSettingsModal mode="create" page={draft} projectId="p" initial={pageSettingsFromPage(draft)} pages={[home]} templates={[]} error={'A page "about" already exists.'} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
  });

  it('multilingual: shows the language-scope control and stamps the locale from it', () => {
    const onSubmit = vi.fn();
    const onScopeChange = vi.fn();
    // scope="current" while viewing German → the submitted values carry locale "de".
    const { rerender } = render(
      <PageSettingsModal
        mode="create" page={draft} projectId="p" initial={pageSettingsFromPage(draft)} pages={[home]} templates={[]}
        locales={['en', 'de']} currentLocale="de" scope="current" onScopeChange={onScopeChange} onClose={() => {}} onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('Available only in the current language')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Nur DE' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'nur-de' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: 'nur-de', locale: 'de' }));

    // scope="all" (the default) → the owner is authored in the default language (locale "").
    onSubmit.mockClear();
    rerender(
      <PageSettingsModal
        mode="create" page={draft} projectId="p" initial={pageSettingsFromPage(draft)} pages={[home]} templates={[]}
        locales={['en', 'de']} currentLocale="de" scope="all" onScopeChange={onScopeChange} onClose={() => {}} onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Alle' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'alle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: 'alle', locale: '' }));
  });
});

describe('PageSettingsModal — unified language handling (no per-page Language selector in edit)', () => {
  const home: Page = { id: 'home', path: '', title: 'Home' };
  const aboutEn: Page = { id: 'about', path: 'about', title: 'About', status: 'published', translationGroup: 'about' };
  const aboutDe: Page = { id: 'about-de', path: 'about', title: 'Über', status: 'published', locale: 'de', translationGroup: 'about' };

  it('EDIT mode shows neither the old Language dropdown nor the create-only scope control', () => {
    render(
      <PageSettingsModal page={aboutDe} projectId="p" initial={pageSettingsFromPage(aboutDe)} pages={[home, aboutEn, aboutDe]} templates={[]} locales={['en', 'de']} onClose={() => {}} onSubmit={() => {}} />,
    );
    // The per-page Language selector is gone (unified with the New-page modal, which never had one).
    expect(screen.queryByLabelText('Page language')).toBeNull();
    // The "Available in" scope is a CREATE-only control — absent in edit too.
    expect(screen.queryByText('Available in')).toBeNull();
  });

  it('EDIT preserves the page’s existing locale on save even without a selector (round-trips via applyPageSettings)', () => {
    const onSubmit = vi.fn();
    render(
      <PageSettingsModal page={aboutDe} projectId="p" initial={pageSettingsFromPage(aboutDe)} pages={[home, aboutEn, aboutDe]} templates={[]} locales={['en', 'de']} onClose={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ locale: 'de' }));
    // And applyPageSettings keeps the locale + translation group it does not edit.
    const saved = applyPageSettings(aboutDe, onSubmit.mock.calls[0]![0]);
    expect(saved.locale).toBe('de');
    expect(saved.translationGroup).toBe('about');
  });
});

describe('PageSettingsModal — UX: status in header, collapsible Advanced, hint tooltips', () => {
  const home: Page = { id: 'home', path: '', title: 'Home' };
  const plain: Page = { id: 'p', path: 'p', title: 'P', status: 'published' };

  it('puts the Published/Draft switch in the header and toggles + submits status', () => {
    const onSubmit = vi.fn();
    render(<PageSettingsModal page={plain} projectId="p" initial={pageSettingsFromPage(plain)} pages={[home, plain]} templates={[]} onClose={() => {}} onSubmit={onSubmit} />);
    const statusGroup = screen.getByRole('group', { name: 'Status' });
    const draftBtn = within(statusGroup).getByRole('button', { name: 'draft' });
    expect(draftBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(draftBtn);
    expect(draftBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
  });

  it('collapses Advanced in EDIT (Template hidden until expanded)', () => {
    render(<PageSettingsModal page={plain} projectId="p" initial={pageSettingsFromPage(plain)} pages={[home, plain]} templates={[]} onClose={() => {}} onSubmit={() => {}} />);
    // Template lives under Advanced, which is collapsed by default in edit → not rendered yet.
    expect(screen.queryByLabelText('Page template')).toBeNull();
    const advanced = screen.getByRole('button', { name: /Advanced/ });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Page template')).toBeInTheDocument();
  });

  it('opens Advanced up front in CREATE (template picker visible immediately)', () => {
    const draft = { id: '__new__', path: '', title: '' } as Page;
    render(<PageSettingsModal mode="create" page={draft} projectId="p" initial={pageSettingsFromPage(draft)} pages={[home]} templates={[]} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.getByLabelText('Page template')).toBeInTheDocument();
  });

  it('opens Advanced when the page already uses a power setting (rawHtml)', () => {
    const raw: Page = { ...plain, rawHtml: true };
    render(<PageSettingsModal page={raw} projectId="p" initial={pageSettingsFromPage(raw)} pages={[home, raw]} templates={[]} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Raw HTML page')).toBeInTheDocument();
  });

  it('renders field hints as (?) tooltip affordances, not inline description paragraphs', () => {
    render(<PageSettingsModal page={plain} projectId="p" initial={pageSettingsFromPage(plain)} pages={[home, plain]} templates={[]} onClose={() => {}} onSubmit={() => {}} />);
    // The noindex explanation is now the SectionHelp tooltip's aria-label (a button), not prose.
    expect(screen.getByRole('button', { name: /Adds a noindex robots tag/ })).toBeInTheDocument();
    // Sanity: the sections are labeled.
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SEO & Social' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
  });
});
