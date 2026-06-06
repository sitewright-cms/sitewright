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

const home: Page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<h1>{{edit "h" "Hi"}}</h1>' };
const about: Page = { id: 'about', path: '/about', title: 'About', root: { id: 'r', type: 'Section' }, source: '<h1>About</h1>' };

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
    expect(de).toMatchObject({ id: 'home-de', locale: 'de', translationGroup: 'home', path: '/de' });
    expect(de.source).toBe(home.source); // template-reuse: starts from the primary's code
  });

  it('a non-home page translates under /<locale>/<path>', async () => {
    getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } });
    render(<ProjectView project={project} tab="pages" />);
    await waitFor(() => expect(screen.getByLabelText('Add translations for About')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Add translations for About'));
    await waitFor(() => expect(putPage).toHaveBeenCalled());
    const de = putPage.mock.calls.map((c) => c[1] as Page).find((p) => p.id === 'about-de')!;
    expect(de.path).toBe('/de/about');
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
