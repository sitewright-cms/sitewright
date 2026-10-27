import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { Project } from '../src/api';

/**
 * The Bookings tab is CONDITIONAL: it exists only while the open project takes bookings (its booking set-up
 * offers something). Its own file because App.test stubs a tab list without it.
 */
const { me, loginConfig, getSettings, getProjectPayment, getBooking } = vi.hoisted(() => ({
  me: vi.fn(),
  loginConfig: vi.fn(),
  getSettings: vi.fn(),
  getProjectPayment: vi.fn(),
  getBooking: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    me: () => me(),
    loginConfig: () => loginConfig(),
    getSettings: (p: string) => getSettings(p),
    getProjectPayment: (p: string) => getProjectPayment(p),
    getBooking: (p: string) => getBooking(p),
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
  ProjectView: ({ project, tab, onLoaded, onSelectTab, bookingsAvailable }: { project: Project; tab: string; onLoaded?: () => void; onSelectTab?: (t: string) => void; bookingsAvailable?: boolean }) => {
    useEffect(() => {
      onLoaded?.();
    }, [onLoaded]);
    return (
      <div>
        PROJECT {project.name} tab={tab} bookings={String(bookingsAvailable)}
        <button type="button" onClick={() => onSelectTab?.('bookings')}>
          go to bookings
        </button>
      </div>
    );
  },
  MANAGE_TABS: ['corporate-identity', 'website-settings', 'pages', 'forms', 'history', 'orders', 'bookings'] as const,
  TAB_LABELS: { 'corporate-identity': 'Corporate Identity', 'website-settings': 'Website Settings', pages: 'Pages', forms: 'Forms', history: 'History', orders: 'Orders', bookings: 'Bookings' },
  TAB_LABELS_SHORT: { 'corporate-identity': 'Identity', 'website-settings': 'Website', pages: 'Pages', forms: 'Forms', history: 'History', orders: 'Orders', bookings: 'Bookings' },
}));
vi.mock('../src/views/files/AssetsPanel', () => ({ AssetsPanel: () => <div /> }));
vi.mock('../src/views/library/LibraryPanel', () => ({ LibraryPanel: () => <div /> }));
vi.mock('../src/views/code/CodeRailPanels', () => ({ SnippetsPanel: () => <div />, TemplatesPanel: () => <div /> }));
vi.mock('../src/views/widgets/WidgetsPanel', () => ({ WidgetsPanel: () => <div /> }));
vi.mock('../src/views/PublishBar', () => ({ PublishBar: () => <div /> }));

import { App } from '../src/App';
import { notifyBookingChanged } from '../src/lib/booking-active';

const projects: Project[] = [{ id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' }];
const offering = { item: { resources: [{ id: 'anna' }], offerings: [{ id: 'massage' }] } };

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
  getSettings.mockResolvedValue({ item: { website: {} } });
  getProjectPayment.mockResolvedValue({ binding: null });
  getBooking.mockResolvedValue({ item: { resources: [], offerings: [] } });
});

describe('the Bookings tab', () => {
  it('is hidden while the project takes no bookings', async () => {
    await openAcme();
    await waitFor(() => expect(getBooking).toHaveBeenCalledWith('p1'));
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Bookings' })).toBeNull();
    expect(screen.getByText(/bookings=false/)).toBeInTheDocument();
  });

  it('appears while the booking set-up offers something, last, and opens the Bookings view', async () => {
    getBooking.mockResolvedValue(offering);
    await openAcme();
    const bookings = await screen.findByRole('tab', { name: 'Bookings' });
    const names = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names.slice(-2)).toEqual(['History', 'Bookings']);
    expect(screen.getByText(/bookings=true/)).toBeInTheDocument();
    fireEvent.click(bookings);
    expect(await screen.findByText(/tab=bookings/)).toBeInTheDocument();
  });

  it('★ disappears when booking is switched off, and an author on it is moved off it', async () => {
    getBooking.mockResolvedValue(offering);
    await openAcme();
    fireEvent.click(await screen.findByRole('tab', { name: 'Bookings' }));
    await screen.findByText(/tab=bookings/);

    getBooking.mockResolvedValue({ item: { resources: [], offerings: [] } });
    act(() => notifyBookingChanged('p1'));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Bookings' })).toBeNull());
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });

  it('a link to Bookings while booking is off does not strand the author on a missing tab', async () => {
    await openAcme();
    await waitFor(() => expect(getBooking).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'go to bookings' }));
    expect(await screen.findByText(/tab=website-settings/)).toBeInTheDocument();
  });
});
