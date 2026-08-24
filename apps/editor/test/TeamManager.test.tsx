import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrgMember, Invite } from '../src/api';

const { listMembers, listInvites, removeMember, inviteDeveloper, revokeInvite, approveStaffInvite, resetStaffPassword } = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  removeMember: vi.fn(),
  inviteDeveloper: vi.fn(),
  revokeInvite: vi.fn(),
  approveStaffInvite: vi.fn(),
  resetStaffPassword: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listMembers: () => listMembers(),
    listInvites: () => listInvites(),
    removeMember: (u: string) => removeMember(u),
    // Forward BOTH args — the adapter used to drop the role, which silently truncated the call
    // under test rather than failing it.
    inviteDeveloper: (e: string, role?: string) => inviteDeveloper(e, role),
    revokeInvite: (id: string) => revokeInvite(id),
    approveStaffInvite: (id: string) => approveStaffInvite(id),
    resetStaffPassword: (u: string) => resetStaffPassword(u),
  },
}));

import { TeamManager } from '../src/views/TeamManager';

const owner: OrgMember = { userId: 'u-owner', email: 'owner@acme.test', role: 'owner', createdAt: '' };
const dev: OrgMember = { userId: 'u-dev', email: 'dev@acme.test', role: 'developer', createdAt: '' };
const pendingInvite: Invite = { id: 'i-1', email: 'new@acme.test', role: 'developer', projectId: null, expiresAt: '2030-01-01', acceptedAt: null, createdAt: '' };

beforeEach(() => {
  listMembers.mockReset();
  listInvites.mockReset();
  removeMember.mockReset();
  inviteDeveloper.mockReset();
  revokeInvite.mockReset();
  approveStaffInvite.mockReset();
  resetStaffPassword.mockReset();
  listMembers.mockResolvedValue({ members: [owner, dev] });
  listInvites.mockResolvedValue({ invites: [] });
  removeMember.mockResolvedValue(undefined);
  revokeInvite.mockResolvedValue(undefined);
});

describe('TeamManager', () => {
  it('lists staff and invites a developer, revealing a copyable invite link', async () => {
    inviteDeveloper.mockResolvedValue({ invite: pendingInvite, token: 'swi_dev_token' });
    render(<TeamManager />);
    expect(await screen.findByText('dev@acme.test')).toBeInTheDocument();
    // The owner row has no Remove control; the developer row does.
    expect(screen.queryByRole('button', { name: 'Remove owner@acme.test' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove dev@acme.test' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Developer email'), { target: { value: 'new@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite developer' }));
    // The role now travels with every staff invite; developer is the default the picker opens on.
    await waitFor(() => expect(inviteDeveloper).toHaveBeenCalledWith('new@acme.test', 'developer'));
    // The one-time invite link (with the token) is shown to copy.
    expect(await screen.findByText(/\/\?invite=swi_dev_token/)).toBeInTheDocument();
  });

  it('shows only org-level (developer) invites and can revoke them', async () => {
    listInvites.mockResolvedValue({
      invites: [pendingInvite, { ...pendingInvite, id: 'i-2', email: 'client@x.co', projectId: 'p' }],
    });
    render(<TeamManager />);
    // The project-scoped (client) invite is filtered out of the Team tab.
    expect(await screen.findByText('new@acme.test')).toBeInTheDocument();
    expect(screen.queryByText('client@x.co')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invite for new@acme.test' }));
    // Revoking is now guarded by a confirm dialog — confirm it.
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('i-1'));
  });

  it('invites another ADMIN, not only a developer', async () => {
    // An instance is not administrable by one person forever; the role has to be grantable from here.
    inviteDeveloper.mockResolvedValue({ invite: pendingInvite, token: 'swi_admin' });
    render(<TeamManager />);
    await screen.findByText('dev@acme.test');
    fireEvent.change(screen.getByLabelText('Developer email'), { target: { value: 'boss2@acme.test' } });
    fireEvent.change(screen.getByLabelText('Invite role'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite developer' }));
    await waitFor(() => expect(inviteDeveloper).toHaveBeenCalledWith('boss2@acme.test', 'admin'));
  });

  it('approves a pending staff invite outright and reveals the password once', async () => {
    listInvites.mockResolvedValue({ invites: [{ ...pendingInvite, role: 'admin' }] });
    approveStaffInvite.mockResolvedValue({ email: 'new@acme.test', userId: 'u-9', created: true, password: 'Ab3$xYz7-Qm2wKp5' });
    render(<TeamManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve new@acme.test now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveStaffInvite).toHaveBeenCalledWith('i-1'));
    expect(await screen.findByText('Ab3$xYz7-Qm2wKp5')).toBeInTheDocument();
  });

  it('issues a replacement password for another staff account', async () => {
    resetStaffPassword.mockResolvedValue({ email: 'dev@acme.test', password: 'Kd8!wRt3-Zn6qVx1' });
    render(<TeamManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for dev@acme.test' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Issue new password' }));
    await waitFor(() => expect(resetStaffPassword).toHaveBeenCalledWith('u-dev'));
    expect(await screen.findByText('Kd8!wRt3-Zn6qVx1')).toBeInTheDocument();
  });
});
