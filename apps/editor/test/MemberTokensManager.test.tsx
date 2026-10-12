import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { MemberTokenView } from '../src/api';

const { listMemberTokens, createMemberToken, deleteMemberToken, confirmFn } = vi.hoisted(() => ({
  listMemberTokens: vi.fn(),
  createMemberToken: vi.fn(),
  deleteMemberToken: vi.fn(),
  confirmFn: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listMemberTokens: () => listMemberTokens(),
    createMemberToken: (body: unknown) => createMemberToken(body),
    deleteMemberToken: (id: string) => deleteMemberToken(id),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: (o: unknown) => confirmFn(o), dialog: null }) }));

import { MemberTokensManager } from '../src/views/MemberTokensManager';

const token = (over: Partial<MemberTokenView> = {}): MemberTokenView => ({
  id: 't1',
  name: 'Site fleet',
  capabilities: ['content:read', 'content:write', 'projects:create'],
  tokenPrefix: 'swm_a1b2c3d4',
  expiresAt: '2099-01-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const toggle = (label: RegExp | string) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement;

beforeEach(() => {
  listMemberTokens.mockReset().mockResolvedValue({ items: [], dailyProjectCap: 50 });
  createMemberToken.mockReset();
  deleteMemberToken.mockReset();
  confirmFn.mockReset();
});

describe('MemberTokensManager', () => {
  it('says how far the token reaches — and that an admin’s reaches everything', async () => {
    const { unmount } = render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    expect(await screen.findByText(/No member tokens yet/)).toBeInTheDocument();
    expect(screen.getByText('every project you can open')).toBeInTheDocument();
    unmount();
    render(<MemberTokensManager isInstanceAdmin hasPassword />);
    expect(await screen.findByText('every project on this instance')).toBeInTheDocument();
  });

  it('★ starts with every account-wide capability OFF, and only the content ones on', async () => {
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText(/No member tokens yet/);
    expect(toggle('content:read').checked).toBe(true);
    expect(toggle('content:write').checked).toBe(true);
    for (const off of ['content:delete', 'publish', 'deploy', /^Create projects/, /^Rename projects/, /^Delete projects/, /^Manage members and invites/, /^Invite members/]) {
      expect(toggle(off).checked).toBe(false);
    }
    // The daily cap the server reported is part of what "Create projects" means.
    expect(screen.getByText(/up to 50 a day per token/)).toBeInTheDocument();
    // Inviting is its own switch, and says what it really hands out.
    expect(screen.getByText(/their own sign-in to a project you own.*payments included.*after this token is revoked/)).toBeInTheDocument();
    // Rename, delete, managing and inviting only ever work where the member is the owner.
    expect(screen.getAllByText(/projects you own|project you own/)).toHaveLength(4);
  });

  it('mints with exactly the ticked capabilities, shows the secret once, and reloads the list', async () => {
    listMemberTokens.mockResolvedValueOnce({ items: [], dailyProjectCap: 50 }).mockResolvedValueOnce({ items: [token()], dailyProjectCap: 50 });
    createMemberToken.mockResolvedValue({ token: 'swm_secret', key: token() });
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText(/No member tokens yet/);

    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Site fleet' } });
    fireEvent.change(screen.getByLabelText('Member token expiry in days'), { target: { value: '90' } });
    // An out-of-range lifetime is ignored rather than sent.
    fireEvent.change(screen.getByLabelText('Member token expiry in days'), { target: { value: '9999' } });
    fireEvent.click(toggle(/^Create projects/));
    fireEvent.click(toggle(/^Delete projects/));
    fireEvent.click(toggle(/^Delete projects/)); // changed their mind
    // Not until the password is given: the token outlives this session.
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create member token' }));

    await waitFor(() =>
      expect(createMemberToken).toHaveBeenCalledWith({
        currentPassword: 'hunter2-hunter2',
        name: 'Site fleet',
        capabilities: ['content:read', 'content:write', 'projects:create'],
        expiresInDays: 90,
      }),
    );
    expect(await screen.findByLabelText('New member token')).toHaveTextContent('swm_secret');
    const row = (await screen.findByText('swm_a1b2c3d4…')).closest('li') as HTMLElement;
    expect(within(row).getByText('Site fleet')).toBeInTheDocument();
    expect(within(row).getByText('content:read, content:write, projects:create')).toBeInTheDocument();
    expect(within(row).getByText(/^Expires /)).toBeInTheDocument();
    expect((screen.getByLabelText('Member token name') as HTMLInputElement).value).toBe('');
    // The password does not linger in the form once it has been used.
    expect((screen.getByLabelText('Your password') as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss token' }));
    expect(screen.queryByLabelText('New member token')).toBeNull();
  });

  it('cannot be created with nothing ticked', async () => {
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText(/No member tokens yet/);
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeEnabled();
    fireEvent.click(toggle('content:read'));
    fireEvent.click(toggle('content:write'));
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeDisabled();
  });

  it('tells a single-sign-on account to set a password first, instead of asking for one it lacks', async () => {
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword={false} />);
    await screen.findByText(/No member tokens yet/);
    expect(screen.queryByLabelText('Your password')).toBeNull();
    expect(screen.getByText(/Set a password on the Password tab first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeDisabled();
  });

  it('marks an expired token, and revokes only after the confirm says yes', async () => {
    const dead = token({ id: 't2', name: 'Old', expiresAt: '2020-01-01T00:00:00.000Z' });
    listMemberTokens.mockResolvedValue({ items: [dead], dailyProjectCap: 50 });
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    const row = (await screen.findByText('Old')).closest('li') as HTMLElement;
    expect(within(row).getByText(/^Expired /)).toBeInTheDocument();

    confirmFn.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Old' }));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(1));
    expect(confirmFn.mock.calls[0]?.[0]).toMatchObject({ title: 'Revoke member token', confirmLabel: 'Revoke' });
    expect((confirmFn.mock.calls[0]?.[0] as { message: string }).message).toMatch(/on every project/);
    expect(deleteMemberToken).not.toHaveBeenCalled();

    confirmFn.mockResolvedValueOnce(true);
    deleteMemberToken.mockResolvedValue(undefined);
    listMemberTokens.mockResolvedValue({ items: [], dailyProjectCap: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Old' }));
    await waitFor(() => expect(deleteMemberToken).toHaveBeenCalledWith('t2'));
    expect(await screen.findByText(/No member tokens yet/)).toBeInTheDocument();
  });

  it('surfaces a failed load, a refused mint and a failed revoke', async () => {
    listMemberTokens.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
    // Until the cap is known, "Create projects" does not invent a number.
    expect(screen.queryByText(/a day per token/)).toBeNull();
    unmount();

    listMemberTokens.mockResolvedValue({ items: [token()], dailyProjectCap: 50 });
    createMemberToken.mockRejectedValue(new Error('you already have 25 active member tokens — revoke one first'));
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText('Site fleet');
    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'One more' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create member token' }));
    expect(await screen.findByText(/already have 25 active member tokens/)).toBeInTheDocument();
    expect(screen.queryByLabelText('New member token')).toBeNull();

    confirmFn.mockResolvedValue(true);
    deleteMemberToken.mockRejectedValue(new Error('member token not found'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Site fleet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('member token not found');
    // A later success clears the stale error rather than leaving it under a list that changed.
    deleteMemberToken.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Site fleet' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
