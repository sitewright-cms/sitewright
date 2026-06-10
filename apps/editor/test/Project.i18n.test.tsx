import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Page, Template } from '@sitewright/schema';

const { listPages, putPage, getSettings, listTemplates, putTemplate, addLocale, translatePage, deletePage, deletePageGroup, removeLocale } =
  vi.hoisted(() => ({
    listPages: vi.fn(),
    putPage: vi.fn(),
    getSettings: vi.fn(),
    listTemplates: vi.fn(),
    putTemplate: vi.fn(),
    addLocale: vi.fn(),
    translatePage: vi.fn(),
    deletePage: vi.fn(),
    deletePageGroup: vi.fn(),
    removeLocale: vi.fn(),
  }));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    putPage: (p: string, page: Page) => putPage(p, page),
    getSettings: (p: string) => getSettings(p),
    listTemplates: (p: string) => listTemplates(p),
    putTemplate: (p: string, t: Template) => putTemplate(p, t),
    addLocale: (p: string, l: string) => addLocale(p, l),
    translatePage: (p: string, id: string) => translatePage(p, id),
    deletePage: (p: string, id: string) => deletePage(p, id),
    deletePageGroup: (p: string, id: string) => deletePageGroup(p, id),
    removeLocale: (p: string, l: string) => removeLocale(p, l),
  },
}));
vi.mock('../src/views/CodePageEditor', () => ({ CodePageEditor: () => <div>PAGE EDITOR</div> }));
vi.mock('../src/views/DatasetManager', () => ({ DatasetManager: () => <div /> }));
vi.mock('../src/views/MediaManager', () => ({ MediaManager: () => <div /> }));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div /> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

const root = { id: 'r', type: 'Section' as const };
const home: Page = { id: 'home', path: '', title: 'Home', root, source: '<h1 data-sw-text="h">Hi</h1>' };
const about: Page = { id: 'about', path: 'about', parent: 'home', title: 'About', root, source: '<h1>About</h1>' };

beforeEach(() => {
  listPages.mockReset().mockResolvedValue({ items: [home, about] });
  putPage.mockReset().mockResolvedValue({ item: home });
  putTemplate.mockReset().mockResolvedValue({ item: { id: 't' } });
  listTemplates.mockReset().mockResolvedValue({ items: [] });
  getSettings.mockReset();
  addLocale.mockReset().mockResolvedValue({ locale: 'de', created: 2, pages: [] });
  translatePage.mockReset().mockResolvedValue({ created: 1, pages: [] });
  deletePage.mockReset().mockResolvedValue(undefined);
  deletePageGroup.mockReset().mockResolvedValue({ removed: [], kept: [] });
  removeLocale.mockReset().mockResolvedValue({ locale: 'de', removed: 0 });
});

describe('ProjectView locale-first i18n', () => {
  it('a single-locale project shows no language switcher and no translate action', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('tablist', { name: 'Language' })).toBeNull();
    expect(screen.queryByLabelText(/into all languages/)).toBeNull();
    // "Add translation" is always available, even for a single-language site.
    expect(screen.getByText('+ Add translation')).toBeInTheDocument();
  });

  it('"Add translation" opens the locale picker and adds the chosen language', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByText('+ Add translation')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ Add translation'));
    // The picker lists catalog languages; pick German.
    const german = await screen.findByRole('button', { name: /German/ });
    fireEvent.click(german);
    await waitFor(() => expect(addLocale).toHaveBeenCalledWith('p', 'de'));
  });

  it('the per-page translate action makes a main-language page available in all languages', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByLabelText('Translate Home into all languages')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Translate Home into all languages'));
    await waitFor(() => expect(translatePage).toHaveBeenCalledWith('p', 'home'));
    // The old client-side multi-putPage fan-out is gone — the server scaffolds the variants.
    expect(putPage).not.toHaveBeenCalled();
  });

  it('the language switcher filters the list to the selected language', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } });
    const homeDe: Page = { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root };
    const aboutDe: Page = { id: 'about-de', path: 'about', parent: 'home-de', title: 'Über', locale: 'de', translationGroup: 'about', root };
    listPages.mockResolvedValue({
      items: [{ ...home, translationGroup: 'home' }, { ...about, translationGroup: 'about' }, homeDe, aboutDe],
    });
    render(<ProjectView project={project} tab="pages" />);
    // Default (English) view: only the English pages.
    await waitFor(() => expect(document.querySelectorAll('ul.mb-8 > li').length).toBe(2));
    // The title span is `.truncate.font-medium`; badges (e.g. "inherited") are `.font-medium` too.
    const titles = () => Array.from(document.querySelectorAll('ul.mb-8 > li .truncate.font-medium')).map((e) => e.textContent);
    expect(titles()).toEqual(['Home', 'About']);

    // Switch to German → the list shows the German variants only. (The tab's accessible name
    // is the locale code; the language name lives in its title.)
    fireEvent.click(screen.getByRole('tab', { name: 'de' }));
    await waitFor(() => expect(titles()).toEqual(['Start', 'Über']));
  });

  it('orders the pages list as a tree and indents sub-pages by depth', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    const child: Page = { id: 'child', path: 'team', title: 'Team', root, parent: 'about', source: '<h1>T</h1>' };
    const grandchild: Page = { id: 'gc', path: 'lead', title: 'Lead', root, parent: 'child', source: '<h1>L</h1>' };
    listPages.mockResolvedValue({ items: [grandchild, about, home, child] });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(document.querySelectorAll('ul.mb-8 > li').length).toBe(4));

    const rows = Array.from(document.querySelectorAll('ul.mb-8 > li')) as HTMLLIElement[];
    const titleOf = (li: HTMLLIElement) => li.querySelector('.font-medium')?.textContent;
    expect(rows.map(titleOf)).toEqual(['Home', 'About', 'Team', 'Lead']);
    const ml = (li: HTMLLIElement) => li.style.marginLeft || '0rem';
    expect(ml(rows[0]!)).toBe('0rem');
    expect(ml(rows[1]!)).toBe('1.5rem');
    expect(ml(rows[2]!)).toBe('3rem');
    expect(ml(rows[3]!)).toBe('4.5rem');
  });

  it('"Save as template" promotes the page source into a template and references it (only that page)', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByLabelText('Save About as template')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Save About as template'));
    await waitFor(() => expect(putTemplate).toHaveBeenCalledTimes(1));

    const tpl = putTemplate.mock.calls[0]![1] as Template;
    expect(tpl).toMatchObject({ id: 'about-template', source: about.source });
    const written = putPage.mock.calls.map((c) => c[1] as Page).find((p) => p.id === 'about')!;
    expect(written.template).toBe('about-template');
    expect(written.source).toBeUndefined();
  });
});
