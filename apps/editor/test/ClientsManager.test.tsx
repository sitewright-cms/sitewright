import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrgMember, Invite, Project } from '../src/api';

const { listProjectMembers, listProjectInvites, removeProjectMember, inviteClient, revokeInvite, approveProjectInvite, resetProjectMemberPassword } =
  vi.hoisted(() => ({
    listProjectMembers: vi.fn(),
    listProjectInvites: vi.fn(),
    removeProjectMember: vi.fn(),
    inviteClient: vi.fn(),
    revokeInvite: vi.fn(),
    approveProjectInvite: vi.fn(),
    resetProjectMemberPassword: vi.fn(),
  }));
vi.mock('../src/api', () => ({
  api: {
    listProjectMembers: (p: string) => listProjectMembers(p),
    listProjectInvites: (p: string) => listProjectInvites(p),
    removeProjectMember: (p: string, u: string) => removeProjectMember(p, u),
    inviteClient: (p: string, e: string) => inviteClient(p, e),
    revokeInvite: (id: string) => revokeInvite(id),
    approveProjectInvite: (p: string, i: string) => approveProjectInvite(p, i),
    resetProjectMemberPassword: (p: string, u: string) => resetProjectMemberPassword(p, u),
  },
}));

import { ClientsManager } from '../src/views/ClientsManager';

const project = { id: 'p-1', name: 'Acme Site', slug: 'acme' } as Project;
const client: OrgMember = { userId: 'u-1', email: 'client@example.test', role: 'member', createdAt: '' };
const invite: Invite = { id: 'i-1', email: 'new@example.test', role: 'member', projectId: 'p-1', expiresAt: '2030-01-01', acceptedAt: null, createdAt: '' };

const confirmIt = async () => fireEvent.click(await screen.findByRole('button', { name: /^(Approve|Issue new password)$/ }));

beforeEach(() => {
  for (const m of [listProjectMembers, listProjectInvites, removeProjectMember, inviteClient, revokeInvite, approveProjectInvite, resetProjectMemberPassword]) m.mockReset();
  listProjectMembers.mockResolvedValue({ members: [client] });
  listProjectInvites.mockResolvedValue({ invites: [invite] });
});

describe('approving a pending member from the project team screen', () => {
  it('shows the minted password exactly once, and only until dismissed', async () => {
    approveProjectInvite.mockResolvedValue({ email: 'new@example.test', userId: 'u-2', created: true, password: 'Xk7$mQp2-Rw9tLz4' });
    render(<ClientsManager project={project} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Approve new@example.test now' }));
    await confirmIt();
    await waitFor(() => expect(approveProjectInvite).toHaveBeenCalledWith('p-1', 'i-1'));

    // The credential is readable and copyable — it cannot be retrieved again.
    expect(await screen.findByText('Xk7$mQp2-Rw9tLz4')).toBeInTheDocument();
    expect(screen.getByText(/Shown once/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Xk7$mQp2-Rw9tLz4')).toBeNull());
  });

  it('reveals NOTHING when the invitee already had an account', async () => {
    // Approval is a grant, not a credential change — a password panel here would imply their old one broke.
    approveProjectInvite.mockResolvedValue({ email: 'new@example.test', userId: 'u-2', created: false });
    render(<ClientsManager project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve new@example.test now' }));
    await confirmIt();
    await waitFor(() => expect(approveProjectInvite).toHaveBeenCalled());
    expect(screen.queryByText(/Shown once/i)).toBeNull();
  });

  it('does nothing if the admin cancels', async () => {
    render(<ClientsManager project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve new@example.test now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(approveProjectInvite).not.toHaveBeenCalled());
  });
});

describe('issuing a new password for an existing member', () => {
  it('reveals the new password once', async () => {
    resetProjectMemberPassword.mockResolvedValue({ email: 'client@example.test', password: 'Nw3!vTb8-Qs5xKd2' });
    render(<ClientsManager project={project} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for client@example.test' }));
    await confirmIt();
    await waitFor(() => expect(resetProjectMemberPassword).toHaveBeenCalledWith('p-1', 'u-1'));
    expect(await screen.findByText('Nw3!vTb8-Qs5xKd2')).toBeInTheDocument();
  });

  it('surfaces a refusal instead of failing silently', async () => {
    // The server refuses when the member's access reaches beyond this project.
    resetProjectMemberPassword.mockRejectedValue(new Error('forbidden'));
    render(<ClientsManager project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue a new password for client@example.test' }));
    await confirmIt();
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
  });
});
