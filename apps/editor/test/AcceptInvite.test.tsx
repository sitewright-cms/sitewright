import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const peekInvite = vi.fn();
const loginConfig = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    peekInvite: (t: string) => peekInvite(t),
    loginConfig: () => loginConfig(),
    acceptInvite: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    passkeyLoginOptions: vi.fn(),
    oidcStartUrl: (id: string) => `/auth/oidc/${id}/start`,
  },
  ApiError: class ApiError extends Error {},
}));

import { AcceptInvite } from '../src/views/AcceptInvite';

const BRAND = { name: 'SiteWright', logoUrl: null };
const invite = (over: Record<string, unknown> = {}) => ({
  invite: { email: 'client@acme.test', role: 'member', projectName: 'Site A', expired: false, accepted: false, hasAccount: false, ...over },
});

beforeEach(() => {
  peekInvite.mockReset();
  loginConfig.mockReset();
  loginConfig.mockResolvedValue({ oidcProviders: [], allowSelfRegistration: false, branding: BRAND });
});

const noop = () => {};

describe('AcceptInvite', () => {
  it('offers a choice (set a password vs. complete with OIDC) when providers are configured', async () => {
    peekInvite.mockResolvedValue(invite());
    loginConfig.mockResolvedValue({ oidcProviders: [{ id: 'sso', label: 'E2E SSO' }], allowSelfRegistration: false, branding: BRAND });
    render(<AcceptInvite token="t" authed={false} onAuthed={noop} onDone={noop} />);
    // The invited email is disclosed + the project named; the choice screen shows both paths.
    expect(await screen.findByText('client@acme.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up a password' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Complete registration with E2E SSO' })).toHaveAttribute('href', '/auth/oidc/sso/start');
  });

  it('renders a locked-email set-password form (no account, no OIDC)', async () => {
    peekInvite.mockResolvedValue(invite());
    render(<AcceptInvite token="t" authed={false} onAuthed={noop} onDone={noop} />);
    const email = await screen.findByLabelText('Email');
    expect(email).toHaveValue('client@acme.test'); // pre-filled to the invited address…
    expect(email).toBeDisabled(); // …and locked
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument(); // set-password (register) mode
  });

  it('frames the choice as sign-in when the invited email already has an account', async () => {
    peekInvite.mockResolvedValue(invite({ hasAccount: true }));
    loginConfig.mockResolvedValue({ oidcProviders: [{ id: 'sso', label: 'E2E SSO' }], allowSelfRegistration: false, branding: BRAND });
    render(<AcceptInvite token="t" authed={false} onAuthed={noop} onDone={noop} />);
    expect(await screen.findByRole('button', { name: 'Sign in with a password' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with E2E SSO' })).toBeInTheDocument();
  });

  it('auto-accepts once authenticated and calls onDone', async () => {
    const { api } = await import('../src/api');
    (api.acceptInvite as ReturnType<typeof vi.fn>).mockResolvedValue({ projectId: 'p', role: 'member' });
    const onDone = vi.fn();
    peekInvite.mockResolvedValue(invite());
    render(<AcceptInvite token="t" authed onAuthed={noop} onDone={onDone} />);
    await vi.waitFor(() => expect(api.acceptInvite).toHaveBeenCalledWith('t'));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
