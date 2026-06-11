import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Project } from '../api';
import { Modal } from './ui/Modal';
import { ApiKeysManager } from './ApiKeysManager';
import { SecurityTab } from './SecurityTab';
import { useToast } from './ui/Toast';
import { fieldLabel, glassCard, glassInput, gradientSurface, primaryButton } from '../theme';

type Tab = 'account' | 'password' | 'access' | 'security';

interface UserMenuProps {
  /** The signed-in user's current email (from /me); seeds the Account tab + heading. */
  email: string;
  /** The open project (null on the home screen) — scopes the Access keys tab. */
  project: Project | null;
  /** Whether the user currently has TOTP enabled (from /me) — drives the Security tab. */
  totpEnabled: boolean;
  /** Unused recovery codes remaining (from /me) — shown in the Security tab when TOTP is on. */
  recoveryCodesRemaining: number;
  /** Whether the account has a password (false for an OIDC-provisioned user) — drives the Password tab. */
  hasPassword: boolean;
  onClose: () => void;
  /** Called after a successful email change so the app can refresh its cached identity. */
  onEmailChanged: (email: string) => void;
  /** Called after enabling/disabling two-factor so the app can refresh `totpEnabled`. */
  onMfaChanged: () => void;
  /** Called after a password is set/changed so the app can refresh `hasPassword`. */
  onPasswordChanged: () => void;
}

/**
 * The header user menu: a tabbed modal for self-service account management. Account (change login
 * email) and Password are always available; Access keys relocates the project-scoped PAT manager
 * here (owner-only); Security hosts two-factor (TOTP). Each tab is self-contained — the modal
 * supplies only the chrome (no global Save button).
 */
export function UserMenu({ email, project, totpEnabled, recoveryCodesRemaining, hasPassword, onClose, onEmailChanged, onMfaChanged, onPasswordChanged }: UserMenuProps) {
  const [tab, setTab] = useState<Tab>('account');

  const tabBtn = (id: Tab) =>
    `rounded-lg px-3.5 py-1.5 text-sm transition ${tab === id ? `${gradientSurface} font-bold` : 'font-medium text-slate-500 hover:text-slate-800'}`;

  return (
    <Modal
      title="Account"
      size="lg"
      onClose={onClose}
      headerExtra={
        <div className="flex overflow-hidden rounded-xl border border-white/60 bg-white/40 p-0.5">
          <button type="button" className={tabBtn('account')} onClick={() => setTab('account')}>Account</button>
          <button type="button" className={tabBtn('password')} onClick={() => setTab('password')}>Password</button>
          <button type="button" className={tabBtn('access')} onClick={() => setTab('access')}>Access keys</button>
          <button type="button" className={tabBtn('security')} onClick={() => setTab('security')}>Security</button>
        </div>
      }
    >
      <div className="p-5">
        {tab === 'account' && <AccountTab email={email} onEmailChanged={onEmailChanged} />}
        {tab === 'password' && <PasswordTab hasPassword={hasPassword} onPasswordChanged={onPasswordChanged} />}
        {tab === 'access' && <AccessKeysTab project={project} />}
        {tab === 'security' && <SecurityTab totpEnabled={totpEnabled} recoveryCodesRemaining={recoveryCodesRemaining} onChanged={onMfaChanged} />}
      </div>
    </Modal>
  );
}

/** Shared inline error/help row under a form. */
function FormError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-rose-600">{children}</p>;
}

function AccountTab({ email, onEmailChanged }: { email: string; onEmailChanged: (email: string) => void }) {
  const toast = useToast();
  const [next, setNext] = useState(email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // If the menu is opened in the brief window before /me resolves, `email` starts '' and the input
  // is blank; seed it once the real address arrives (without clobbering anything the user has typed).
  useEffect(() => {
    if (email && next === '') setNext(email);
  }, [email]);

  const dirty = next.trim().toLowerCase() !== email.toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.updateEmail(next.trim(), currentPassword);
      onEmailChanged(res.email);
      setNext(res.email);
      setCurrentPassword('');
      toast.show('Email updated', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to update email');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-4 ${glassCard} p-5`}>
      <div>
        <h3 className="text-sm font-bold text-slate-800">Login email</h3>
        <p className="mt-0.5 text-xs text-slate-500">This is the address you sign in with. Changing it requires your current password.</p>
      </div>
      <div>
        <label className={fieldLabel} htmlFor="account-email">Email</label>
        <input
          id="account-email"
          type="email"
          autoComplete="email"
          className={glassInput}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </div>
      <div>
        <label className={fieldLabel} htmlFor="account-current-pw">Current password</label>
        <input
          id="account-current-pw"
          type="password"
          autoComplete="current-password"
          className={glassInput}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>
      {error && <FormError>{error}</FormError>}
      <div>
        <button type="submit" className={primaryButton} disabled={saving || !dirty || currentPassword.length === 0}>
          {saving ? 'Updating…' : 'Update email'}
        </button>
      </div>
    </form>
  );
}

function PasswordTab({ hasPassword, onPasswordChanged }: { hasPassword: boolean; onPasswordChanged: () => void }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  // When the account has no password (OIDC-provisioned), this is "set a password" — no current one.
  const canSubmit = (!hasPassword || currentPassword.length > 0) && newPassword.length >= 8 && newPassword === confirm && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.changePassword(hasPassword ? currentPassword : undefined, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      onPasswordChanged();
      toast.show(hasPassword ? 'Password changed — other sessions were signed out' : 'Password set', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-4 ${glassCard} p-5`}>
      <div>
        <h3 className="text-sm font-bold text-slate-800">{hasPassword ? 'Change password' : 'Set a password'}</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {hasPassword
            ? 'Changing your password signs out every other session.'
            : 'Your account signs in via single sign-on. Set a password to also sign in with your email.'}
        </p>
      </div>
      {hasPassword && (
        <div>
          <label className={fieldLabel} htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" autoComplete="current-password" className={glassInput} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
      )}
      <div>
        <label className={fieldLabel} htmlFor="pw-new">New password</label>
        <input id="pw-new" type="password" autoComplete="new-password" className={glassInput} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        {tooShort && <p className="mt-1 text-xs text-amber-600">Use at least 8 characters.</p>}
      </div>
      <div>
        <label className={fieldLabel} htmlFor="pw-confirm">Confirm new password</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" className={glassInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {mismatch && <p className="mt-1 text-xs text-amber-600">Passwords don’t match.</p>}
      </div>
      {error && <FormError>{error}</FormError>}
      <div>
        <button type="submit" className={primaryButton} disabled={!canSubmit}>
          {saving ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </button>
      </div>
    </form>
  );
}

function AccessKeysTab({ project }: { project: Project | null }) {
  if (!project || project.role !== 'owner') {
    return (
      <div className={`${glassCard} p-5 text-sm text-slate-500`}>
        Open a project you own to manage its access keys. Access keys are project-scoped tokens for CI
        and headless tools.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Project-scoped tokens (PATs) for <span className="font-medium text-slate-700">{project.name}</span> — used by CI and headless tools.
      </p>
      {/* Keyed so the one-time-token banner + state reset if the open project changes. */}
      <ApiKeysManager key={project.id} project={project} />
    </div>
  );
}
