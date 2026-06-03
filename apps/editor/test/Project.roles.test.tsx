import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Page } from '@sitewright/schema';

const { listPages, putPage } = vi.hoisted(() => ({
  listPages: vi.fn(),
  putPage: vi.fn(),
}));
// Stub the heavy child views so this test focuses on ProjectView's role gating.
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    putPage: (p: string, page: Page) => putPage(p, page),
  },
}));
// The mocks render the injected `modeToggle` so the source⇄content switch is testable.
vi.mock('../src/views/CodePageEditor', () => ({
  CodePageEditor: ({ modeToggle }: { modeToggle?: ReactNode }) => <div>CODE EDITOR{modeToggle}</div>,
}));
vi.mock('../src/views/ClientSourceEditor', () => ({
  ClientSourceEditor: ({ modeToggle }: { modeToggle?: ReactNode }) => <div>CLIENT SOURCE EDITOR{modeToggle}</div>,
}));
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

const ownerProject = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const memberProject = { id: 'p', name: 'Acme', slug: 'acme', role: 'member' as const };
const pages: Page[] = [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }];

beforeEach(() => {
  listPages.mockReset();
  putPage.mockReset();
  listPages.mockResolvedValue({ items: pages });
  putPage.mockResolvedValue({ item: pages[0] });
});

describe('ProjectView role gating', () => {
  it('gives an owner the full studio: publish bar, tabs, and the add-page form', async () => {
    render(<ProjectView project={ownerProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByText('PUBLISH BAR')).toBeInTheDocument();
    // The owner sees the top tab bar — e.g. the grouped Admin tab (Clients/Team/Access live under it).
    expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Corporate Identity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Page slug')).toBeInTheDocument();
  });

  it('gives a member the restricted surface: no publish bar, no tabs, no add-page form', async () => {
    render(<ProjectView project={memberProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.queryByText('PUBLISH BAR')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Admin' })).toBeNull();
    expect(screen.queryByLabelText('Page slug')).toBeNull();
    // The client still sees their pages to open.
    expect(screen.getByRole('button', { name: /Home/ })).toBeInTheDocument();
  });

  it('opens any page in the code editor (block authoring is retired)', async () => {
    render(<ProjectView project={ownerProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('CODE EDITOR')).toBeInTheDocument();
  });

  it('opens a member on a page in the client source editor (bound regions only)', async () => {
    render(<ProjectView project={memberProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('CLIENT SOURCE EDITOR')).toBeInTheDocument();
  });

  it('lets an owner toggle from source to the content editor (and back)', async () => {
    render(<ProjectView project={ownerProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    // Owner defaults to source.
    expect(screen.getByText('CODE EDITOR')).toBeInTheDocument();
    // Switch to content → the client source editor; the developer is not locked out of it.
    fireEvent.click(screen.getByRole('button', { name: 'content' }));
    expect(screen.getByText('CLIENT SOURCE EDITOR')).toBeInTheDocument();
    // …and back to source.
    fireEvent.click(screen.getByRole('button', { name: 'source' }));
    expect(screen.getByText('CODE EDITOR')).toBeInTheDocument();
  });

  it('lets a member toggle from content to the full source editor (no hard restriction)', async () => {
    render(<ProjectView project={memberProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    // Member defaults to content.
    expect(screen.getByText('CLIENT SOURCE EDITOR')).toBeInTheDocument();
    // …but may switch to the full source editor — source⇄content is a UI default, not a gate.
    fireEvent.click(screen.getByRole('button', { name: 'source' }));
    expect(screen.getByText('CODE EDITOR')).toBeInTheDocument();
  });

  it('"Add page" creates a code-first page carrying a Handlebars source', async () => {
    render(<ProjectView project={ownerProject} onBack={() => {}} />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Page slug'), { target: { value: 'landing' } });
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Landing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const created = putPage.mock.calls[0]![1] as Page;
    expect(created.id).toBe('landing');
    expect(typeof created.source).toBe('string');
    expect(created.source).toContain('{{ company.name }}'); // every new page is code-first
  });
});
