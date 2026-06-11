import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { login, register, loginTotp, passkeyLoginOptions, passkeyLoginVerify, loginConfig } = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  loginTotp: vi.fn(),
  passkeyLoginOptions: vi.fn(),
  passkeyLoginVerify: vi.fn(),
  loginConfig: vi.fn(),
}));
const { startAuthentication, browserSupportsWebAuthn } = vi.hoisted(() => ({ startAuthentication: vi.fn(), browserSupportsWebAuthn: vi.fn(() => true) }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      login: (e: string, p: string) => login(e, p),
      register: (e: string, p: string) => register(e, p),
      loginTotp: (t: string, c: string) => loginTotp(t, c),
      passkeyLoginOptions: () => passkeyLoginOptions(),
      passkeyLoginVerify: (h: string, r: unknown) => passkeyLoginVerify(h, r),
      loginConfig: () => loginConfig(),
      oidcStartUrl: (id: string) => `/auth/oidc/${id}/start`,
    },
  };
});
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: (o: unknown) => startAuthentication(o),
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
}));

import { Login } from '../src/views/Login';

beforeEach(() => {
  for (const m of [login, register, loginTotp, passkeyLoginOptions, passkeyLoginVerify, startAuthentication, loginConfig]) m.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  loginConfig.mockResolvedValue({ oidcProviders: [] });
});

async function fillCredsAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@acme.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw-secret-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Login', () => {
  it('signs in directly when no second factor is required', async () => {
    login.mockResolvedValue({ userId: 'u' });
    const onAuthed = vi.fn();
    render(<Login onAuthed={onAuthed} />);
    await fillCredsAndSubmit();
    await waitFor(() => expect(onAuthed).toHaveBeenCalled());
    expect(loginTotp).not.toHaveBeenCalled();
  });

  it('prompts for a TOTP code when login returns mfaRequired, then completes via loginTotp', async () => {
    login.mockResolvedValue({ mfaRequired: true, ticket: 'tkt-123' });
    loginTotp.mockResolvedValue({ userId: 'u' });
    const onAuthed = vi.fn();
    render(<Login onAuthed={onAuthed} />);
    await fillCredsAndSubmit();

    // The code step appears (no session yet, onAuthed not called).
    const codeField = await screen.findByLabelText('Authentication code');
    expect(onAuthed).not.toHaveBeenCalled();

    fireEvent.change(codeField, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(loginTotp).toHaveBeenCalledWith('tkt-123', '123456'));
    expect(onAuthed).toHaveBeenCalled();
  });

  it('can switch the code step to a recovery code and redeem it', async () => {
    login.mockResolvedValue({ mfaRequired: true, ticket: 'tkt-9' });
    loginTotp.mockResolvedValue({ userId: 'u' });
    render(<Login onAuthed={vi.fn()} />);
    await fillCredsAndSubmit();
    await screen.findByLabelText('Authentication code');

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: 'AAAAA-BBBBB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(loginTotp).toHaveBeenCalledWith('tkt-9', 'AAAAA-BBBBB'));
  });

  it('shows the server error when a TOTP code is rejected (ticket survives for retry)', async () => {
    login.mockResolvedValue({ mfaRequired: true, ticket: 'tkt-x' });
    const { ApiError } = await vi.importActual<typeof import('../src/api')>('../src/api');
    loginTotp.mockRejectedValue(new ApiError(401, 'invalid code'));
    render(<Login onAuthed={vi.fn()} />);
    await fillCredsAndSubmit();
    await screen.findByLabelText('Authentication code');
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('invalid code')).toBeInTheDocument();
    // Still on the code step.
    expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
  });

  it('signs in with a passkey (no TOTP) → onAuthed', async () => {
    passkeyLoginOptions.mockResolvedValue({ options: { challenge: 'c' }, handle: 'pk-h' });
    startAuthentication.mockResolvedValue({ id: 'cred-1' });
    passkeyLoginVerify.mockResolvedValue({ userId: 'u' });
    const onAuthed = vi.fn();
    render(<Login onAuthed={onAuthed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } }));
    await waitFor(() => expect(passkeyLoginVerify).toHaveBeenCalledWith('pk-h', { id: 'cred-1' }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalled());
  });

  it('routes a TOTP-gated passkey login into the code step', async () => {
    passkeyLoginOptions.mockResolvedValue({ options: { challenge: 'c' }, handle: 'pk-h' });
    startAuthentication.mockResolvedValue({ id: 'cred-1' });
    passkeyLoginVerify.mockResolvedValue({ mfaRequired: true, ticket: 'tkt-pk' });
    loginTotp.mockResolvedValue({ userId: 'u' });
    const onAuthed = vi.fn();
    render(<Login onAuthed={onAuthed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    const codeField = await screen.findByLabelText('Authentication code');
    expect(onAuthed).not.toHaveBeenCalled();
    fireEvent.change(codeField, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(loginTotp).toHaveBeenCalledWith('tkt-pk', '123456'));
    expect(onAuthed).toHaveBeenCalled();
  });

  it('renders a "Sign in with …" link per enabled OIDC provider, pointing at /start', async () => {
    loginConfig.mockResolvedValue({ oidcProviders: [{ id: 'acme', label: 'Acme SSO' }] });
    render(<Login onAuthed={vi.fn()} />);
    const link = await screen.findByRole('link', { name: 'Sign in with Acme SSO' });
    expect(link).toHaveAttribute('href', '/auth/oidc/acme/start');
  });

  it('starts on the TOTP code step when handed an OIDC mfa ticket, then completes', async () => {
    loginTotp.mockResolvedValue({ userId: 'u' });
    const onAuthed = vi.fn();
    render(<Login onAuthed={onAuthed} initialMfaTicket="tkt-oidc" />);
    const codeField = await screen.findByLabelText('Authentication code');
    fireEvent.change(codeField, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(loginTotp).toHaveBeenCalledWith('tkt-oidc', '654321'));
    expect(onAuthed).toHaveBeenCalled();
  });

  it('shows an OIDC callback notice on the sign-in screen', async () => {
    render(<Login onAuthed={vi.fn()} initialNotice="Your account isn’t set up yet." />);
    expect(await screen.findByText('Your account isn’t set up yet.')).toBeInTheDocument();
  });
});
