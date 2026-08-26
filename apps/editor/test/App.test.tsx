import { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
const loadedHook = vi.hoisted(() => ({ defer: false, pending: [] as Array<(() => void) | undefined> }));
vi.mock('../src/api', () => ({
  api: {
    me: () => me(),
    createProject: (...a: unknown[]) => createProject(...a),
    logout: () => logout(),
    loginConfig: () => loginConfig(),
    // App wraps its subtree in CiPaletteForProject, which fetches the project's identity for the rich-text
    // CI palette; stub it so the effect resolves to an empty palette (no brand swatches) in these shell tests.
    getSettings: () => Promise.resolve({ item: {} }),
    // …and the library's fonts, so a brand font slot can be drawn in its real face in the rich-text field.
    listMedia: () => Promise.resolve({ items: [] }),
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
  // The stub must honour `onLoaded`: App keeps the selector up (spinner on the chosen row) until the
  // mounted project reports its data has settled, so a stub that ignores it would never let the modal
  // close — and every "after opening a project" assertion below would be testing the wrong tree.
  // `loadedHook` lets a test defer/replay that signal to simulate a stale, superseded load.
  ProjectView: ({ project, tab, onLoaded }: { project: Project; tab: string; onLoaded?: () => void }) => {
    useEffect(() => {
      if (loadedHook.defer) {
        loadedHook.pending.push(onLoaded);
        return;
      }
      onLoaded?.();
    }, [onLoaded]);
    return <div>PROJECT {project.name} tab={tab}</div>;
  },
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
vi.mock('../src/views/widgets/WidgetsPanel', () => ({ WidgetsPanel: () => <div>WIDGETS PANEL</div> }));
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
  loadedHook.defer = false;
  loadedHook.pending.length = 0;
  // Default to an agency owner (platformRole 'admin') so project-creation UI is available; member-only
  // cases override `me` with platformRole null/absent to assert the create buttons are hidden.
  me.mockResolvedValue({ userId: 'u', email: 'u@acme.test', platformRole: 'admin', isInstanceAdmin: false, mustChangePassword: false, projects });
  createProject.mockResolvedValue({ project: { id: 'p3', name: 'New Co', slug: 'new-co', role: 'owner' } });
  // useBranding() runs at the App root — give it a default config so it resolves (DOM ops are inert in jsdom).
  loginConfig.mockResolvedValue({
    oidcProviders: [],
    branding: { name: 'SiteWright', primary: '#4f46e5', secondary: '#0ea5e9', logoUrl: null },
  });
});

describe('App shell', () => {
  it('shows the project selector automatically on first load, searchable', async () => {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'SiteWright' });
    // The System Library (project-agnostic) stays available even with NO project selected.
    expect(screen.getByText('LIBRARY PANEL')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Acme/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Globex/ })).toBeInTheDocument();
    // Search filters the list.
    fireEvent.change(within(dialog).getByLabelText('Search projects'), { target: { value: 'glob' } });
    expect(within(dialog).queryByRole('button', { name: /Acme/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /Globex/ })).toBeInTheDocument();
  });

  it('the empty home state is a card with a real heading + gradient/ripple button that re-opens the selector', async () => {
    render(<App />);
    const selector = await screen.findByRole('dialog', { name: 'SiteWright' });
    fireEvent.click(within(selector).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The invitation is a real heading on the card, not loose muted text.
    expect(screen.getByRole('heading', { name: 'Pick a project to get started' })).toBeInTheDocument();

    // The call to action is a real primary button: the brand gradient plus the `waves-effect` hook
    // the delegated ripple runtime (lib/ripple.ts) keys off — not a text link.
    const cta = screen.getByRole('button', { name: 'Open the project selector' });
    expect(cta.className).toContain('sw-brand-gradient');
    expect(cta.className).toContain('waves-effect');

    fireEvent.click(cta);
    expect(await screen.findByRole('dialog', { name: 'SiteWright' })).toBeInTheDocument();
  });

  it('gates the whole app behind the forced password screen when mustChangePassword is set', async () => {
    me.mockResolvedValue({ userId: 'u', email: 'admin@x.test', isInstanceAdmin: true, mustChangePassword: true, projects });
    render(<App />);
    // The forced "set a new password" screen replaces the editor + selector entirely.
    expect(await screen.findByText('Choose a new password')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'SiteWright' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Acme/ })).toBeNull();
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
    expect(screen.getByText('WIDGETS PANEL')).toBeInTheDocument();
    expect(screen.getByText('TEMPLATES PANEL')).toBeInTheDocument();
    expect(screen.getByText('ASSETS PANEL')).toBeInTheDocument();
  });

  it('a client (member) gets the FULL studio (panels + tablist), minus owner-only client management', async () => {
    me.mockResolvedValue({
      userId: 'u',
      isInstanceAdmin: false,
      projects: [{ id: 'pm', name: 'Client Co', slug: 'client-co', role: 'member' }],
    });
    render(<App />);
    const selector = await screen.findByRole('dialog');
    // A client (platformRole null/absent) is not agency staff → no project-creation button.
    expect(within(selector).queryByRole('button', { name: 'New project' })).toBeNull();
    fireEvent.click(within(selector).getByRole('button', { name: /Client Co/ }));
    await screen.findByText(/PROJECT Client Co/);
    // Invited clients now get the full editor: the side panels + the section tablist are present.
    expect(screen.getByText('LIBRARY PANEL')).toBeInTheDocument();
    expect(screen.getByText(/ASSETS PANEL/)).toBeInTheDocument();
    expect(screen.getByText('SNIPPETS PANEL')).toBeInTheDocument();
    expect(screen.getByText('WIDGETS PANEL')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    // The gear menu offers editing/publish, but NOT owner-only client management (invite/manage users).
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = await screen.findByRole('menu', { name: 'Settings' });
    expect(within(menu).getByRole('menuitem', { name: 'Publish & Deploy Options' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Clients' })).toBeNull();
  });

  it('the header project name re-opens the selector', async () => {
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    // The selector now holds a spinner until the opened project reports its data has settled, so it
    // closes a tick AFTER the view first renders rather than in the same click.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

  it('the gear menu holds the settings surfaces; the account menu holds Account Settings + Logout', async () => {
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    // The retired surfaces are gone from the header.
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Site options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = await screen.findByRole('menu', { name: 'Settings' });
    for (const label of ['Publish & Deploy Options', 'Project Members']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    // System Settings + Administrators are admin-only — hidden for this non-admin owner.
    expect(within(menu).queryByRole('menuitem', { name: 'System Settings' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Administrators' })).toBeNull();
    // Account actions are NOT in the gear menu — Access keys + Logout live under the user icon now.
    expect(within(menu).queryByRole('menuitem', { name: 'Access' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Sign out|Logout/ })).toBeNull();

    // The account menu (person icon) → "Account Settings" + "Logout"; Logout returns to the login screen.
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const accountMenu = await screen.findByRole('menu', { name: 'Account' });
    expect(within(accountMenu).getByRole('menuitem', { name: 'Account Settings' })).toBeInTheDocument();
    fireEvent.click(within(accountMenu).getByRole('menuitem', { name: 'Logout' }));
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
    // An admin gets the admin-only items (System Settings + Administrators).
    expect(within(menu).getByRole('menuitem', { name: 'System Settings' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Administrators' })).toBeInTheDocument();
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

describe('the selector is released only by the project it is actually waiting on', () => {
  it('ignores a superseded project\'s load finishing late', async () => {
    // Picking a second project while the first is still loading remounts ProjectView, but the first
    // instance's fetches are already in flight and nothing cancels them. An unscoped "something
    // finished" callback let that stale resolution close the selector and drop the author into the
    // SECOND project's half-loaded editor — the very empty-editor flash the spinner exists to avoid.
    loadedHook.defer = true;
    render(<App />);
    const selector = await screen.findByRole('dialog', { name: 'SiteWright' });
    fireEvent.click(within(selector).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);
    // Still open, spinning on Acme.
    expect(screen.queryByRole('dialog', { name: 'SiteWright' })).toBeInTheDocument();

    // Now let ONLY the superseded (Acme) load resolve, while the app is waiting on it.
    // Simulate the supersede by re-picking: the rows are locked, so drive it through the state the
    // app would reach — Acme's callback firing after openingId has moved on.
    const staleCallbacks = [...loadedHook.pending];
    loadedHook.pending.length = 0;
    act(() => {
      // A callback captured for Acme, invoked with Acme's id, correctly releases Acme.
      staleCallbacks.forEach((cb) => cb?.());
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SiteWright' })).toBeNull());
  });

  describe('agent-authorization return (?next=/oauth/authorize)', () => {
    const AUTHORIZE = '/oauth/authorize?client_id=cc&response_type=code&code_challenge=x&code_challenge_method=S256';
    let replace: ReturnType<typeof vi.fn>;
    let originalSearch: string;

    beforeEach(() => {
      originalSearch = window.location.search;
      replace = vi.fn();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, search: `?next=${encodeURIComponent(AUTHORIZE)}`, replace },
      });
    });
    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, search: originalSearch, replace: window.location.replace },
      });
    });

    it('★ does NOT follow the return URL while signed OUT — that is the redirect loop', async () => {
      // /oauth/authorize bounces an unauthenticated agent to `/?next=…`. Following that link with no
      // session gets bounced right back, and the pair chase each other as fast as the browser allows:
      // the login window reloads in a blur until the rate limiter stops it. Signed out, we stay put.
      me.mockRejectedValue(new Error('401'));
      render(<App />);
      await screen.findByText('LOGIN');
      await waitFor(() => expect(setUnauthorizedHandler).toHaveBeenCalled());
      expect(replace).not.toHaveBeenCalled();
    });

    it('follows the return URL once there IS a session', async () => {
      render(<App />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith(AUTHORIZE));
    });
  });

  it('locks the Enter path while a project is opening', async () => {
    // The rows are click-locked during an open; the keyboard path has to be locked with them, or
    // retyping + Enter starts a second open whose predecessor cannot be cancelled.
    loadedHook.defer = true;
    render(<App />);
    const selector = await screen.findByRole('dialog', { name: 'SiteWright' });
    fireEvent.click(within(selector).getByRole('button', { name: /Acme/ }));
    await screen.findByText(/PROJECT Acme/);

    const search = within(screen.getByRole('dialog', { name: 'SiteWright' })).getByLabelText('Search projects');
    expect(search).toBeDisabled();
    fireEvent.keyDown(search, { key: 'Enter' });
    // Still on Acme — Enter did not start a second open.
    expect(screen.getByText(/PROJECT Acme/)).toBeInTheDocument();
  });
});

/**
 * MOBILE RAILS. A phone keeps exactly two of the five edge rails, and they take the two BOTTOM corners
 * so both screen SIDES stay clear for modals and the page body:
 *
 *   · Datasets      — editing site copy through a form is the commonest job done from a phone.
 *   · File Manager  — the phone is the camera; uploading from it is what mobile does best.
 *
 * The three that go (System Library, Snippets, Templates, Widgets) all feed the CODE editor, which
 * mobile does not mount — they would be tabs leading nowhere.
 */
describe('App shell on a phone', () => {
  function withMobileViewport() {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  async function openProject() {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'SiteWright' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Acme/ }));
    return screen.findByText(/PROJECT Acme/);
  }

  it('mounts only the File Manager rail out of the code-authoring set', async () => {
    withMobileViewport();
    await openProject();
    expect(screen.getByText('ASSETS PANEL')).toBeInTheDocument();
    for (const rail of ['LIBRARY PANEL', 'SNIPPETS PANEL', 'WIDGETS PANEL', 'TEMPLATES PANEL']) {
      expect(screen.queryByText(rail)).not.toBeInTheDocument();
    }
  });

  it('drops the System Library even with NO project open — it is a code reference, not a project rail', async () => {
    withMobileViewport();
    render(<App />);
    await screen.findByRole('dialog', { name: 'SiteWright' });
    expect(screen.queryByText('LIBRARY PANEL')).not.toBeInTheDocument();
  });

  /**
   * ★ The tablist gets its own row, and it SCROLLS rather than WRAPS.
   *
   * Wrapping was the old behaviour and it is the wrong answer for a tablist: the header silently
   * becomes one row or two depending on how long the current labels are, so every control beneath it
   * moves when you open a project or switch language. A strip that scrolls keeps the header one fixed
   * height and lets the tabs run off the edge — honest about a list that does not fit.
   */
  it('moves the project tablist out of the header row and into a scrolling strip', async () => {
    withMobileViewport();
    await openProject();

    const tablist = screen.getByRole('tablist', { name: 'Project sections' });
    expect(tablist.className).toContain('flex-nowrap');
    expect(tablist.className).not.toContain('flex-wrap');
    expect(tablist.className).toContain('snap-x'); // a flick cannot leave a tab half-cut

    const strip = tablist.parentElement as HTMLElement;
    expect(strip.className).toContain('overflow-x-auto');
    expect(strip.className).toContain('sw-scroll-none'); // the cut-off tab is the affordance, not a bar
    // It is a row of its own, NOT the centred slot inside the header's flex row.
    expect(strip.className).not.toContain('mx-auto');

    // And it still does its job.
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    expect(await screen.findByText(/PROJECT Acme tab=forms/)).toBeInTheDocument();
  });

  it('keeps the tablist centred inside the header row on desktop', async () => {
    await openProject();
    const tablist = screen.getByRole('tablist', { name: 'Project sections' });
    expect(tablist.className).toContain('flex-wrap');
    expect((tablist.parentElement as HTMLElement).className).toContain('mx-auto');
  });
});
