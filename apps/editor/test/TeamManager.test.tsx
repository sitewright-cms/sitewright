import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrgMember } from '../src/api';

const { listMembers, addMember, removeMember } = vi.hoisted(() => ({
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listMembers: (o: string) => listMembers(o),
    addMember: (o: string, email: string) => addMember(o, email),
    removeMember: (o: string, userId: string) => removeMember(o, userId),
  },
}));

import { TeamManager } from '../src/views/TeamManager';

const org = { id: 'o', name: 'O', slug: 'o', role: 'owner' };
const owner: OrgMember = { userId: 'u-owner', email: 'owner@acme.test', role: 'owner', createdAt: '' };
const client: OrgMember = { userId: 'u-client', email: 'client@acme.test', role: 'member', createdAt: '' };

beforeEach(() => {
  listMembers.mockReset();
  addMember.mockReset();
  removeMember.mockReset();
  listMembers.mockResolvedValue({ members: [owner] });
  removeMember.mockResolvedValue(undefined);
});

describe('TeamManager', () => {
  it('adds a client and reveals the one-time password once', async () => {
    addMember.mockResolvedValue({ member: client, tempPassword: 's3cr3t-temp-pw' });
    render(<TeamManager org={org} />);
    expect(await screen.findByText('owner@acme.test')).toBeInTheDocument();

    // After adding, the list re-fetch includes the client.
    listMembers.mockResolvedValue({ members: [owner, client] });
    fireEvent.change(screen.getByLabelText('Client email'), { target: { value: 'client@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add client' }));

    await waitFor(() => expect(addMember).toHaveBeenCalledWith('o', 'client@acme.test'));
    // The one-time password is shown for the inviter to share.
    expect(await screen.findByText('s3cr3t-temp-pw')).toBeInTheDocument();
    expect(await screen.findByText('client@acme.test')).toBeInTheDocument();
  });

  it('removes a member (the owner row has no Remove control)', async () => {
    listMembers.mockResolvedValue({ members: [owner, client] });
    render(<TeamManager org={org} />);
    await screen.findByText('client@acme.test');
    // The owner cannot be removed from this surface.
    expect(screen.queryByRole('button', { name: 'Remove owner@acme.test' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove client@acme.test' }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('o', 'u-client'));
  });

  it('surfaces an add error without crashing', async () => {
    addMember.mockRejectedValue(new Error('user is already a member of this organization'));
    render(<TeamManager org={org} />);
    fireEvent.change(await screen.findByLabelText('Client email'), { target: { value: 'dup@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add client' }));
    expect(await screen.findByText(/already a member/i)).toBeInTheDocument();
  });
});
