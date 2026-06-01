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
    listMembers: (o: string) => listMembers(o),
    listInvites: (o: string) => listInvites(o),
    removeMember: (o: string, u: string) => removeMember(o, u),
    inviteDeveloper: (o: string, e: string) => inviteDeveloper(o, e),
    revokeInvite: (o: string, id: string) => revokeInvite(o, id),
  },
}));

import { TeamManager } from '../src/views/TeamManager';

const org = { id: 'o', name: 'O', slug: 'o', role: 'owner' };
const owner: OrgMember = { userId: 'u-owner', email: 'owner@acme.test', role: 'owner', createdAt: '' };
const dev: OrgMember = { userId: 'u-dev', email: 'dev@acme.test', role: 'admin', createdAt: '' };
const pendingInvite: Invite = { id: 'i-1', email: 'new@acme.test', role: 'admin', projectId: null, expiresAt: '2030-01-01', acceptedAt: null, createdAt: '' };

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
    render(<TeamManager org={org} />);
    expect(await screen.findByText('dev@acme.test')).toBeInTheDocument();
    // The owner row has no Remove control; the admin row does.
    expect(screen.queryByRole('button', { name: 'Remove owner@acme.test' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove dev@acme.test' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Developer email'), { target: { value: 'new@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite developer' }));
    await waitFor(() => expect(inviteDeveloper).toHaveBeenCalledWith('o', 'new@acme.test'));
    // The one-time invite link (with the token) is shown to copy.
    expect(await screen.findByText(/\/\?invite=swi_dev_token/)).toBeInTheDocument();
  });

  it('shows only org-level (developer) invites and can revoke them', async () => {
    listInvites.mockResolvedValue({
      invites: [pendingInvite, { ...pendingInvite, id: 'i-2', email: 'client@x.co', projectId: 'p' }],
    });
    render(<TeamManager org={org} />);
    // The project-scoped (client) invite is filtered out of the Team tab.
    expect(await screen.findByText('new@acme.test')).toBeInTheDocument();
    expect(screen.queryByText('client@x.co')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invite for new@acme.test' }));
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('o', 'i-1'));
  });
});
