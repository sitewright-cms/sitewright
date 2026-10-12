import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { MemberTokenView } from '../src/api';

const { listMemberTokens, createMemberToken, deleteMemberToken, listPasskeys, passkeyConfirmOptions, startAuthentication, webauthn, confirmFn, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    listMemberTokens: vi.fn(),
    createMemberToken: vi.fn(),
    deleteMemberToken: vi.fn(),
    listPasskeys: vi.fn(),
    passkeyConfirmOptions: vi.fn(),
    startAuthentication: vi.fn(),
    // Whether this "browser" can do WebAuthn at all — off by default, as in jsdom.
    webauthn: { supported: false },
    confirmFn: vi.fn(),
    ApiError,
  };
});
vi.mock('../src/api', () => ({
  ApiError,
  api: {
    listMemberTokens: () => listMemberTokens(),
    createMemberToken: (body: unknown) => createMemberToken(body),
    deleteMemberToken: (id: string) => deleteMemberToken(id),
    listPasskeys: () => listPasskeys(),
    passkeyConfirmOptions: () => passkeyConfirmOptions(),
  },
}));
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => webauthn.supported,
  startAuthentication: (o: unknown) => startAuthentication(o),
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: (o: unknown) => confirmFn(o), dialog: null }) }));

import { MemberTokensManager } from '../src/views/MemberTokensManager';

const token = (over: Partial<MemberTokenView> = {}): MemberTokenView => ({
  id: 't1',
  name: 'Site fleet',
  capabilities: ['content:read', 'content:write', 'projects:create'],
  tokenPrefix: 'swm_a1b2c3d4',
  dailyProjectLimit: null,
  expiresAt: '2099-01-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const toggle = (label: RegExp | string) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement;

const passkey = (rpId: string | null) => ({ id: 'pk1', name: 'Laptop', rpId, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null });

beforeEach(() => {
  listMemberTokens.mockReset().mockResolvedValue({ items: [], dailyProjectMax: 50 });
  createMemberToken.mockReset();
  deleteMemberToken.mockReset();
  listPasskeys.mockReset().mockResolvedValue({ items: [] });
  passkeyConfirmOptions.mockReset();
  startAuthentication.mockReset();
  webauthn.supported = false;
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
    for (const off of ['content:delete', 'publish', 'deploy', /^Create projects/, /^Rename projects/, /^Delete projects/, /^Manage members and invites/, /^Invite and add members/]) {
      expect(toggle(off).checked).toBe(false);
    }
    // Inviting is its own switch, and says what it really hands out — a login, and for a new address
    // its password.
    expect(screen.getByText(/adds them at once without the invite link.*returns its password to the token.*their own sign-in.*payments included.*after this token is revoked/)).toBeInTheDocument();
    // Rename, delete, managing and inviting only ever work where the member is the owner.
    expect(screen.getAllByText(/projects you own|project you own/)).toHaveLength(4);
    // A limit on creating projects is not asked for until the token may create them.
    expect(screen.queryByLabelText('New projects per day')).toBeNull();
  });

  it('★ a token that may create projects gets a daily limit: the instance maximum unless lowered, never above it', async () => {
    createMemberToken.mockResolvedValue({ token: 'swm_secret', key: token() });
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText(/No member tokens yet/);
    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    fireEvent.click(toggle(/^Create projects/));

    const limit = screen.getByLabelText('New projects per day') as HTMLInputElement;
    expect(limit.value).toBe('50');
    expect(limit.max).toBe('50');
    expect(screen.getByText(/The maximum on this instance is 50, set by an admin\. Left at the maximum, the token follows it if it is changed later\./)).toBeInTheDocument();

    // Left alone, nothing is sent: the token follows the maximum, including a later change to it.
    fireEvent.click(screen.getByRole('button', { name: 'Create member token' }));
    await waitFor(() => expect(createMemberToken).toHaveBeenCalledTimes(1));
    expect(createMemberToken.mock.calls[0]?.[0]).not.toHaveProperty('dailyProjectLimit');

    // Lowered, it is sent. Typing past the maximum is clamped to it — and the maximum is "no limit of its own".
    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet 2' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    fireEvent.change(screen.getByLabelText('New projects per day'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create member token' }));
    await waitFor(() => expect(createMemberToken).toHaveBeenCalledTimes(2));
    expect(createMemberToken.mock.calls[1]?.[0]).toMatchObject({ dailyProjectLimit: 5 });

    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet 3' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    fireEvent.change(screen.getByLabelText('New projects per day'), { target: { value: '9999' } });
    expect((screen.getByLabelText('New projects per day') as HTMLInputElement).value).toBe('50');
    fireEvent.click(screen.getByRole('button', { name: 'Create member token' }));
    await waitFor(() => expect(createMemberToken).toHaveBeenCalledTimes(3));
    expect(createMemberToken.mock.calls[2]?.[0]).not.toHaveProperty('dailyProjectLimit');
  });

  it('shows each token’s effective daily limit — its own, capped by the instance maximum', async () => {
    listMemberTokens.mockResolvedValue({
      items: [
        token({ id: 'a', name: 'Own limit', dailyProjectLimit: 5 }),
        token({ id: 'b', name: 'No limit' }),
        token({ id: 'c', name: 'Minted higher', dailyProjectLimit: 80 }),
        token({ id: 'd', name: 'Cannot create', capabilities: ['content:read'] }),
      ],
      dailyProjectMax: 50,
    });
    render(<MemberTokensManager isInstanceAdmin hasPassword />);
    const row = async (name: string) => (await screen.findByText(name)).closest('li') as HTMLElement;
    expect(within(await row('Own limit')).getByText(/up to 5 new projects a day/)).toBeInTheDocument();
    expect(within(await row('No limit')).getByText(/up to 50 new projects a day/)).toBeInTheDocument();
    expect(within(await row('Minted higher')).getByText(/up to 50 new projects a day/)).toBeInTheDocument();
    expect(within(await row('Cannot create')).queryByText(/new projects a day/)).toBeNull();
  });

  it('mints with exactly the ticked capabilities, shows the secret once, and reloads the list', async () => {
    listMemberTokens.mockResolvedValueOnce({ items: [], dailyProjectMax: 50 }).mockResolvedValueOnce({ items: [token()], dailyProjectMax: 50 });
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
    // No passkey on this account: the password is the one way to confirm, and no button pretends otherwise.
    expect(screen.queryByRole('button', { name: /passkey/ })).toBeNull();
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
    expect(within(row).getByText(/^content:read, content:write, projects:create · up to 50 new projects a day$/)).toBeInTheDocument();
    expect(within(row).getByText(/^Expires /)).toBeInTheDocument();
    expect((screen.getByLabelText('Member token name') as HTMLInputElement).value).toBe('');
    // The password does not linger in the form once it has been used.
    expect((screen.getByLabelText('Your password') as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss token' }));
    expect(screen.queryByLabelText('New member token')).toBeNull();
  });

  it('★ a second click while the first mint is in flight does not mint a second token', async () => {
    let finish: (v: unknown) => void = () => {};
    createMemberToken.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText(/No member tokens yet/);
    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    const form = screen.getByRole('button', { name: 'Create member token' }).closest('form') as HTMLFormElement;
    // Submitted twice before the server answers — Enter held down, or a double click.
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create member token' })).toBeDisabled());
    expect(createMemberToken).toHaveBeenCalledTimes(1);

    finish({ token: 'swm_only', key: token() });
    expect(await screen.findByLabelText('New member token')).toHaveTextContent('swm_only');
    expect(createMemberToken).toHaveBeenCalledTimes(1);
  });

  it('cannot be created with nothing ticked', async () => {
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    await screen.findByText(/No member tokens yet/);
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2-hunter2' } });
    // …nor without a name.
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet' } });
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeEnabled();
    fireEvent.click(toggle('content:read'));
    fireEvent.click(toggle('content:write'));
    expect(screen.getByRole('button', { name: 'Create member token' })).toBeDisabled();
  });

  it('an account with neither a password nor a passkey is told how to get one, and offered no dead button', async () => {
    render(<MemberTokensManager isInstanceAdmin={false} hasPassword={false} />);
    await screen.findByText(/No member tokens yet/);
    expect(screen.queryByLabelText('Your password')).toBeNull();
    expect(screen.getByText(/has neither a password nor a passkey here\. Add a passkey on the Security tab, or set a password/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });

  describe('confirming with a passkey', () => {
    beforeEach(() => {
      webauthn.supported = true;
      listPasskeys.mockResolvedValue({ items: [passkey(window.location.hostname)] });
      passkeyConfirmOptions.mockResolvedValue({ options: { challenge: 'c1' }, handle: 'h1' });
      startAuthentication.mockResolvedValue({ id: 'pk1', type: 'public-key' });
    });

    it('★ offers the passkey beside the password, and mints with the assertion instead of a password', async () => {
      createMemberToken.mockResolvedValue({ token: 'swm_secret', key: token() });
      render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
      const button = await screen.findByRole('button', { name: 'Create with a passkey instead' });
      expect(screen.getByText(/asks for your password or a passkey\./)).toBeInTheDocument();
      // Same rule as the password path: something ticked, and a name.
      expect(button).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet' } });
      fireEvent.click(button);

      await waitFor(() => expect(createMemberToken).toHaveBeenCalledTimes(1));
      expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c1' } });
      const body = createMemberToken.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body).toMatchObject({ name: 'Fleet', passkey: { handle: 'h1', response: { id: 'pk1' } } });
      // Exactly one proof is sent — the server refuses a request carrying both.
      expect(body).not.toHaveProperty('currentPassword');
      expect(await screen.findByLabelText('New member token')).toHaveTextContent('swm_secret');
    });

    it('is the only way in for an account with no password — and the primary action there', async () => {
      render(<MemberTokensManager isInstanceAdmin={false} hasPassword={false} />);
      expect(await screen.findByRole('button', { name: 'Create with a passkey' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Your password')).toBeNull();
      expect(screen.getByText(/asks for a passkey\./)).toBeInTheDocument();
      expect(screen.queryByText(/neither a password nor a passkey/)).toBeNull();
    });

    it('is not offered for a passkey that belongs to another hostname, or in a browser without WebAuthn', async () => {
      listPasskeys.mockResolvedValue({ items: [passkey('elsewhere.example')] });
      const first = render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
      await screen.findByText(/No member tokens yet/);
      await waitFor(() => expect(listPasskeys).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /passkey/ })).toBeNull();
      expect(screen.getByText(/asks for your password\./)).toBeInTheDocument();
      first.unmount();

      webauthn.supported = false;
      listPasskeys.mockClear().mockResolvedValue({ items: [passkey(null)] });
      render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
      await screen.findByText(/No member tokens yet/);
      expect(listPasskeys).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /passkey/ })).toBeNull();
    });

    it('a cancelled prompt and a refused confirmation both say so, and mint nothing', async () => {
      render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
      const button = await screen.findByRole('button', { name: 'Create with a passkey instead' });
      fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet' } });

      startAuthentication.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'NotAllowedError' }));
      fireEvent.click(button);
      expect(await screen.findByRole('alert')).toHaveTextContent('The passkey prompt was cancelled or didn’t complete.');
      expect(createMemberToken).not.toHaveBeenCalled();

      // The server's own reason is shown as it is — it tells the member what to do next.
      createMemberToken.mockRejectedValueOnce(new ApiError(403, 'this passkey was added during this sign-in — sign out and back in to confirm with it, or use your password'));
      fireEvent.click(screen.getByRole('button', { name: 'Create with a passkey instead' }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/added during this sign-in/));
      expect(screen.queryByLabelText('New member token')).toBeNull();
      // The button comes back, so they can try again.
      expect(screen.getByRole('button', { name: 'Create with a passkey instead' })).toBeEnabled();
    });

    it('★ a failure that is NOT a cancelled prompt is not called one — the token may exist', async () => {
      render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
      const button = await screen.findByRole('button', { name: 'Create with a passkey instead' });
      fireEvent.change(screen.getByLabelText('Member token name'), { target: { value: 'Fleet' } });
      // The authenticator answered and the request went out, then the connection dropped.
      createMemberToken.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      fireEvent.click(button);
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
      expect(screen.queryByText(/cancelled/)).toBeNull();
      // Beginning the confirmation can fail too, before any prompt was shown.
      passkeyConfirmOptions.mockRejectedValueOnce(new ApiError(409, 'you have no passkey registered for this hostname'));
      fireEvent.click(screen.getByRole('button', { name: 'Create with a passkey instead' }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('you have no passkey registered for this hostname'));
    });
  });

  it('marks an expired token, and revokes only after the confirm says yes', async () => {
    const dead = token({ id: 't2', name: 'Old', expiresAt: '2020-01-01T00:00:00.000Z' });
    listMemberTokens.mockResolvedValue({ items: [dead], dailyProjectMax: 50 });
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
    listMemberTokens.mockResolvedValue({ items: [], dailyProjectMax: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke member token Old' }));
    await waitFor(() => expect(deleteMemberToken).toHaveBeenCalledWith('t2'));
    expect(await screen.findByText(/No member tokens yet/)).toBeInTheDocument();
  });

  it('surfaces a failed load, a refused mint and a failed revoke', async () => {
    listMemberTokens.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<MemberTokensManager isInstanceAdmin={false} hasPassword />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
    // Until the maximum is known, the form does not invent a limit to offer.
    fireEvent.click(toggle(/^Create projects/));
    expect(screen.queryByLabelText('New projects per day')).toBeNull();
    unmount();

    listMemberTokens.mockResolvedValue({ items: [token()], dailyProjectMax: 50 });
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
