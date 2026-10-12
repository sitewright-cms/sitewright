import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { MemberTokenAdminView } from '../src/api';

const { listAllMemberTokens, revokeMemberTokenAsAdmin, confirmFn } = vi.hoisted(() => ({
  listAllMemberTokens: vi.fn(),
  revokeMemberTokenAsAdmin: vi.fn(),
  confirmFn: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listAllMemberTokens: () => listAllMemberTokens(),
    revokeMemberTokenAsAdmin: (id: string) => revokeMemberTokenAsAdmin(id),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: (o: unknown) => confirmFn(o), dialog: null }) }));

import { MemberTokensAdminModal } from '../src/views/settings/MemberTokensAdminModal';

const row = (over: Partial<MemberTokenAdminView> = {}): MemberTokenAdminView => ({
  id: 't1',
  name: 'Site fleet',
  capabilities: ['content:read', 'content:write', 'projects:create'],
  tokenPrefix: 'swm_a1b2c3d4',
  dailyProjectLimit: 5,
  expiresAt: '2099-01-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  owner: { userId: 'u-dev', email: 'dev@agency.test', role: 'developer' },
  status: 'active',
  projectsUsed: 3,
  projectsCreatedToday: 2,
  ...over,
});

const FLEET = row();
const REPORTING = row({ id: 't2', name: 'Reporting', tokenPrefix: 'swm_22222222', capabilities: ['content:read'], dailyProjectLimit: null, owner: { userId: 'u-admin', email: 'admin@agency.test', role: 'admin' }, projectsUsed: 1, projectsCreatedToday: 0, lastUsedAt: new Date(Date.now() - 5 * 60_000).toISOString() });
const REVOKED = row({ id: 't3', name: 'Old import', tokenPrefix: 'swm_33333333', status: 'revoked', revokedAt: '2026-09-01T00:00:00.000Z' });
const EXPIRED = row({ id: 't4', name: 'Lapsed', tokenPrefix: 'swm_44444444', status: 'expired', expiresAt: '2026-01-01T00:00:00.000Z' });
const SUSPENDED = row({ id: 't5', name: 'Left the team', tokenPrefix: 'swm_55555555', status: 'suspended', owner: { userId: 'u-gone', email: 'gone@agency.test', role: null } });

const card = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

beforeEach(() => {
  listAllMemberTokens.mockReset().mockResolvedValue({ items: [FLEET, REPORTING, REVOKED, EXPIRED], dailyProjectMax: 50 });
  revokeMemberTokenAsAdmin.mockReset().mockResolvedValue(undefined);
  confirmFn.mockReset();
});

describe('MemberTokensAdminModal', () => {
  it('★ shows every working token with its owner, reach and activity', async () => {
    render(<MemberTokensAdminModal onClose={() => {}} />);
    expect(await screen.findByText('Site fleet')).toBeInTheDocument();
    expect(screen.getByTestId('member-token-counts')).toHaveTextContent('2 active · 2 revoked or expired');

    const fleet = card('Site fleet');
    expect(within(fleet).getByText('dev@agency.test')).toBeInTheDocument();
    expect(within(fleet).getByText('developer')).toBeInTheDocument();
    expect(within(fleet).getByText('Active')).toBeInTheDocument();
    expect(within(fleet).getByText('swm_a1b2c3d4…')).toBeInTheDocument();
    expect(within(fleet).getByText('content:read, content:write, projects:create')).toBeInTheDocument();
    // Its own limit (5), not the instance's 50 — and how much of it is used.
    expect(within(fleet).getByText(/never used\s+· used on 3 projects · 2 of 5 new projects in the last 24 hours/)).toBeInTheDocument();

    const reporting = card('Reporting');
    expect(within(reporting).getByText('admin')).toBeInTheDocument();
    expect(within(reporting).getByText(/used 5m ago\s+· used on 1 project$/)).toBeInTheDocument();
    // A token that cannot create projects has no creation count to show.
    expect(within(reporting).queryByText(/new projects in the last 24 hours/)).toBeNull();
  });

  it('a token minted above the current maximum is shown at what actually binds it', async () => {
    listAllMemberTokens.mockResolvedValue({ items: [row({ dailyProjectLimit: 80 }), row({ id: 'x', name: 'Unlimited', dailyProjectLimit: null })], dailyProjectMax: 10 });
    render(<MemberTokensAdminModal onClose={() => {}} />);
    expect(within(card((await screen.findByText('Site fleet')).textContent ?? '')).getByText(/2 of 10 new projects/)).toBeInTheDocument();
    expect(within(card('Unlimited')).getByText(/2 of 10 new projects/)).toBeInTheDocument();
  });

  it('keeps revoked and expired tokens behind a switch, and says what each one is', async () => {
    listAllMemberTokens.mockResolvedValue({ items: [FLEET, REVOKED, EXPIRED, SUSPENDED], dailyProjectMax: 50 });
    render(<MemberTokensAdminModal onClose={() => {}} />);
    await screen.findByText('Site fleet');
    for (const hidden of ['Old import', 'Lapsed', 'Left the team']) expect(screen.queryByText(hidden)).toBeNull();
    // A token that never acted on a project says nothing about projects, rather than "used on 0".
    listAllMemberTokens.mockResolvedValue({ items: [FLEET, REVOKED, EXPIRED, SUSPENDED, row({ id: 'idle', name: 'Idle', projectsUsed: 0, capabilities: ['content:read'] })], dailyProjectMax: 50 });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show revoked and expired' }));
    expect(within(card('Old import')).getByText('Revoked')).toBeInTheDocument();
    expect(within(card('Old import')).getByText(/revoked Sep 1, 2026/)).toBeInTheDocument();
    expect(within(card('Lapsed')).getByText('Expired')).toBeInTheDocument();
    expect(within(card('Lapsed')).getByText(/expired Jan 1, 2026/)).toBeInTheDocument();
    expect(within(card('Left the team')).getByText('Owner is no longer staff')).toBeInTheDocument();
    // A revoked token has nothing left to revoke; an expired or suspended one still can be.
    expect(within(card('Old import')).queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(within(card('Lapsed')).getByRole('button', { name: /Revoke/ })).toBeInTheDocument();
    expect(within(card('Left the team')).getByRole('button', { name: /Revoke/ })).toBeInTheDocument();
  });

  it('filters by owner or token name', async () => {
    render(<MemberTokensAdminModal onClose={() => {}} />);
    await screen.findByText('Site fleet');
    fireEvent.change(screen.getByLabelText('Filter member tokens'), { target: { value: 'ADMIN@' } });
    expect(screen.queryByText('Site fleet')).toBeNull();
    expect(screen.getByText('Reporting')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter member tokens'), { target: { value: 'fleet' } });
    expect(screen.getByText('Site fleet')).toBeInTheDocument();
    expect(screen.queryByText('Reporting')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter member tokens'), { target: { value: 'zzz' } });
    expect(screen.getByText('No member token matches that filter.')).toBeInTheDocument();
  });

  it('★ revokes only after the admin confirms — naming the owner, because it is someone else’s token', async () => {
    render(<MemberTokensAdminModal onClose={() => {}} />);
    await screen.findByText('Site fleet');
    const revoke = () => fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Site fleet of dev@agency.test' }));

    confirmFn.mockResolvedValueOnce(false);
    revoke();
    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(1));
    const asked = confirmFn.mock.calls[0]?.[0] as { title: string; message: string; confirmLabel: string };
    expect(asked).toMatchObject({ title: 'Revoke member token', confirmLabel: 'Revoke' });
    expect(asked.message).toMatch(/“Site fleet”, owned by dev@agency\.test.*on every project/);
    expect(revokeMemberTokenAsAdmin).not.toHaveBeenCalled();

    confirmFn.mockResolvedValueOnce(true);
    listAllMemberTokens.mockResolvedValue({ items: [REPORTING, { ...FLEET, status: 'revoked', revokedAt: '2026-10-12T00:00:00.000Z' }], dailyProjectMax: 50 });
    revoke();
    await waitFor(() => expect(revokeMemberTokenAsAdmin).toHaveBeenCalledWith('t1'));
    // The list is re-read, so it shows what the server now says rather than what was clicked.
    await waitFor(() => expect(screen.queryByText('Site fleet')).toBeNull());
    expect(screen.getByTestId('member-token-counts')).toHaveTextContent('1 active · 1 revoked or expired');
  });

  it('says so when there are none, when none are active, and when loading or revoking fails', async () => {
    listAllMemberTokens.mockResolvedValueOnce({ items: [], dailyProjectMax: 50 });
    const empty = render(<MemberTokensAdminModal onClose={() => {}} />);
    expect(await screen.findByText('No member tokens have been created on this instance.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter member tokens')).toBeNull();
    empty.unmount();

    listAllMemberTokens.mockResolvedValueOnce({ items: [REVOKED], dailyProjectMax: 50 });
    const dead = render(<MemberTokensAdminModal onClose={() => {}} />);
    expect(await screen.findByText('No active member tokens.')).toBeInTheDocument();
    expect(screen.getByTestId('member-token-counts')).toHaveTextContent('0 active · 1 revoked or expired');
    dead.unmount();

    listAllMemberTokens.mockRejectedValueOnce(new Error('instance admin access required'));
    const failed = render(<MemberTokensAdminModal onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('instance admin access required');
    expect(screen.queryByText(/Loading member tokens/)).toBeNull();
    failed.unmount();

    render(<MemberTokensAdminModal onClose={() => {}} />);
    await screen.findByText('Site fleet');
    confirmFn.mockResolvedValue(true);
    revokeMemberTokenAsAdmin.mockRejectedValueOnce(new Error('member token not found'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Site fleet of dev@agency.test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('member token not found');
  });
});
