import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { listPasskeys, passkeyRegisterOptions, passkeyRegisterVerify, renamePasskey, deletePasskey, passkeyConfirmOptions, startAuthentication } = vi.hoisted(() => ({
  passkeyConfirmOptions: vi.fn(),
  startAuthentication: vi.fn(),
  listPasskeys: vi.fn(),
  passkeyRegisterOptions: vi.fn(),
  passkeyRegisterVerify: vi.fn(),
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));
const { startRegistration, browserSupportsWebAuthn } = vi.hoisted(() => ({ startRegistration: vi.fn(), browserSupportsWebAuthn: vi.fn(() => true) }));
const { confirmFn, promptFn } = vi.hoisted(() => ({ confirmFn: vi.fn(), promptFn: vi.fn() }));

const { ApiError } = vi.hoisted(() => ({ ApiError: class ApiError extends Error {} }));
vi.mock('../src/api', () => ({
  ApiError,
  api: {
    listPasskeys: () => listPasskeys(),
    passkeyRegisterOptions: (proof?: unknown) => passkeyRegisterOptions(proof),
    passkeyConfirmOptions: () => passkeyConfirmOptions(),
    passkeyRegisterVerify: (h: string, r: unknown, n: string) => passkeyRegisterVerify(h, r, n),
    renamePasskey: (i: string, n: string) => renamePasskey(i, n),
    deletePasskey: (i: string) => deletePasskey(i),
  },
}));
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (o: unknown) => startRegistration(o),
  startAuthentication: (o: unknown) => startAuthentication(o),
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: (o: unknown) => confirmFn(o), prompt: (o: unknown) => promptFn(o), dialog: null }) }));

import { PasskeysSection } from '../src/views/PasskeysSection';

beforeEach(() => {
  for (const m of [listPasskeys, passkeyRegisterOptions, passkeyRegisterVerify, renamePasskey, deletePasskey, startRegistration, confirmFn, promptFn, passkeyConfirmOptions, startAuthentication]) m.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  listPasskeys.mockResolvedValue({ items: [] });
});

describe('PasskeysSection', () => {
  it('lists existing passkeys', async () => {
    listPasskeys.mockResolvedValue({ items: [{ id: 'c1', name: 'Work Laptop', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }] });
    render(<PasskeysSection hasPassword={false} />);
    expect(await screen.findByText('Work Laptop')).toBeInTheDocument();
  });

  it('names the host of a passkey bound elsewhere, and stands the row down', async () => {
    // jsdom serves pages from `localhost`, so a credential whose rpId is another host cannot be used
    // here — the browser simply will not offer it. The row has to SAY so; a silent list is the bug.
    listPasskeys.mockResolvedValue({
      items: [{ id: 'c1', name: 'Other Host Key', rpId: 'admin.example.com', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }],
    });
    render(<PasskeysSection hasPassword={false} />);

    expect(await screen.findByText(/for admin\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText('Other Host Key').className).toMatch(/text-slate-400/);
  });

  it('leaves a passkey bound to THIS host unlabelled and fully live', async () => {
    listPasskeys.mockResolvedValue({
      items: [{ id: 'c1', name: 'This Host Key', rpId: window.location.hostname, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }],
    });
    render(<PasskeysSection hasPassword={false} />);

    expect(await screen.findByText('This Host Key')).toBeInTheDocument();
    expect(screen.queryByText(/sign in there to use it/)).not.toBeInTheDocument();
    expect(screen.getByText('This Host Key').className).not.toMatch(/text-slate-400/);
  });

  it('treats an unknown rpId (a pre-column passkey) as usable rather than greying out a working key', async () => {
    listPasskeys.mockResolvedValue({
      items: [{ id: 'c1', name: 'Legacy Key', rpId: null, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }],
    });
    render(<PasskeysSection hasPassword={false} />);

    expect(await screen.findByText('Legacy Key')).toBeInTheDocument();
    expect(screen.queryByText(/sign in there to use it/)).not.toBeInTheDocument();
    expect(screen.getByText('Legacy Key').className).not.toMatch(/text-slate-400/);
  });

  it('adds a passkey: prompt name → startRegistration → verify → reload', async () => {
    promptFn.mockResolvedValue('My Phone');
    passkeyRegisterOptions.mockResolvedValue({ options: { challenge: 'c' }, handle: 'h1' });
    startRegistration.mockResolvedValue({ id: 'cred-new' });
    passkeyRegisterVerify.mockResolvedValue({ id: 'cred-new', name: 'My Phone' });
    render(<PasskeysSection hasPassword={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } }));
    await waitFor(() => expect(passkeyRegisterVerify).toHaveBeenCalledWith('h1', { id: 'cred-new' }, 'My Phone'));
    // List re-fetched after adding (mount + post-add).
    await waitFor(() => expect(listPasskeys.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('★ with a password on the account, adding a passkey asks for it — and sends it to begin the registration', async () => {
    promptFn.mockResolvedValueOnce('My Phone').mockResolvedValueOnce('hunter2-hunter2 ');
    passkeyRegisterOptions.mockResolvedValue({ options: { challenge: 'c' }, handle: 'h1' });
    startRegistration.mockResolvedValue({ id: 'cred-new' });
    passkeyRegisterVerify.mockResolvedValue({ id: 'cred-new', name: 'My Phone' });
    render(<PasskeysSection hasPassword />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(passkeyRegisterVerify).toHaveBeenCalledWith('h1', { id: 'cred-new' }, 'My Phone'));
    // The second prompt is for the password: masked, and explained.
    expect(promptFn).toHaveBeenCalledTimes(2);
    expect(promptFn.mock.calls[1]?.[0]).toMatchObject({ title: 'Confirm it is you', label: 'Your password', secret: true });
    // Sent exactly as typed — the prompt does not trim a secret.
    expect(passkeyRegisterOptions).toHaveBeenCalledWith({ currentPassword: 'hunter2-hunter2 ' });
    // The password is the confirmation; no passkey ceremony is run on top of it.
    expect(passkeyConfirmOptions).not.toHaveBeenCalled();
  });

  it('backing out of the password prompt adds nothing', async () => {
    promptFn.mockResolvedValueOnce('My Phone').mockResolvedValueOnce(null);
    render(<PasskeysSection hasPassword />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(promptFn).toHaveBeenCalledTimes(2));
    expect(passkeyRegisterOptions).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('★ with no password but a passkey usable here, the EXISTING passkey confirms the new one', async () => {
    listPasskeys.mockResolvedValue({ items: [{ id: 'c1', name: 'Laptop', rpId: window.location.hostname, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }] });
    promptFn.mockResolvedValue('Second Key');
    passkeyConfirmOptions.mockResolvedValue({ options: { challenge: 'confirm-c' }, handle: 'confirm-h' });
    startAuthentication.mockResolvedValue({ id: 'c1' });
    passkeyRegisterOptions.mockResolvedValue({ options: { challenge: 'c' }, handle: 'h1' });
    startRegistration.mockResolvedValue({ id: 'cred-new' });
    passkeyRegisterVerify.mockResolvedValue({ id: 'cred-new', name: 'Second Key' });
    render(<PasskeysSection hasPassword={false} />);
    await screen.findByText('Laptop');

    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(passkeyRegisterVerify).toHaveBeenCalled());
    // Only the name was asked for; the confirmation was the authenticator's.
    expect(promptFn).toHaveBeenCalledTimes(1);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'confirm-c' } });
    expect(passkeyRegisterOptions).toHaveBeenCalledWith({ passkey: { handle: 'confirm-h', response: { id: 'c1' } } });
  });

  it('a passkey that belongs to another hostname cannot confirm here — the server’s reason is shown, and no device prompt appears', async () => {
    listPasskeys.mockResolvedValue({ items: [{ id: 'c1', name: 'Elsewhere', rpId: 'admin.example.com', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }] });
    promptFn.mockResolvedValue('Here Key');
    passkeyRegisterOptions.mockRejectedValue(new ApiError('none of your passkeys can be used on this hostname, so there is nothing to confirm with here — set a password in Account → Password first'));
    render(<PasskeysSection hasPassword={false} />);
    await screen.findByText('Elsewhere');
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    // It cannot be asked for here, so no ceremony is started with it; the server then says what would work.
    expect(await screen.findByText(/none of your passkeys can be used on this hostname.*set a password/)).toBeInTheDocument();
    expect(passkeyConfirmOptions).not.toHaveBeenCalled();
    expect(passkeyRegisterOptions).toHaveBeenCalledWith(undefined);
    expect(startRegistration).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeEnabled();
  });

  it('does nothing if the name prompt is cancelled', async () => {
    promptFn.mockResolvedValue(null);
    render(<PasskeysSection hasPassword={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(promptFn).toHaveBeenCalled());
    expect(passkeyRegisterOptions).not.toHaveBeenCalled();
  });

  it('removes a passkey after confirmation', async () => {
    listPasskeys.mockResolvedValue({ items: [{ id: 'c1', name: 'Old Key', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }] });
    confirmFn.mockResolvedValue(true);
    deletePasskey.mockResolvedValue(undefined);
    render(<PasskeysSection hasPassword={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Old Key' }));
    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith('c1'));
  });

  it('disables adding and warns when the browser lacks WebAuthn support', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    render(<PasskeysSection hasPassword={false} />);
    expect(await screen.findByText(/doesn’t support passkeys/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
  });
});
