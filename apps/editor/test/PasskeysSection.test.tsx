import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { listPasskeys, passkeyRegisterOptions, passkeyRegisterVerify, renamePasskey, deletePasskey } = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  passkeyRegisterOptions: vi.fn(),
  passkeyRegisterVerify: vi.fn(),
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));
const { startRegistration, browserSupportsWebAuthn } = vi.hoisted(() => ({ startRegistration: vi.fn(), browserSupportsWebAuthn: vi.fn(() => true) }));
const { confirmFn, promptFn } = vi.hoisted(() => ({ confirmFn: vi.fn(), promptFn: vi.fn() }));

vi.mock('../src/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    listPasskeys: () => listPasskeys(),
    passkeyRegisterOptions: () => passkeyRegisterOptions(),
    passkeyRegisterVerify: (h: string, r: unknown, n: string) => passkeyRegisterVerify(h, r, n),
    renamePasskey: (i: string, n: string) => renamePasskey(i, n),
    deletePasskey: (i: string) => deletePasskey(i),
  },
}));
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (o: unknown) => startRegistration(o),
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: (o: unknown) => confirmFn(o), prompt: (o: unknown) => promptFn(o), dialog: null }) }));

import { PasskeysSection } from '../src/views/PasskeysSection';

beforeEach(() => {
  for (const m of [listPasskeys, passkeyRegisterOptions, passkeyRegisterVerify, renamePasskey, deletePasskey, startRegistration, confirmFn, promptFn]) m.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  listPasskeys.mockResolvedValue({ items: [] });
});

describe('PasskeysSection', () => {
  it('lists existing passkeys', async () => {
    listPasskeys.mockResolvedValue({ items: [{ id: 'c1', name: 'Work Laptop', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }] });
    render(<PasskeysSection />);
    expect(await screen.findByText('Work Laptop')).toBeInTheDocument();
  });

  it('adds a passkey: prompt name → startRegistration → verify → reload', async () => {
    promptFn.mockResolvedValue('My Phone');
    passkeyRegisterOptions.mockResolvedValue({ options: { challenge: 'c' }, handle: 'h1' });
    startRegistration.mockResolvedValue({ id: 'cred-new' });
    passkeyRegisterVerify.mockResolvedValue({ id: 'cred-new', name: 'My Phone' });
    render(<PasskeysSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } }));
    await waitFor(() => expect(passkeyRegisterVerify).toHaveBeenCalledWith('h1', { id: 'cred-new' }, 'My Phone'));
    // List re-fetched after adding (mount + post-add).
    await waitFor(() => expect(listPasskeys.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('does nothing if the name prompt is cancelled', async () => {
    promptFn.mockResolvedValue(null);
    render(<PasskeysSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(promptFn).toHaveBeenCalled());
    expect(passkeyRegisterOptions).not.toHaveBeenCalled();
  });

  it('removes a passkey after confirmation', async () => {
    listPasskeys.mockResolvedValue({ items: [{ id: 'c1', name: 'Old Key', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }] });
    confirmFn.mockResolvedValue(true);
    deletePasskey.mockResolvedValue(undefined);
    render(<PasskeysSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Old Key' }));
    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith('c1'));
  });

  it('disables adding and warns when the browser lacks WebAuthn support', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    render(<PasskeysSection />);
    expect(await screen.findByText(/doesn’t support passkeys/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
  });
});
