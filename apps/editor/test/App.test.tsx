import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { Project } from '../src/api';

const { me, createProject, logout, loginConfig, setUnauthorizedHandler, useSessionPoll } = vi.hoisted(() => ({
  me: vi.fn(),
  createProject: vi.fn(),
  logout: vi.fn(),
  loginConfig: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  useSessionPoll: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    me: () => me(),
    createProject: (...a: unknown[]) => createProject(...a),
    logout: () => logout(),
    loginConfig: () => loginConfig(),
  },
  setUnauthorizedHandler: (fn: (() => void) | undefined) => setUnauthorizedHandler(fn),
}));
// The poll mechanics are unit-tested in use-session-poll.test.ts; here we only assert App enables it
// (active=true) when authenticated and disables it (false) on the login screen.
vi.mock('../src/lib/use-session-poll', () => ({
  useSessionPoll: (active: boolean, cb: () => void, ms?: number) => useSessionPoll(active, cb, ms),
}));
// Heavy children stubbed — App is the unit under test (shell + selector + header).
vi.mock('../src/views/Project', () => ({
  ProjectView: ({ project, tab }: { project: Project; tab: string }) => <div>PROJECT {project.name} tab={tab}</div>,
  MANAGE_TABS: ['pages', 'forms'] as const,
  TAB_LABELS: { pages: 'Pages', forms: 'Forms' },
}));
vi.mock('../src/views/files/AssetsPanel', () => ({
  AssetsPanel: () => <div>ASSETS PANEL</div>,
}));
vi.mock('../src/views/library/LibraryPanel', () => ({ LibraryPanel: () => <div>LIBRARY PANEL</div> }));
vi.mock('../src/views/code/CodeRailPanels', () => ({
  SnippetsPanel: () => <div>SNIPPETS PANEL</div>,
  TemplatesPanel: () => <div>TEMPLATES PANEL</div>,
}));
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
  me.mockResolvedValue({ userId: 'u', email: 'u@acme.test', isInstanceAdmin: false, projects });
  createProject.mockResolvedValue({ project: { id: 'p3', name: 'New Co', slug: 'new-co', role: 'owner' } });
  // useBranding() runs at the App root — give it a default config so it resolves (DOM ops are inert in jsdom).
  loginConfig.mockResolvedValue({
    oidcProviders: [],
    allowSelfRegistration: false,
    branding: { name: 'SiteWright', primary: '#4f46e5', secondary: '#0ea5e9', logoUrl: null },
  });
});

describe('App shell', () => {
  it('shows the project selector automatically on first load, searchable', async () => {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'SiteWright' });
    expect(within(dialog).getByRole('button', { name: /Acme/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Globex/ })).toBeInTheDocument();
    // Search filters the list.
    fireEvent.change(within(dialog).getByLabelText('Search projects'), { target: { value: 'glob' } });
    expect(within(dialog).queryByRole('button', { name: /Acme/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /Globex/ })).toBeInTheDocument();
  });

  it('opens a project from the selector → header shows its name + tablist', async () => {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'SiteWright' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Acme/ }));
    expect(await screen.findByText(/PROJECT Acme/)).toBeInTheDocument();
    // The tablist lives in the header bar now.
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    // Switching a tab updates the project view.
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    expect(await screen.findByText(/PROJECT Acme tab=forms/)).toBeInTheDocument();
    // Owners get the always-present side panels (File Manager / Library / code rails).
    expect(screen.getByText('LIBRARY PANEL')).toBeInTheDocument();
    expect(screen.getByText('SNIPPETS PANEL')).toBeInTheDocument();
    expect(screen.getByText('TEMPLATES PANEL')).toBeInTheDocument();
    expect(screen.getByText('ASSETS PANEL')).toBeInTheDocument();
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
    expect(screen.queryByText('SNIPPETS PANEL')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Pages' })).toBeNull();
  });

  it('the header project name re-opens the selector', async () => {
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByRole('dialog', { name: 'SiteWright' })).toBeInTheDocument();
  });

  it('New project → modal → create → auto-opens the new project', async () => {
    render(<App />);
    const selector = await screen.findByRole('dialog', { name: 'SiteWright' });
    fireEvent.click(within(selector).getByRole('button', { name: 'New project' }));
    const modal = await screen.findByRole('dialog', { name: 'New project' });
    fireEvent.change(within(modal).getByLabelText('Project name'), { target: { value: 'New Co' } });
    // Slug auto-derives from the name.
    expect(within(modal).getByLabelText('Project slug')).toHaveValue('new-co');
    fireEvent.click(within(modal).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith('New Co', 'new-co'));
    expect(await screen.findByText(/PROJECT New Co/)).toBeInTheDocument();
  });

  it('the header gear menu unifies the settings surfaces + Sign out (no legacy Admin/⋮)', async () => {
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    // The retired surfaces are gone from the header.
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Site options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull(); // moved into the menu

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = await screen.findByRole('menu', { name: 'Settings' });
    for (const label of ['Publish & Deploy Options', 'Clients']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    // System Settings + Team are admin-only — hidden for this non-admin owner.
    expect(within(menu).queryByRole('menuitem', { name: 'System Settings' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Team' })).toBeNull();
    // Access keys moved out of the gear menu into the user/account menu (person icon).
    expect(within(menu).queryByRole('menuitem', { name: 'Access' })).toBeNull();
    // The account menu lives next to the gear.
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();

    // Sign out lives in the menu and returns to the login screen.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('shows System Settings in the gear menu for an instance admin', async () => {
    me.mockResolvedValue({ userId: 'u', isInstanceAdmin: true, projects });
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = await screen.findByRole('menu', { name: 'Settings' });
    // An admin gets the admin-only items (System Settings + Team).
    expect(within(menu).getByRole('menuitem', { name: 'System Settings' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Team' })).toBeInTheDocument();
  });

  it('returns an authenticated user to the login screen when a request reports a 401', async () => {
    render(<App />);
    // Sign in + open a project so we are in an AUTHENTICATED stage (not loading/auth).
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    // App registered an on-401 handler; invoke the latest one to simulate a session-expiry 401.
    const handler = setUnauthorizedHandler.mock.calls.at(-1)?.[0] as (() => void) | undefined;
    expect(handler).toBeTypeOf('function');
    act(() => handler!());
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('ignores a 401 while not signed in (no spurious redirect / state churn on the auth screen)', async () => {
    // The bootstrap /me rejects → the app sits on the auth screen.
    me.mockRejectedValue(new Error('unauthenticated'));
    render(<App />);
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    // A 401 arriving here (e.g. a stray retry) must be a no-op — still the same login screen.
    const handler = setUnauthorizedHandler.mock.calls.at(-1)?.[0] as (() => void) | undefined;
    act(() => handler?.());
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });

  it('enables the session-expiry poll while authenticated', async () => {
    render(<App />);
    await screen.findByRole('dialog'); // signed in → selector (home)
    expect(useSessionPoll.mock.calls.at(-1)?.[0]).toBe(true);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/); // still authenticated (project)
    expect(useSessionPoll.mock.calls.at(-1)?.[0]).toBe(true);
  });

  it('disables the session-expiry poll on the login screen', async () => {
    me.mockRejectedValue(new Error('unauthenticated'));
    render(<App />);
    await screen.findByText('LOGIN');
    expect(useSessionPoll.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
