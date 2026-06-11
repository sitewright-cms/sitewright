import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { listPages, putPage, getSettings, listTemplates } = vi.hoisted(() => ({
  listPages: vi.fn(),
  putPage: vi.fn(),
  getSettings: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    putPage: (p: string, page: Page) => putPage(p, page),
    getSettings: (p: string) => getSettings(p),
    listTemplates: (p: string) => listTemplates(p),
  },
}));
// The mock surfaces the `initialMode` the modal opens in so the default-mode contract is testable:
// everyone now opens in `content` (the Code⇄Content toggle itself lives INSIDE the page editor modal).
vi.mock('../src/views/CodePageEditor', () => ({
  CodePageEditor: ({ initialMode }: { initialMode?: string }) => <div>PAGE EDITOR mode={initialMode}</div>,
}));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div>FORMS</div> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const ownerProject = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const memberProject = { id: 'p', name: 'Acme', slug: 'acme', role: 'member' as const };
const pages: Page[] = [{ id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } }];

beforeEach(() => {
  listPages.mockReset();
  putPage.mockReset();
  getSettings.mockReset();
  listTemplates.mockReset();
  listPages.mockResolvedValue({ items: pages });
  putPage.mockResolvedValue({ item: pages[0] });
  // Single-locale project by default → i18n actions stay hidden.
  getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
  listTemplates.mockResolvedValue({ items: [] });
});

describe('ProjectView role gating (tab is supplied by the App header)', () => {
  it('owner on the Pages tab sees the add-page button + the page list', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    // The add-page form now lives in a modal opened from this button.
    expect(screen.getByRole('button', { name: '+ New page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home /' })).toBeInTheDocument();
  });

  it('owner on another tab renders that section (no page form)', async () => {
    render(<ProjectView project={ownerProject} tab="forms" />);
    expect(await screen.findByText('FORMS')).toBeInTheDocument();
    expect(screen.queryByLabelText('Page path')).toBeNull();
  });

  it('a member sees the restricted surface: no add-page form, just their pages', async () => {
    render(<ProjectView project={memberProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.queryByLabelText('Page path')).toBeNull();
    expect(screen.getByRole('button', { name: /Home/ })).toBeInTheDocument();
  });
  // The Library + Assets side panels are now App-level (gated on the project role there); see
  // App.test.tsx for their owner-only presence. ProjectView no longer renders them.

  it('opens an owner on a page in CONTENT mode (the default for everyone)', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Home /' }));
    expect(screen.getByText('PAGE EDITOR mode=content')).toBeInTheDocument();
    // The list (and its add-page button) stays mounted behind the modal.
    expect(screen.getByRole('button', { name: '+ New page' })).toBeInTheDocument();
  });

  it('opens a member on a page in CONTENT mode (the same default)', async () => {
    render(<ProjectView project={memberProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('PAGE EDITOR mode=content')).toBeInTheDocument();
  });

  it('"Add page" creates a code-first page carrying a Handlebars source', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '+ New page' }));
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'landing' } });
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Landing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const created = putPage.mock.calls[0]![1] as Page;
    expect(created.id).toBe('landing');
    expect(created.path).toBe('landing'); // slug only — no leading slash
    expect(created.parent).toBe('home'); // a new page defaults to the home root as parent
    expect(created.source).toContain('{{ company.name }}');
  });

  it('"Add page" slugifies input and refuses the reserved "home" slug (no clobbering the root)', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    // A leading slash / spaces are slugified away…
    fireEvent.click(screen.getByRole('button', { name: '+ New page' }));
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: '/Web Design' } });
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'WD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    expect((putPage.mock.calls[0]![1] as Page).path).toBe('web-design');

    // …and "home" (the root's id) is rejected rather than overwriting the home page. (A successful
    // add closes the modal, so re-open it for the next attempt.)
    putPage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '+ New page' }));
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'home' } });
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Home 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    expect(await screen.findByText(/reserved for the site root/i)).toBeInTheDocument();
    expect(putPage).not.toHaveBeenCalled();
  });
});
