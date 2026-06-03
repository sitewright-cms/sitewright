import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrgMember, Invite } from '../src/api';

const { listMembers, listInvites, removeMember, inviteDeveloper, revokeInvite } = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  removeMember: vi.fn(),
  inviteDeveloper: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listMembers: () => listMembers(),
    listInvites: () => listInvites(),
    removeMember: (u: string) => removeMember(u),
    inviteDeveloper: (e: string) => inviteDeveloper(e),
    revokeInvite: (id: string) => revokeInvite(id),
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
    await waitFor(() => expect(inviteDeveloper).toHaveBeenCalledWith('new@acme.test'));
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
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('i-1'));
  });
});
