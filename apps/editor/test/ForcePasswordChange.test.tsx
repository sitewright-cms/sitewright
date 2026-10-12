import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock('../src/api', () => ({
  api: { changePassword: (cur: string | undefined, next: string) => changePassword(cur, next) },
}));

import { ForcePasswordChange } from '../src/views/ForcePasswordChange';

const VALID = 'New-Pw-secret-2'; // upper + lower + number + symbol, ≥8

function setup(temporary = false) {
  const onDone = vi.fn();
  const onSignOut = vi.fn();
  render(<ForcePasswordChange email="admin@x.test" onDone={onDone} onSignOut={onSignOut} temporary={temporary} />);
  return { onDone, onSignOut };
}

beforeEach(() => {
  changePassword.mockReset();
  changePassword.mockResolvedValue(undefined);
});

describe('ForcePasswordChange', () => {
  it('changes the password with the current + new values, then calls onDone', async () => {
    const { onDone } = setup();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: VALID } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: VALID } });
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('123456', VALID));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('keeps the submit disabled until the new password is valid and the confirmation matches', () => {
    setup();
    const submit = screen.getByRole('button', { name: /Set new password/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: VALID } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'mismatch' } });
    expect(submit).toBeDisabled(); // confirmation doesn't match
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: VALID } });
    expect(submit).toBeEnabled();
  });

  it('surfaces a server error without calling onDone', async () => {
    changePassword.mockRejectedValue(new Error('current password is incorrect'));
    const { onDone } = setup();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: VALID } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: VALID } });
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));
    expect(await screen.findByText('current password is incorrect')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says DEFAULT password for the seeded admin', () => {
    setup();
    expect(screen.getByText(/still using the default password/)).toBeInTheDocument();
    expect(screen.queryByText(/temporary password/i)).toBeNull();
  });

  it('★ for a temporary password it says so, and asks for THAT password — nobody chose a "current" one', async () => {
    const { onDone } = setup(true);
    expect(screen.getByText(/is on a temporary password that\s+someone else issued/)).toBeInTheDocument();
    expect(screen.queryByText(/default password/)).toBeNull();
    expect(screen.queryByLabelText('Current password')).toBeNull();

    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'Xk7$mQp2-Rw9tLz4' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: VALID } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: VALID } });
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));
    // Nothing is said about member tokens: the server keeps what the admin kept when it was issued.
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('Xk7$mQp2-Rw9tLz4', VALID));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('shows the server’s word when the temporary password has expired', async () => {
    changePassword.mockRejectedValue(new Error('this temporary password has expired — ask for a new one'));
    const { onDone } = setup(true);
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'Xk7$mQp2-Rw9tLz4' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: VALID } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: VALID } });
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));
    expect(await screen.findByText(/has expired — ask for a new one/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('offers a sign-out escape hatch', () => {
    const { onSignOut } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Sign out instead/ }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
