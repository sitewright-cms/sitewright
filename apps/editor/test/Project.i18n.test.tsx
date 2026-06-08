import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Page, Template } from '@sitewright/schema';

const { listPages, putPage, getSettings, listTemplates, putTemplate } = vi.hoisted(() => ({
  listPages: vi.fn(),
  putPage: vi.fn(),
  getSettings: vi.fn(),
  listTemplates: vi.fn(),
  putTemplate: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    putPage: (p: string, page: Page) => putPage(p, page),
    getSettings: (p: string) => getSettings(p),
    listTemplates: (p: string) => listTemplates(p),
    putTemplate: (p: string, t: Template) => putTemplate(p, t),
  },
}));
vi.mock('../src/views/CodePageEditor', () => ({ CodePageEditor: () => <div>PAGE EDITOR</div> }));
vi.mock('../src/views/DatasetManager', () => ({ DatasetManager: () => <div /> }));
vi.mock('../src/views/MediaManager', () => ({ MediaManager: () => <div /> }));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div /> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/AdminView', () => ({ AdminView: () => <div /> }));
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
});

describe('ProjectView i18n actions', () => {
  it('hides the translate action for a single-locale project', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Add translations/)).toBeNull();
  });

  it('"Add translations" fans out the missing locale variants and ties the primary into the group', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByLabelText('Add translations for Home')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Add translations for Home'));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(2));

    const written = putPage.mock.calls.map((c) => c[1] as Page);
    // The primary is tied into its own group (locale stays default/unset).
    const primary = written.find((p) => p.id === 'home')!;
    expect(primary.translationGroup).toBe('home');
    expect(primary.locale).toBeUndefined();
    // The German variant is a sibling at /de with its own locale + group.
    const de = written.find((p) => p.id === 'home-de')!;
    expect(de).toMatchObject({ id: 'home-de', locale: 'de', translationGroup: 'home', path: 'de' });
    expect(de.parent).toBe('home'); // a locale variant parents to the home root
    expect(de.source).toBe(home.source); // template-reuse: starts from the primary's code
  });

  it('a non-home page keeps its slug and nests under the locale home when one exists', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } });
    // A German home already exists (translation of the root home) → the German About nests under it.
    const homeDe: Page = { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root, source: '<h1>Start</h1>' };
    const homeGrouped: Page = { ...home, translationGroup: 'home' };
    listPages.mockResolvedValue({ items: [homeGrouped, about, homeDe] });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByLabelText('Add translations for About')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Add translations for About'));
    await waitFor(() => expect(putPage).toHaveBeenCalled());
    const de = putPage.mock.calls.map((c) => c[1] as Page).find((p) => p.id === 'about-de')!;
    expect(de.path).toBe('about'); // SAME slug — the locale comes from the parent chain
    expect(de.parent).toBe('home-de'); // nested under the German home → computed /de/about
  });

  it('orders the pages list as a tree and indents sub-pages by depth', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    // about → child → grandchild; the list flattens to tree order with rising indent.
    const child: Page = { id: 'child', path: 'team', title: 'Team', root, parent: 'about', source: '<h1>T</h1>' };
    const grandchild: Page = { id: 'gc', path: 'lead', title: 'Lead', root, parent: 'child', source: '<h1>L</h1>' };
    // Deliberately unsorted input → the view must re-order by the tree, not input order.
    listPages.mockResolvedValue({ items: [grandchild, about, home, child] });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(document.querySelectorAll('ul.mb-8 > li').length).toBe(4));

    const rows = Array.from(document.querySelectorAll('ul.mb-8 > li')) as HTMLLIElement[];
    const titleOf = (li: HTMLLIElement) => li.querySelector('.font-medium')?.textContent;
    // Tree order: Home (root) → About (under home) → Team → Lead, each one level deeper.
    expect(rows.map(titleOf)).toEqual(['Home', 'About', 'Team', 'Lead']);
    const ml = (li: HTMLLIElement) => li.style.marginLeft || '0rem';
    expect(ml(rows[0]!)).toBe('0rem'); // Home — root (depth 0)
    expect(ml(rows[1]!)).toBe('1.5rem'); // About — depth 1 (under home)
    expect(ml(rows[2]!)).toBe('3rem'); // Team — depth 2
    expect(ml(rows[3]!)).toBe('4.5rem'); // Lead — depth 3
  });

  it('"Save as template" promotes the page source into a shared template and references it', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByLabelText('Save About as template')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Save About as template'));
    await waitFor(() => expect(putTemplate).toHaveBeenCalledTimes(1));

    const tpl = putTemplate.mock.calls[0]![1] as Template;
    expect(tpl).toMatchObject({ id: 'about-template', source: about.source });
    // The page now references the template and drops its own inline source.
    const written = putPage.mock.calls.map((c) => c[1] as Page).find((p) => p.id === 'about')!;
    expect(written.template).toBe('about-template');
    expect(written.source).toBeUndefined();
  });
});
