import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '../src/api';

const { updateEmail, changePassword } = vi.hoisted(() => ({
  updateEmail: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    updateEmail: (email: string, pw: string) => updateEmail(email, pw),
    changePassword: (cur: string, next: string) => changePassword(cur, next),
  },
}));
// Isolate the user menu from the project-scoped key manager + the MFA tab (each has its own tests).
vi.mock('../src/views/ApiKeysManager', () => ({
  ApiKeysManager: ({ project }: { project: Project }) => <div data-testid="api-keys">keys:{project.id}</div>,
}));
vi.mock('../src/views/SecurityTab', () => ({
  SecurityTab: ({ totpEnabled }: { totpEnabled: boolean }) => <div data-testid="security">security:{String(totpEnabled)}</div>,
}));

import { UserMenu } from '../src/views/UserMenu';

const ownerProject: Project = { id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' };
const memberProject: Project = { id: 'p2', name: 'Blog', slug: 'blog', role: 'member' };

function renderMenu(project: Project | null = null, totpEnabled = false, hasPassword = true) {
  const onClose = vi.fn();
  const onEmailChanged = vi.fn();
  const onMfaChanged = vi.fn();
  const onPasswordChanged = vi.fn();
  render(
    <UserMenu
      email="me@acme.test"
      project={project}
      totpEnabled={totpEnabled}
      recoveryCodesRemaining={0}
      hasPassword={hasPassword}
      onClose={onClose}
      onEmailChanged={onEmailChanged}
      onMfaChanged={onMfaChanged}
      onPasswordChanged={onPasswordChanged}
    />,
  );
  return { onClose, onEmailChanged, onMfaChanged, onPasswordChanged };
}

beforeEach(() => {
  updateEmail.mockReset();
  changePassword.mockReset();
});

describe('UserMenu', () => {
  it('shows all four tabs and defaults to Account with the current email prefilled', () => {
    renderMenu();
    for (const t of ['Account', 'Password', 'Access keys', 'Security']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('me@acme.test');
    // Nothing changed yet → the Update button is disabled.
    expect(screen.getByRole('button', { name: 'Update email' })).toBeDisabled();
  });

  it('updates the email after entering a new address + current password', async () => {
    updateEmail.mockResolvedValue({ email: 'new@acme.test' });
    const { onEmailChanged } = renderMenu();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@acme.test' } });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'pw-secret-1' } });
    const btn = screen.getByRole('button', { name: 'Update email' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith('new@acme.test', 'pw-secret-1'));
    expect(onEmailChanged).toHaveBeenCalledWith('new@acme.test');
  });

  it('surfaces an email-change error without closing', async () => {
    updateEmail.mockRejectedValue(new Error('current password is incorrect'));
    renderMenu();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@acme.test' } });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update email' }));
    expect(await screen.findByText('current password is incorrect')).toBeInTheDocument();
  });

  it('changes the password only when the confirmation matches', async () => {
    changePassword.mockResolvedValue(undefined);
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pw-1234' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pw-9876' } });
    // Mismatched confirmation keeps the button disabled.
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } });
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    // Matching confirmation enables it.
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-pw-9876' } });
    const btn = screen.getByRole('button', { name: 'Change password' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pw-1234', 'new-pw-9876'));
  });

  it('offers "Set a password" (no current password) for an account that has none (OIDC)', async () => {
    changePassword.mockResolvedValue(undefined);
    const { onPasswordChanged } = renderMenu(null, false, /* hasPassword */ false);
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    // No current-password field is shown.
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pw-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'brand-new-pw-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    // currentPassword is sent as undefined → the server sets the initial password.
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith(undefined, 'brand-new-pw-1'));
    expect(onPasswordChanged).toHaveBeenCalled();
  });

  it('renders the project key manager on the Access keys tab for an owned project', () => {
    renderMenu(ownerProject);
    fireEvent.click(screen.getByRole('button', { name: 'Access keys' }));
    expect(screen.getByTestId('api-keys')).toHaveTextContent('keys:p1');
  });

  it('shows a hint (no key manager) when no owned project is open', () => {
    renderMenu(null);
    fireEvent.click(screen.getByRole('button', { name: 'Access keys' }));
    expect(screen.queryByTestId('api-keys')).toBeNull();
    expect(screen.getByText(/Open a project you own/)).toBeInTheDocument();
  });

  it('does not expose key management to a non-owner (member) project', () => {
    renderMenu(memberProject);
    fireEvent.click(screen.getByRole('button', { name: 'Access keys' }));
    expect(screen.queryByTestId('api-keys')).toBeNull();
    expect(screen.getByText(/Open a project you own/)).toBeInTheDocument();
  });

  it('renders the Security (MFA) tab, passing through the enabled state', () => {
    renderMenu(null, true);
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    expect(screen.getByTestId('security')).toHaveTextContent('security:true');
  });
});
