import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { listPages, listMembers, putPage } = vi.hoisted(() => ({
  listPages: vi.fn(),
  listMembers: vi.fn(),
  putPage: vi.fn(),
}));
// Stub the heavy child views so this test focuses on ProjectView's role gating.
vi.mock('../src/api', () => ({
  api: {
    listPages: (o: string, p: string) => listPages(o, p),
    listMembers: (o: string) => listMembers(o),
    putPage: (o: string, p: string, page: Page) => putPage(o, p, page),
  },
}));
vi.mock('../src/views/PageEditor', () => ({ PageEditor: () => <div>FULL EDITOR</div> }));
vi.mock('../src/views/CodePageEditor', () => ({ CodePageEditor: () => <div>CODE EDITOR</div> }));
vi.mock('../src/views/ClientPageEditor', () => ({ ClientPageEditor: () => <div>CLIENT EDITOR</div> }));
vi.mock('../src/views/PublishBar', () => ({ PublishBar: () => <div>PUBLISH BAR</div> }));
vi.mock('../src/views/TeamManager', () => ({ TeamManager: () => <div>TEAM MANAGER</div> }));
vi.mock('../src/views/ClientsManager', () => ({ ClientsManager: () => <div>CLIENTS MANAGER</div> }));
vi.mock('../src/views/DatasetManager', () => ({ DatasetManager: () => <div /> }));
vi.mock('../src/views/MediaManager', () => ({ MediaManager: () => <div /> }));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div /> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const project = { id: 'p', name: 'Acme', slug: 'acme' };
const pages: Page[] = [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }];

beforeEach(() => {
  listPages.mockReset();
  listMembers.mockReset();
  putPage.mockReset();
  listPages.mockResolvedValue({ items: pages });
  listMembers.mockResolvedValue({ members: [] });
  putPage.mockResolvedValue({ item: pages[0] });
});

describe('ProjectView role gating', () => {
  it('gives owner/admin the full studio: publish bar, tabs, and the add-page form', async () => {
    const org = { id: 'o', name: 'O', slug: 'o', role: 'admin' };
    render(<ProjectView org={org} project={project} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByText('PUBLISH BAR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'team' })).toBeInTheDocument();
    expect(screen.getByLabelText('Page slug')).toBeInTheDocument();
  });

  it('gives a member the restricted surface: no publish bar, no tabs, no add-page form', async () => {
    const org = { id: 'o', name: 'O', slug: 'o', role: 'member' };
    render(<ProjectView org={org} project={project} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.queryByText('PUBLISH BAR')).toBeNull();
    expect(screen.queryByRole('button', { name: 'team' })).toBeNull();
    expect(screen.queryByLabelText('Page slug')).toBeNull();
    // The client still sees their pages to open.
    expect(screen.getByRole('button', { name: /Home/ })).toBeInTheDocument();
  });

  it('opens a code page (one with `source`) in the code editor, not the block editor', async () => {
    const org = { id: 'o', name: 'O', slug: 'o', role: 'admin' };
    listPages.mockResolvedValue({
      items: [{ id: 'codey', path: '/codey', title: 'Codey', root: { id: 'r', type: 'Section' }, source: '<h1>x</h1>' }],
    });
    render(<ProjectView org={org} project={project} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Codey/ }));
    expect(screen.getByText('CODE EDITOR')).toBeInTheDocument();
    expect(screen.queryByText('FULL EDITOR')).toBeNull();
  });

  it('the "Code page" toggle creates a page carrying a Handlebars source', async () => {
    const org = { id: 'o', name: 'O', slug: 'o', role: 'admin' };
    render(<ProjectView org={org} project={project} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Page slug'), { target: { value: 'landing' } });
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Landing' } });
    fireEvent.click(screen.getByLabelText('Code page'));
    fireEvent.click(screen.getByRole('button', { name: 'Add code page' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const created = putPage.mock.calls[0]![2] as Page;
    expect(created.id).toBe('landing');
    expect(typeof created.source).toBe('string');
    expect(created.source).toContain('{{ company.name }}'); // the starter scaffold
  });
});
