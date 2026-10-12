import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrgMember, Invite } from '../src/api';

const { listMembers, listInvites, removeMember, inviteDeveloper, revokeInvite, approveStaffInvite, resetStaffPassword, listAllMemberTokens } = vi.hoisted(() => ({
  listAllMemberTokens: vi.fn(),
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
    resetStaffPassword: (u: string, revokeMemberTokens?: boolean) => resetStaffPassword(u, revokeMemberTokens),
    listAllMemberTokens: () => listAllMemberTokens(),
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
  listAllMemberTokens.mockReset().mockResolvedValue({ items: [], dailyProjectMax: 50 });
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
    resetStaffPassword.mockResolvedValue({ email: 'dev@acme.test', password: 'Kd8!wRt3-Zn6qVx1', revokedMemberTokens: 0 });
    render(<TeamManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for dev@acme.test' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Issue new password' }));
    // They hold no member tokens, so nothing is asked and nothing is said about them: the server's
    // cautious default applies, which revokes nothing when there is nothing.
    await waitFor(() => expect(resetStaffPassword).toHaveBeenCalledWith('u-dev', undefined));
    expect(await screen.findByText('Kd8!wRt3-Zn6qVx1')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Their member tokens' })).toBeNull();
  });

  describe('issuing a password for someone who has member tokens', () => {
    const tokenOf = (userId: string, status = 'active') => ({ id: `${userId}-${status}`, status, owner: { userId, email: 'x', role: 'developer' } });
    beforeEach(() => {
      // Two working tokens of the dev's; a revoked one of theirs and someone else's do not count.
      listAllMemberTokens.mockResolvedValue({
        items: [tokenOf('u-dev'), { ...tokenOf('u-dev'), id: 'second' }, tokenOf('u-dev', 'revoked'), tokenOf('u-other')],
        dailyProjectMax: 50,
      });
      resetStaffPassword.mockResolvedValue({ email: 'dev@acme.test', password: 'Kd8!wRt3-Zn6qVx1', revokedMemberTokens: 0 });
    });
    /** Opens the reset for the dev and returns the one dialog that both confirms and asks. */
    const open = async () => {
      render(<TeamManager />);
      fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for dev@acme.test' }));
      const dialog = await screen.findByRole('dialog', { name: 'Issue a new password' });
      expect(await screen.findByText(/dev@acme\.test has 2 member tokens that agents or automation sign in with/)).toBeInTheDocument();
      // Neither answer is chosen for the admin, and nothing can be issued until one is.
      expect((screen.getByRole('radio', { name: 'Keep them working' }) as HTMLInputElement).checked).toBe(false);
      expect((screen.getByRole('radio', { name: 'Revoke them' }) as HTMLInputElement).checked).toBe(false);
      expect(screen.getByRole('button', { name: 'Issue new password' })).toBeDisabled();
      expect(resetStaffPassword).not.toHaveBeenCalled();
      return dialog;
    };

    it('★ asks whether to revoke them, and keeps them when told to — a forgotten password is not a breach', async () => {
      await open();
      fireEvent.click(screen.getByRole('radio', { name: 'Keep them working' }));
      fireEvent.click(screen.getByRole('button', { name: 'Issue new password' }));
      await waitFor(() => expect(resetStaffPassword).toHaveBeenCalledWith('u-dev', false));
      expect(await screen.findByText('Kd8!wRt3-Zn6qVx1')).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Issue a new password' })).toBeNull();
    });

    it('revokes them when told to', async () => {
      resetStaffPassword.mockResolvedValue({ email: 'dev@acme.test', password: 'Kd8!wRt3-Zn6qVx1', revokedMemberTokens: 2 });
      await open();
      fireEvent.click(screen.getByRole('radio', { name: 'Revoke them' }));
      fireEvent.click(screen.getByRole('button', { name: 'Issue new password' }));
      await waitFor(() => expect(resetStaffPassword).toHaveBeenCalledWith('u-dev', true));
      expect(await screen.findByText('Kd8!wRt3-Zn6qVx1')).toBeInTheDocument();
    });

    it('★ backing out — Cancel or Escape — resets NOTHING: a dismissal is not an answer', async () => {
      await open();
      fireEvent.click(screen.getByRole('radio', { name: 'Revoke them' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Issue a new password' })).toBeNull());
      expect(resetStaffPassword).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Issue a new password for dev@acme.test' }));
      await screen.findByRole('dialog', { name: 'Issue a new password' });
      // Reopened fresh: the earlier half-made choice is not carried over.
      expect((screen.getByRole('radio', { name: 'Revoke them' }) as HTMLInputElement).checked).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Issue a new password' })).toBeNull());
      expect(resetStaffPassword).not.toHaveBeenCalled();
      expect(screen.queryByText('Kd8!wRt3-Zn6qVx1')).toBeNull();
    });

    it('when the token list cannot be read it still ASKS, without pretending to know how many', async () => {
      listAllMemberTokens.mockRejectedValue(new Error('offline'));
      render(<TeamManager />);
      fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for dev@acme.test' }));
      await screen.findByRole('dialog', { name: 'Issue a new password' });
      expect(screen.getByText(/dev@acme\.test may have member tokens that agents or automation sign in with/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Issue new password' })).toBeDisabled();
      fireEvent.click(screen.getByRole('radio', { name: 'Keep them working' }));
      fireEvent.click(screen.getByRole('button', { name: 'Issue new password' }));
      await waitFor(() => expect(resetStaffPassword).toHaveBeenCalledWith('u-dev', false));
    });

    it('speaks of ONE token in the singular', async () => {
      listAllMemberTokens.mockResolvedValue({ items: [tokenOf('u-dev')], dailyProjectMax: 50 });
      render(<TeamManager />);
      fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for dev@acme.test' }));
      await screen.findByRole('dialog', { name: 'Issue a new password' });
      expect(screen.getByText(/dev@acme\.test has a member token that agents/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Keep it working' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Revoke it' })).toBeInTheDocument();
    });
  });
});
