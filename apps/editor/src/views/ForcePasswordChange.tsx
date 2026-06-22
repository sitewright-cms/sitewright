import { useState, type FormEvent } from 'react';
import { isPasswordValid, PASSWORD_MIN_LENGTH } from '@sitewright/schema';
import { api, type Branding } from '../api';
import { BrandLogo } from './ui/BrandLogo';
import { DEFAULT_BRANDING } from '../lib/use-branding';
import { PasswordRequirements } from './ui/PasswordRequirements';
import { fieldLabel, ghostButton, glassCard, glassInput, primaryButton } from '../theme';

interface ForcePasswordChangeProps {
  /** The signed-in email (shown for context — the account being secured). */
  email: string;
  /** Called after the password is changed; the parent re-fetches `/me` and the flag clears. */
  onDone: () => void;
  /** Escape hatch — sign out without changing the password. */
  onSignOut: () => void;
  branding?: Branding;
}

/**
 * The forced "set a new password" gate. Shown full-screen (before the editor loads) whenever the
 * signed-in user still carries the server's `mustChangePassword` flag — i.e. a first-boot admin left on
 * the well-known default password. The server independently rejects every state-changing request with a
 * `password-change-required` sentinel until this completes, so this screen can't be bypassed by URL.
 */
export function ForcePasswordChange({ email, onDone, onSignOut, branding = DEFAULT_BRANDING }: ForcePasswordChangeProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const canSubmit =
    currentPassword.length > 0 && isPasswordValid(newPassword) && newPassword === confirm && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to set a new password');
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className={`w-full max-w-sm ${glassCard} p-8`}>
        <h1 className="mb-1 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <BrandLogo logoUrl={branding.logoUrl} name={branding.name} className="h-7 w-7" />
          <span className="font-display">{branding.name}</span>
        </h1>
        <h2 className="text-sm font-bold text-slate-800">Choose a new password</h2>
        <p className="mt-0.5 mb-5 text-xs text-slate-500">
          This account (<span className="font-medium">{email}</span>) is still using the default password.
          Set a new one to continue — it’s required before you can do anything else.
        </p>

        <div className="mb-4">
          <label className={fieldLabel} htmlFor="fpw-current">Current password</label>
          <input
            id="fpw-current"
            type="password"
            autoComplete="current-password"
            className={glassInput}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className={fieldLabel} htmlFor="fpw-new">New password</label>
          <input
            id="fpw-new"
            type="password"
            autoComplete="new-password"
            className={glassInput}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
          />
          <PasswordRequirements value={newPassword} />
        </div>
        <div className="mb-4">
          <label className={fieldLabel} htmlFor="fpw-confirm">Confirm new password</label>
          <input
            id="fpw-confirm"
            type="password"
            autoComplete="new-password"
            className={glassInput}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {mismatch && <p className="mt-1 text-xs text-amber-600" role="alert">Passwords don’t match.</p>}
        </div>
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <button type="submit" className={`${primaryButton} mt-1 w-full`} disabled={!canSubmit}>
          {saving ? 'Saving…' : 'Set new password & continue'}
        </button>
        <button type="button" className={`${ghostButton} mt-3 w-full`} onClick={onSignOut}>
          Sign out instead
        </button>
      </form>
    </div>
  );
}
