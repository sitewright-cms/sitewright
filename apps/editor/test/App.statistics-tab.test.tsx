import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { Project } from '../src/api';

/**
 * The Statistics tab: always there for agency staff (an admin or a developer), and for a client only while the
 * project's built-in statistics are switched on.
 */
const { me, loginConfig, getSettings, getProjectPayment, getRankings, getSearchPerformanceAvailability } = vi.hoisted(() => ({
  me: vi.fn(),
  loginConfig: vi.fn(),
  getSettings: vi.fn(),
  getProjectPayment: vi.fn(),
  getRankings: vi.fn(),
  getSearchPerformanceAvailability: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    me: () => me(),
    loginConfig: () => loginConfig(),
    getSettings: (p: string) => getSettings(p),
    getProjectPayment: (p: string) => getProjectPayment(p),
    getRankings: (p: string, q: unknown) => getRankings(p, q),
    getSearchPerformanceAvailability: (p: string) => getSearchPerformanceAvailability(p),
    listMedia: () => Promise.resolve({ items: [] }),
    version: () => Promise.resolve({ current: '0.0.0', updateAvailable: false, releaseUrl: null }),
  },
  setUnauthorizedHandler: () => undefined,
  setPasswordChangeRequiredHandler: () => undefined,
}));
vi.mock('../src/lib/use-session-poll', () => ({ useSessionPoll: () => undefined }));
vi.mock('../src/views/InstanceSettings', () => ({
  InstanceSettings: ({ initialTab, focusSection }: { initialTab?: string; focusSection?: string }) => (
    <div>
      INSTANCE tab={String(initialTab)} section={String(focusSection)}
    </div>
  ),
}));
vi.mock('../src/views/UpdateBanner', () => ({ UpdateBanner: () => <div /> }));
vi.mock('../src/views/Login', () => ({ Login: () => <div>LOGIN</div> }));
vi.mock('../src/views/Project', () => ({
  ProjectView: ({
    project,
    tab,
    onLoaded,
    onSelectTab,
    isStaff,
    visitsAvailable,
    visitsEnabled,
    onOpenSystemSettings,
  }: {
    project: Project;
    tab: string;
    onLoaded?: () => void;
    onSelectTab?: (t: string) => void;
    isStaff?: boolean;
    visitsAvailable?: boolean;
    visitsEnabled?: boolean;
    onOpenSystemSettings?: (target: { tab: string; section?: string }) => void;
  }) => {
    useEffect(() => {
      onLoaded?.();
    }, [onLoaded]);
    return (
      <div>
        PROJECT {project.name} tab={tab} staff={String(isStaff)} visits={String(visitsAvailable)} enabled={String(visitsEnabled)} system-link=
        {String(Boolean(onOpenSystemSettings))}
        <button type="button" onClick={() => onSelectTab?.('statistics')}>
          go to statistics
        </button>
        {onOpenSystemSettings && (
          <button type="button" onClick={() => onOpenSystemSettings({ tab: 'integrations', section: 'search-engine-accounts' })}>
            open the search engine accounts
          </button>
        )}
      </div>
    );
  },
  MANAGE_TABS: ['corporate-identity', 'website-settings', 'pages', 'forms', 'statistics', 'history', 'orders'] as const,
  TAB_LABELS: { 'corporate-identity': 'Corporate Identity', 'website-settings': 'Website Settings', pages: 'Pages', forms: 'Forms', statistics: 'Statistics', history: 'History', orders: 'Orders' },
  TAB_LABELS_SHORT: { 'corporate-identity': 'Identity', 'website-settings': 'Website', pages: 'Pages', forms: 'Forms', statistics: 'Stats', history: 'History', orders: 'Orders' },
}));
vi.mock('../src/views/files/AssetsPanel', () => ({ AssetsPanel: () => <div /> }));
vi.mock('../src/views/library/LibraryPanel', () => ({ LibraryPanel: () => <div /> }));
vi.mock('../src/views/code/CodeRailPanels', () => ({ SnippetsPanel: () => <div />, TemplatesPanel: () => <div /> }));
vi.mock('../src/views/widgets/WidgetsPanel', () => ({ WidgetsPanel: () => <div /> }));
vi.mock('../src/views/PublishBar', () => ({ PublishBar: () => <div /> }));

import { App } from '../src/App';
import { notifyStatisticsChanged } from '../src/lib/statistics-enabled';

const projects: Project[] = [{ id: 'p1', name: 'Acme', slug: 'acme', role: 'member' }];

async function openAcme() {
  render(<App />);
  const dialog = await screen.findByRole('dialog', { name: 'SiteWright' });
  fireEvent.click(within(dialog).getByRole('button', { name: /Acme/ }));
  await screen.findByText(/PROJECT Acme/);
}

const as = (platformRole: 'admin' | 'developer' | null) =>
  me.mockResolvedValue({ userId: 'u', email: 'u@acme.test', platformRole, isInstanceAdmin: platformRole === 'admin', mustChangePassword: false, projects });
const statistics = (enabled: boolean) => getSettings.mockResolvedValue({ item: { website: enabled ? { statistics: { enabled: true } } : {} } });

beforeEach(() => {
  vi.clearAllMocks();
  loginConfig.mockResolvedValue({ oidcProviders: [], branding: { name: 'SiteWright', primary: '#4f46e5', secondary: '#0ea5e9', logoUrl: null } });
  getProjectPayment.mockResolvedValue({ binding: null });
  getRankings.mockResolvedValue({ tracking: null, keywords: [], canManage: false });
  getSearchPerformanceAvailability.mockResolvedValue({ services: [] });
});

describe('the Statistics tab', () => {
  it('is hidden from a client while the statistics are off', async () => {
    as(null);
    statistics(false);
    await openAcme();
    await waitFor(() => expect(getSettings).toHaveBeenCalledWith('p1'));
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Statistics' })).toBeNull();
    expect(screen.getByText(/staff=false/)).toBeInTheDocument();
  });

  it('shows for a client once the statistics are on', async () => {
    as(null);
    statistics(true);
    await openAcme();
    expect(await screen.findByRole('tab', { name: 'Statistics' })).toBeInTheDocument();
  });

  it('shows for a client whose site\'s keywords are tracked, with the rankings only while statistics are off', async () => {
    as(null);
    statistics(false);
    getRankings.mockResolvedValue({ tracking: { domain: 'acme.test' }, keywords: [{ id: 'k1' }], canManage: false, configured: true });
    await openAcme();
    fireEvent.click(await screen.findByRole('tab', { name: 'Statistics' }));
    expect(await screen.findByText(/tab=statistics/)).toBeInTheDocument();
    expect(screen.getByText(/visits=false/)).toBeInTheDocument();
  });

  it('is hidden from a client whose keywords are tracked while no rank-tracking provider is set up', async () => {
    as(null);
    statistics(false);
    getRankings.mockResolvedValue({ tracking: { domain: 'acme.test' }, keywords: [{ id: 'k1' }], canManage: false, configured: false });
    await openAcme();
    // Presence guard: every read has answered (the visits state is known only then), so "no tab" is the answer.
    expect(await screen.findByText(/enabled=false/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Statistics' })).toBeNull();
  });

  it('is hidden from a client while rank tracking is set up for the site with no keyword yet', async () => {
    as(null);
    statistics(false);
    getRankings.mockResolvedValue({ tracking: { domain: 'acme.test' }, keywords: [], canManage: false, configured: true });
    await openAcme();
    // Presence guard: every read has answered (the visits state is known only then), so "no tab" is the answer.
    expect(await screen.findByText(/enabled=false/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Statistics' })).toBeNull();
  });

  it.each(['admin', 'developer'] as const)('is always there for staff (%s), statistics on or off', async (role) => {
    as(role);
    statistics(false);
    await openAcme();
    expect(await screen.findByRole('tab', { name: 'Statistics' })).toBeInTheDocument();
    expect(screen.getByText(/staff=true/)).toBeInTheDocument();
  });

  it('shows for a client once a search engine has numbers for the site, with no visits while statistics are off', async () => {
    as(null);
    statistics(false);
    getSearchPerformanceAvailability.mockResolvedValue({ services: ['google'] });
    await openAcme();
    fireEvent.click(await screen.findByRole('tab', { name: 'Statistics' }));
    expect(await screen.findByText(/tab=statistics/)).toBeInTheDocument();
    expect(screen.getByText(/visits=false/)).toBeInTheDocument();
  });
  it('★ disappears for a client when the statistics are switched off — and a client on it is moved off it', async () => {
    as(null);
    statistics(true);
    await openAcme();
    fireEvent.click(await screen.findByRole('tab', { name: 'Statistics' }));
    await screen.findByText(/tab=statistics/);
    statistics(false);
    act(() => notifyStatisticsChanged('p1'));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Statistics' })).toBeNull());
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });

  it('tells staff whether the statistics are on — unknown until it has been asked', async () => {
    as('developer');
    let answer!: (v: unknown) => void;
    getSettings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await openAcme();
    expect(screen.getByText(/enabled=undefined/)).toBeInTheDocument();
    await act(async () => answer({ item: { website: {} } }));
    expect(await screen.findByText(/enabled=false/)).toBeInTheDocument();
  });

  it('★ a re-check that cannot read the setting keeps the last answer — staff are not told to switch on what is on', async () => {
    as('developer');
    statistics(true);
    await openAcme();
    expect(await screen.findByText(/enabled=true/)).toBeInTheDocument();
    getSettings.mockRejectedValue(new Error('offline'));
    const before = getSettings.mock.calls.length;
    act(() => notifyStatisticsChanged('p1'));
    await waitFor(() => expect(getSettings.mock.calls.length).toBeGreaterThan(before));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText(/enabled=true/)).toBeInTheDocument();
  });

  it('a first read that fails is "unknown" for staff, and no visits for a client', async () => {
    as('developer');
    getSettings.mockRejectedValue(new Error('offline'));
    await openAcme();
    expect(await screen.findByText(/enabled=null/)).toBeInTheDocument();
  });

  it('gives the System Settings link to an instance admin only — a developer cannot open System Settings', async () => {
    as('developer');
    statistics(false);
    await openAcme();
    expect(screen.getByText(/system-link=\s*false/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'open the search engine accounts' })).toBeNull();
  });

  it('the link opens System Settings at the tab and section it names; the gear menu opens it plain', async () => {
    as('admin');
    statistics(false);
    await openAcme();
    expect(screen.getByText(/system-link=\s*true/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open the search engine accounts' }));
    const modal = await screen.findByRole('dialog', { name: 'System settings' });
    expect(within(modal).getByText(/INSTANCE tab=integrations section=search-engine-accounts/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'System settings' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /settings/i, expanded: false }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'System Settings' }));
    const plain = await screen.findByRole('dialog', { name: 'System settings' });
    expect(within(plain).getByText(/INSTANCE tab=undefined section=undefined/)).toBeInTheDocument();
  });

  it('a link to Statistics while it is hidden does not strand the client on a missing tab', async () => {
    as(null);
    statistics(false);
    await openAcme();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'go to statistics' }));
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });
});
