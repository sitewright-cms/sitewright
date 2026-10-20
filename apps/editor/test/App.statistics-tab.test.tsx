import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { Project } from '../src/api';

/**
 * The Statistics tab: always there for agency staff (an admin or a developer), and for a client only while the
 * project's built-in statistics are switched on.
 */
const { me, loginConfig, getSettings, getProjectPayment } = vi.hoisted(() => ({
  me: vi.fn(),
  loginConfig: vi.fn(),
  getSettings: vi.fn(),
  getProjectPayment: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    me: () => me(),
    loginConfig: () => loginConfig(),
    getSettings: (p: string) => getSettings(p),
    getProjectPayment: (p: string) => getProjectPayment(p),
    listMedia: () => Promise.resolve({ items: [] }),
  },
  setUnauthorizedHandler: () => undefined,
  setPasswordChangeRequiredHandler: () => undefined,
}));
vi.mock('../src/lib/use-session-poll', () => ({ useSessionPoll: () => undefined }));
vi.mock('../src/views/InstanceSettings', () => ({ InstanceSettings: () => <div /> }));
vi.mock('../src/views/UpdateBanner', () => ({ UpdateBanner: () => <div /> }));
vi.mock('../src/views/Login', () => ({ Login: () => <div>LOGIN</div> }));
vi.mock('../src/views/Project', () => ({
  ProjectView: ({ project, tab, onLoaded, onSelectTab, isStaff }: { project: Project; tab: string; onLoaded?: () => void; onSelectTab?: (t: string) => void; isStaff?: boolean }) => {
    useEffect(() => {
      onLoaded?.();
    }, [onLoaded]);
    return (
      <div>
        PROJECT {project.name} tab={tab} staff={String(isStaff)}
        <button type="button" onClick={() => onSelectTab?.('statistics')}>
          go to statistics
        </button>
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

  it.each(['admin', 'developer'] as const)('is always there for staff (%s), statistics on or off', async (role) => {
    as(role);
    statistics(false);
    await openAcme();
    expect(await screen.findByRole('tab', { name: 'Statistics' })).toBeInTheDocument();
    expect(screen.getByText(/staff=true/)).toBeInTheDocument();
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

  it('a link to Statistics while it is hidden does not strand the client on a missing tab', async () => {
    as(null);
    statistics(false);
    await openAcme();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'go to statistics' }));
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });
});
