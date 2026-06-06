import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { listPages, putPage } = vi.hoisted(() => ({
  listPages: vi.fn(),
  putPage: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    putPage: (p: string, page: Page) => putPage(p, page),
  },
}));
// The mock surfaces the role-driven `initialMode` so the default-mode contract is testable
// (the source⇄content toggle itself now lives INSIDE the page editor modal).
vi.mock('../src/views/CodePageEditor', () => ({
  CodePageEditor: ({ initialMode }: { initialMode?: string }) => <div>PAGE EDITOR mode={initialMode}</div>,
}));
vi.mock('../src/views/DatasetManager', () => ({ DatasetManager: () => <div>DATASETS</div> }));
vi.mock('../src/views/MediaManager', () => ({ MediaManager: () => <div>ASSETS</div> }));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div /> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/AdminView', () => ({ AdminView: () => <div /> }));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const ownerProject = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const memberProject = { id: 'p', name: 'Acme', slug: 'acme', role: 'member' as const };
const pages: Page[] = [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }];

beforeEach(() => {
  listPages.mockReset();
  putPage.mockReset();
  listPages.mockResolvedValue({ items: pages });
  putPage.mockResolvedValue({ item: pages[0] });
});

describe('ProjectView role gating (tab is supplied by the App header)', () => {
  it('owner on the Pages tab sees the add-page form + the page list', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByLabelText('Page path')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home /' })).toBeInTheDocument();
  });

  it('owner on another tab renders that section (no page form)', async () => {
    render(<ProjectView project={ownerProject} tab="media" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByText('ASSETS')).toBeInTheDocument();
    expect(screen.queryByLabelText('Page path')).toBeNull();
  });

  it('a member sees the restricted surface: no add-page form, no Library, just their pages', async () => {
    render(<ProjectView project={memberProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.queryByLabelText('Page path')).toBeNull();
    // The code Library is an owner/staff aid — clients edit content, not code.
    expect(screen.queryByRole('button', { name: /open library/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Home/ })).toBeInTheDocument();
  });

  it('an owner gets the Library edge handle', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Open library' })).toBeInTheDocument();
  });

  it('opens an owner on a page in SOURCE mode (the staff default)', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Home /' }));
    expect(screen.getByText('PAGE EDITOR mode=source')).toBeInTheDocument();
    // The list stays mounted behind the modal.
    expect(screen.getByLabelText('Page path')).toBeInTheDocument();
  });

  it('opens a member on a page in CONTENT mode (the client default)', async () => {
    render(<ProjectView project={memberProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('PAGE EDITOR mode=content')).toBeInTheDocument();
  });

  it('"Add page" creates a code-first page carrying a Handlebars source', async () => {
    render(<ProjectView project={ownerProject} tab="pages" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'landing' } });
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Landing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const created = putPage.mock.calls[0]![1] as Page;
    expect(created.id).toBe('landing');
    expect(created.source).toContain('{{ company.name }}');
  });
});
