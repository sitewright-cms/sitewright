import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { Project } from '../src/api';

/**
 * The Orders tab is CONDITIONAL: it exists only while the open project's payments are actually active
 * (shop on + a complete gateway binding). Its own file because App.test stubs a tab list without it.
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
}));
vi.mock('../src/lib/use-session-poll', () => ({ useSessionPoll: () => undefined }));
vi.mock('../src/views/InstanceSettings', () => ({ InstanceSettings: () => <div /> }));
vi.mock('../src/views/UpdateBanner', () => ({ UpdateBanner: () => <div /> }));
vi.mock('../src/views/Login', () => ({ Login: () => <div>LOGIN</div> }));
vi.mock('../src/views/Project', () => ({
  ProjectView: ({ project, tab, onLoaded, onSelectTab, ordersAvailable }: { project: Project; tab: string; onLoaded?: () => void; onSelectTab?: (t: string) => void; ordersAvailable?: boolean }) => {
    useEffect(() => {
      onLoaded?.();
    }, [onLoaded]);
    return (
      <div>
        PROJECT {project.name} tab={tab} orders={String(ordersAvailable)}
        <button type="button" onClick={() => onSelectTab?.('orders')}>
          go to orders
        </button>
      </div>
    );
  },
  MANAGE_TABS: ['corporate-identity', 'website-settings', 'pages', 'forms', 'history', 'orders'] as const,
  TAB_LABELS: { 'corporate-identity': 'Corporate Identity', 'website-settings': 'Website Settings', pages: 'Pages', forms: 'Forms', history: 'History', orders: 'Orders' },
  TAB_LABELS_SHORT: { 'corporate-identity': 'Identity', 'website-settings': 'Website', pages: 'Pages', forms: 'Forms', history: 'History', orders: 'Orders' },
}));
vi.mock('../src/views/files/AssetsPanel', () => ({ AssetsPanel: () => <div /> }));
vi.mock('../src/views/library/LibraryPanel', () => ({ LibraryPanel: () => <div /> }));
vi.mock('../src/views/code/CodeRailPanels', () => ({ SnippetsPanel: () => <div />, TemplatesPanel: () => <div /> }));
vi.mock('../src/views/widgets/WidgetsPanel', () => ({ WidgetsPanel: () => <div /> }));
vi.mock('../src/views/PublishBar', () => ({ PublishBar: () => <div /> }));

import { App } from '../src/App';
import { notifyPaymentsChanged } from '../src/lib/payments-active';

const projects: Project[] = [{ id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' }];
const complete = { gatewayId: 'stripe', mode: 'live', fields: { test: [], live: [] }, missing: [], orphaned: [], complete: true };

async function openAcme() {
  render(<App />);
  const dialog = await screen.findByRole('dialog', { name: 'SiteWright' });
  fireEvent.click(within(dialog).getByRole('button', { name: /Acme/ }));
  await screen.findByText(/PROJECT Acme/);
}

beforeEach(() => {
  vi.clearAllMocks();
  me.mockResolvedValue({ userId: 'u', email: 'u@acme.test', platformRole: 'admin', isInstanceAdmin: false, mustChangePassword: false, projects });
  loginConfig.mockResolvedValue({ oidcProviders: [], branding: { name: 'SiteWright', primary: '#4f46e5', secondary: '#0ea5e9', logoUrl: null } });
  getSettings.mockResolvedValue({ item: { website: { shop: { enabled: true } } } });
  getProjectPayment.mockResolvedValue({ binding: null });
});

describe('the Orders tab', () => {
  it('is hidden while payments are not active', async () => {
    await openAcme();
    await waitFor(() => expect(getProjectPayment).toHaveBeenCalledWith('p1'));
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Orders' })).toBeNull();
    expect(screen.getByText(/orders=false/)).toBeInTheDocument();
  });

  it('appears once payments are active, after History, and opens the Orders view', async () => {
    getProjectPayment.mockResolvedValue({ binding: complete });
    await openAcme();
    const orders = await screen.findByRole('tab', { name: 'Orders' });
    const names = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names.slice(-2)).toEqual(['History', 'Orders']);
    expect(screen.getByText(/orders=true/)).toBeInTheDocument();
    fireEvent.click(orders);
    expect(await screen.findByText(/tab=orders/)).toBeInTheDocument();
  });

  it('★ disappears when payments switch off — and an author on it is moved off it', async () => {
    getProjectPayment.mockResolvedValue({ binding: complete });
    await openAcme();
    fireEvent.click(await screen.findByRole('tab', { name: 'Orders' }));
    await screen.findByText(/tab=orders/);

    getProjectPayment.mockResolvedValue({ binding: null });
    act(() => notifyPaymentsChanged('p1'));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Orders' })).toBeNull());
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });

  it('a link to Orders while they are not available does not strand the author on a missing tab', async () => {
    await openAcme();
    await waitFor(() => expect(getProjectPayment).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'go to orders' }));
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });
});
