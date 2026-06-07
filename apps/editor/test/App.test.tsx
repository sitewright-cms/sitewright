import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Project } from '../src/api';

const { me, createProject, logout } = vi.hoisted(() => ({ me: vi.fn(), createProject: vi.fn(), logout: vi.fn() }));
vi.mock('../src/api', () => ({
  api: { me: () => me(), createProject: (...a: unknown[]) => createProject(...a), logout: () => logout() },
}));
// Heavy children stubbed — App is the unit under test (shell + selector + header).
vi.mock('../src/views/Project', () => ({
  ProjectView: ({ project, tab }: { project: Project; tab: string }) => <div>PROJECT {project.name} tab={tab}</div>,
  MANAGE_TABS: ['pages', 'forms'] as const,
  TAB_LABELS: { pages: 'Pages', forms: 'Forms' },
}));
vi.mock('../src/views/files/AssetsPanel', () => ({
  AssetsPanel: ({ openSignal }: { openSignal: number }) => <div>ASSETS PANEL sig={openSignal}</div>,
}));
vi.mock('../src/views/library/LibraryPanel', () => ({ LibraryPanel: () => <div>LIBRARY PANEL</div> }));
vi.mock('../src/views/PublishBar', () => ({ PublishBar: () => <div>PUBLISH</div> }));
vi.mock('../src/views/InstanceSettings', () => ({ InstanceSettings: () => <div /> }));
vi.mock('../src/views/UpdateBanner', () => ({ UpdateBanner: () => <div /> }));
vi.mock('../src/views/Login', () => ({ Login: () => <div>LOGIN</div> }));

import { App } from '../src/App';

const projects: Project[] = [
  { id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' },
  { id: 'p2', name: 'Globex', slug: 'globex', role: 'owner' },
];

beforeEach(() => {
  vi.clearAllMocks();
  me.mockResolvedValue({ userId: 'u', isInstanceAdmin: false, projects });
  createProject.mockResolvedValue({ project: { id: 'p3', name: 'New Co', slug: 'new-co', role: 'owner' } });
});

describe('App shell', () => {
  it('shows the project selector automatically on first load, searchable', async () => {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Your projects' });
    expect(within(dialog).getByRole('button', { name: /Acme/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Globex/ })).toBeInTheDocument();
    // Search filters the list.
    fireEvent.change(within(dialog).getByLabelText('Search projects'), { target: { value: 'glob' } });
    expect(within(dialog).queryByRole('button', { name: /Acme/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /Globex/ })).toBeInTheDocument();
  });

  it('opens a project from the selector → header shows its name + tablist', async () => {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Your projects' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Acme/ }));
    expect(await screen.findByText(/PROJECT Acme/)).toBeInTheDocument();
    // The tablist lives in the header bar now.
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    // Switching a tab updates the project view.
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    expect(await screen.findByText(/PROJECT Acme tab=forms/)).toBeInTheDocument();
    // Owners get the always-present Library + Assets side panels; the header "Assets" button
    // force-opens the Assets panel by bumping its openSignal.
    expect(screen.getByText('LIBRARY PANEL')).toBeInTheDocument();
    expect(screen.getByText(/ASSETS PANEL sig=0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByText(/ASSETS PANEL sig=1/)).toBeInTheDocument();
  });

  it('a client (member) project gets no side panels and no tablist', async () => {
    me.mockResolvedValue({
      userId: 'u',
      isInstanceAdmin: false,
      projects: [{ id: 'pm', name: 'Client Co', slug: 'client-co', role: 'member' }],
    });
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Client Co/ }));
    await screen.findByText(/PROJECT Client Co/);
    expect(screen.queryByText('LIBRARY PANEL')).toBeNull();
    expect(screen.queryByText(/ASSETS PANEL/)).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Pages' })).toBeNull();
  });

  it('the header project name re-opens the selector', async () => {
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByRole('dialog', { name: 'Your projects' })).toBeInTheDocument();
  });

  it('New project → modal → create → auto-opens the new project', async () => {
    render(<App />);
    const selector = await screen.findByRole('dialog', { name: 'Your projects' });
    fireEvent.click(within(selector).getByRole('button', { name: 'New project' }));
    const modal = await screen.findByRole('dialog', { name: 'New project' });
    fireEvent.change(within(modal).getByLabelText('Project name'), { target: { value: 'New Co' } });
    // Slug auto-derives from the name.
    expect(within(modal).getByLabelText('Project slug')).toHaveValue('new-co');
    fireEvent.click(within(modal).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith('New Co', 'new-co'));
    expect(await screen.findByText(/PROJECT New Co/)).toBeInTheDocument();
  });
});
