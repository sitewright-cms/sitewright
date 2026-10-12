import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Project } from '../src/api';

const { updateEmail, changePassword, listMemberTokens } = vi.hoisted(() => ({
  updateEmail: vi.fn(),
  changePassword: vi.fn(),
  listMemberTokens: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    updateEmail: (email: string, pw: string) => updateEmail(email, pw),
    changePassword: (cur: string, next: string, revokeMemberTokens?: boolean) => changePassword(cur, next, revokeMemberTokens),
    listMemberTokens: () => listMemberTokens(),
  },
}));
// Isolate the user menu from the project-scoped key manager + the MFA tab (each has its own tests).
vi.mock('../src/views/ApiKeysManager', () => ({
  ApiKeysManager: ({ project }: { project: Project }) => <div data-testid="api-keys">keys:{project.id}</div>,
}));
vi.mock('../src/views/MemberTokensManager', () => ({
  MemberTokensManager: ({ isInstanceAdmin, hasPassword }: { isInstanceAdmin: boolean; hasPassword: boolean }) => (
    <div data-testid="member-tokens">
      member-tokens:{String(isInstanceAdmin)}:{String(hasPassword)}
    </div>
  ),
}));
vi.mock('../src/views/SecurityTab', () => ({
  SecurityTab: ({ totpEnabled, hasPassword }: { totpEnabled: boolean; hasPassword: boolean }) => (
    <div data-testid="security">
      security:{String(totpEnabled)}:{String(hasPassword)}
    </div>
  ),
}));

import { UserMenu } from '../src/views/UserMenu';

const ownerProject: Project = { id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' };
const memberProject: Project = { id: 'p2', name: 'Blog', slug: 'blog', role: 'member' };

function renderMenu(project: Project | null = null, totpEnabled = false, hasPassword = true, staff: { isStaff?: boolean; isInstanceAdmin?: boolean } = {}) {
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
      {...staff}
      onClose={onClose}
      onEmailChanged={onEmailChanged}
      onMfaChanged={onMfaChanged}
      onPasswordChanged={onPasswordChanged}
    />,
  );
  return { onClose, onEmailChanged, onMfaChanged, onPasswordChanged };
}

/** A member token as the list returns it; only its expiry matters to the password tab. */
const memberToken = (id: string, expiresAt = '2099-01-01T00:00:00.000Z') => ({ id, name: id, expiresAt });

/** Opens the Password tab and fills in a valid change. */
function fillPasswordChange() {
  fireEvent.click(screen.getByRole('button', { name: 'Password' }));
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pw-1234' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'New-pw-9876' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'New-pw-9876' } });
}

beforeEach(() => {
  updateEmail.mockReset();
  changePassword.mockReset();
  listMemberTokens.mockReset().mockResolvedValue({ items: [], dailyProjectMax: 50 });
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
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Pw-secret-1' } });
    const btn = screen.getByRole('button', { name: 'Update email' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith('new@acme.test', 'Pw-secret-1'));
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
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'New-pw-9876' } });
    // Mismatched confirmation keeps the button disabled.
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } });
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    // Matching confirmation (and a policy-compliant new password) enables it.
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'New-pw-9876' } });
    const btn = screen.getByRole('button', { name: 'Change password' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    // A client holds no member tokens: nothing is asked about them and nothing is said about them.
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pw-1234', 'New-pw-9876', undefined));
    expect(listMemberTokens).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Member tokens' })).toBeNull();
  });

  it('offers "Set a password" (no current password) for an account that has none (OIDC)', async () => {
    changePassword.mockResolvedValue(undefined);
    const { onPasswordChanged } = renderMenu(null, false, /* hasPassword */ false);
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    // No current-password field is shown.
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Brand-new-pw-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Brand-new-pw-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    // currentPassword is sent as undefined → the server sets the initial password.
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith(undefined, 'Brand-new-pw-1', undefined));
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

  it('★ shows a PROJECT TOKENS and a MEMBER TOKENS section to agency staff', () => {
    renderMenu(ownerProject, false, true, { isStaff: true });
    fireEvent.click(screen.getByRole('button', { name: 'Access keys' }));
    const project = screen.getByRole('region', { name: 'Project tokens' });
    const member = screen.getByRole('region', { name: 'Member tokens' });
    expect(within(project).getByTestId('api-keys')).toHaveTextContent('keys:p1');
    expect(within(member).getByTestId('member-tokens')).toHaveTextContent('member-tokens:false:true');
    // Project tokens come first: they are the narrower, more common choice.
    expect(project.compareDocumentPosition(member) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps member tokens available with NO project open — they belong to the member, not a project', () => {
    // …and a single-sign-on account (no password) is passed through, so the manager can say why it
    // cannot confirm a new token yet.
    renderMenu(null, false, false, { isStaff: true, isInstanceAdmin: true });
    fireEvent.click(screen.getByRole('button', { name: 'Access keys' }));
    expect(screen.getByTestId('member-tokens')).toHaveTextContent('member-tokens:true:false');
    expect(within(screen.getByRole('region', { name: 'Project tokens' })).getByText(/Open a project you own/)).toBeInTheDocument();
  });

  it('hides the member tokens section from an invited client, who cannot hold one', () => {
    renderMenu(memberProject);
    fireEvent.click(screen.getByRole('button', { name: 'Access keys' }));
    expect(screen.getByRole('region', { name: 'Project tokens' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Member tokens' })).toBeNull();
    expect(screen.queryByTestId('member-tokens')).toBeNull();
  });

  describe('changing the password as staff — what happens to member tokens', () => {
    const staff = { isStaff: true };

    it('★ ASKS, and will not change the password until the member has answered', async () => {
      listMemberTokens.mockResolvedValue({ items: [memberToken('a'), memberToken('b'), memberToken('expired', '2020-01-01T00:00:00.000Z')], dailyProjectMax: 50 });
      changePassword.mockResolvedValue(undefined);
      renderMenu(null, false, true, staff);
      fillPasswordChange();

      // Only the two WORKING tokens are counted — an expired one has nothing left to revoke.
      const question = await screen.findByRole('group', { name: 'Member tokens' });
      expect(within(question).getByText(/sign in with your 2 member tokens, not with your password/)).toBeInTheDocument();
      // Named by the words on screen, so "click Keep them working" means the same to everyone.
      const keep = screen.getByRole('radio', { name: 'Keep them working' }) as HTMLInputElement;
      const revoke = screen.getByRole('radio', { name: 'Revoke them' }) as HTMLInputElement;
      expect(keep).toHaveAccessibleDescription('For a routine change. Nothing that uses a token is interrupted.');
      expect(revoke).toHaveAccessibleDescription(/If someone else may know your password\./);
      // Neither answer is pre-selected: a default would be a decision made for them.
      expect(keep.checked).toBe(false);
      expect(revoke.checked).toBe(false);
      expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();

      fireEvent.click(keep);
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
      await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pw-1234', 'New-pw-9876', false));
    });

    it('revokes them when that is the answer, and then has nothing left to ask about', async () => {
      listMemberTokens.mockResolvedValue({ items: [memberToken('only')], dailyProjectMax: 50 });
      changePassword.mockResolvedValue(undefined);
      renderMenu(null, false, true, staff);
      fillPasswordChange();
      // One token: the wording is singular.
      expect(await screen.findByText(/sign in with your member token, not with your password\. What should happen to it\?/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: 'Revoke it' }));
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
      await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pw-1234', 'New-pw-9876', true));
      await waitFor(() => expect(screen.queryByRole('group', { name: 'Member tokens' })).toBeNull());
    });

    it('does not ask a member who has no working tokens — and says NOTHING, leaving the cautious default', async () => {
      changePassword.mockResolvedValue(undefined);
      renderMenu(null, false, true, staff);
      fillPasswordChange();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled());
      expect(screen.queryByRole('group', { name: 'Member tokens' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
      // Not `false`: the count is from when the tab opened. A token minted in another tab since then
      // was never asked about, and must not be kept by an answer nobody gave.
      await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pw-1234', 'New-pw-9876', undefined));
    });

    it('waits for the token list before it lets the form through, and still asks if the list cannot be read', async () => {
      let fail: (err: Error) => void = () => {};
      listMemberTokens.mockReturnValue(new Promise((_, reject) => (fail = reject)));
      renderMenu(null, false, true, staff);
      fillPasswordChange();
      // Not known yet whether there is a question: submitting now could skip it.
      expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
      expect(screen.queryByRole('group', { name: 'Member tokens' })).toBeNull();

      fail(new Error('offline'));
      const question = await screen.findByRole('group', { name: 'Member tokens' });
      expect(within(question).getByText(/sign in with your member tokens, not with your password/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    });

    it('setting a FIRST password asks nothing and keeps the tokens — there is no old password to have leaked', async () => {
      listMemberTokens.mockResolvedValue({ items: [memberToken('a')], dailyProjectMax: 50 });
      changePassword.mockResolvedValue(undefined);
      renderMenu(null, false, /* hasPassword */ false, staff);
      fireEvent.click(screen.getByRole('button', { name: 'Password' }));
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Brand-new-pw-1' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Brand-new-pw-1' } });
      expect(screen.queryByRole('group', { name: 'Member tokens' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
      await waitFor(() => expect(changePassword).toHaveBeenCalledWith(undefined, 'Brand-new-pw-1', false));
    });
  });

  it('renders the Security (MFA) tab, passing through the enabled state', () => {
    renderMenu(null, true);
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    // …and whether there is a password, which decides how adding a passkey is confirmed.
    expect(screen.getByTestId('security')).toHaveTextContent('security:true:true');
  });
});
