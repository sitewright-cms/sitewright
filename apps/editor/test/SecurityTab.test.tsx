import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mfaSetupTotp, mfaConfirmTotp, mfaDisableTotp, mfaRegenerateRecoveryCodes } = vi.hoisted(() => ({
  mfaSetupTotp: vi.fn(),
  mfaConfirmTotp: vi.fn(),
  mfaDisableTotp: vi.fn(),
  mfaRegenerateRecoveryCodes: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    mfaSetupTotp: () => mfaSetupTotp(),
    mfaConfirmTotp: (code: string) => mfaConfirmTotp(code),
    mfaDisableTotp: (pw: string) => mfaDisableTotp(pw),
    mfaRegenerateRecoveryCodes: (pw: string) => mfaRegenerateRecoveryCodes(pw),
  },
}));
// Don't generate a real QR in jsdom — a stub data URL is enough.
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:image/png;base64,AAAA') } }));

import { SecurityTab } from '../src/views/SecurityTab';

beforeEach(() => {
  mfaSetupTotp.mockReset();
  mfaConfirmTotp.mockReset();
  mfaDisableTotp.mockReset();
  mfaRegenerateRecoveryCodes.mockReset();
});

describe('SecurityTab (TOTP)', () => {
  it('enrols: setup → QR + key → confirm → recovery codes, and notifies the app', async () => {
    mfaSetupTotp.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Sitewright:me?secret=JBSWY3DPEHPK3PXP' });
    mfaConfirmTotp.mockResolvedValue({ recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] });
    const onChanged = vi.fn();
    render(<SecurityTab totpEnabled={false} recoveryCodesRemaining={0} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    await waitFor(() => expect(mfaSetupTotp).toHaveBeenCalled());

    // The manual key + a QR are shown.
    expect(await screen.findByLabelText('TOTP secret key')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(await screen.findByAltText('TOTP QR code')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await waitFor(() => expect(mfaConfirmTotp).toHaveBeenCalledWith('123456'));

    // Recovery codes are revealed once, and the app is told to refresh.
    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument();
    expect(screen.getByText('CCCCC-DDDDD')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('surfaces a setup error (e.g. no encryption key → 503)', async () => {
    mfaSetupTotp.mockRejectedValue(new Error('encryption is not configured'));
    render(<SecurityTab totpEnabled={false} recoveryCodesRemaining={0} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    expect(await screen.findByText('encryption is not configured')).toBeInTheDocument();
  });

  it('when enabled: disable is password-confirmed and notifies the app', async () => {
    mfaDisableTotp.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<SecurityTab totpEnabled recoveryCodesRemaining={8} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'pw-secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(mfaDisableTotp).toHaveBeenCalledWith('pw-secret-1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('when enabled: regenerate recovery codes is password-confirmed and shows the new set', async () => {
    mfaRegenerateRecoveryCodes.mockResolvedValue({ recoveryCodes: ['ZZZZZ-YYYYY'] });
    render(<SecurityTab totpEnabled recoveryCodesRemaining={8} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'pw-secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate codes' }));
    await waitFor(() => expect(mfaRegenerateRecoveryCodes).toHaveBeenCalledWith('pw-secret-1'));
    expect(await screen.findByText('ZZZZZ-YYYYY')).toBeInTheDocument();
  });

  it('shows the remaining recovery-code count when enabled, and nudges when low', () => {
    const { rerender } = render(<SecurityTab totpEnabled recoveryCodesRemaining={8} onChanged={vi.fn()} />);
    expect(screen.getByText(/8 recovery codes remaining/)).toBeInTheDocument();

    rerender(<SecurityTab totpEnabled recoveryCodesRemaining={2} onChanged={vi.fn()} />);
    expect(screen.getByText(/2 recovery codes remaining — consider regenerating\./)).toBeInTheDocument();

    rerender(<SecurityTab totpEnabled recoveryCodesRemaining={0} onChanged={vi.fn()} />);
    expect(screen.getByText(/No recovery codes left/)).toBeInTheDocument();
  });
});
