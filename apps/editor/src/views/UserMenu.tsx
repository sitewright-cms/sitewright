import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useUnsavedWork } from '../lib/unsaved-work';
import { isPasswordValid, PASSWORD_MIN_LENGTH } from '@sitewright/schema';
import { api, type Project } from '../api';
import { Modal } from './ui/Modal';
import { ApiKeysManager } from './ApiKeysManager';
import { MemberTokensManager } from './MemberTokensManager';
import { SectionHelp } from './ui/SectionHelp';
import { SecurityTab } from './SecurityTab';
import { PasswordRequirements } from './ui/PasswordRequirements';
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
  /** Agency staff (admin/developer) — the only accounts that may hold member tokens. */
  isStaff?: boolean;
  /** Instance admin — changes what a member token of theirs can reach, and the tab says so. */
  isInstanceAdmin?: boolean;
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
 * email) and Password are always available; Access keys holds both kinds of bearer token — PROJECT
 * tokens for the open project (owner-only) and, for agency staff, MEMBER tokens that follow the person
 * across every project they can reach; Security hosts two-factor (TOTP). Each tab is self-contained —
 * the modal supplies only the chrome (no global Save button).
 */
export function UserMenu({ email, project, totpEnabled, recoveryCodesRemaining, hasPassword, isStaff = false, isInstanceAdmin = false, onClose, onEmailChanged, onMfaChanged, onPasswordChanged }: UserMenuProps) {
  const [tab, setTab] = useState<Tab>('account');

  const tabBtn = (id: Tab) =>
    `rounded-lg px-3.5 py-1.5 text-sm transition ${tab === id ? `${gradientSurface} font-bold` : 'font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`;

  return (
    <Modal
      title="Account"
      size="lg"
      onClose={onClose}
      headerExtra={
        <div className="flex overflow-hidden rounded-xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 p-0.5">
          <button type="button" className={tabBtn('account')} onClick={() => setTab('account')}>Account</button>
          <button type="button" className={tabBtn('password')} onClick={() => setTab('password')}>Password</button>
          <button type="button" className={tabBtn('access')} onClick={() => setTab('access')}>Access keys</button>
          <button type="button" className={tabBtn('security')} onClick={() => setTab('security')}>Security</button>
        </div>
      }
    >
      <div className="p-5">
        {tab === 'account' && <AccountTab email={email} onEmailChanged={onEmailChanged} />}
        {tab === 'password' && <PasswordTab hasPassword={hasPassword} isStaff={isStaff} onPasswordChanged={onPasswordChanged} />}
        {tab === 'access' && <AccessKeysTab project={project} isStaff={isStaff} isInstanceAdmin={isInstanceAdmin} hasPassword={hasPassword} />}
        {tab === 'security' && <SecurityTab totpEnabled={totpEnabled} recoveryCodesRemaining={recoveryCodesRemaining} onChanged={onMfaChanged} hasPassword={hasPassword} />}
      </div>
    </Modal>
  );
}

/** Shared inline error/help row under a form. */
function FormError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-rose-600 dark:text-rose-400">{children}</p>;
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

  // Guard LEAVING the page too, not just closing this surface — see lib/unsaved-work.
  useUnsavedWork(dirty, 'Account');

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
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Login email</h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">This is the address you sign in with. Changing it requires your current password.</p>
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

function PasswordTab({ hasPassword, isStaff, onPasswordChanged }: { hasPassword: boolean; isStaff: boolean; onPasswordChanged: () => void }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A staff member's working member tokens: how many (a number), not yet known (null), or could not
  // be read ('unknown' — then the question is still asked, just without a count). A changed password
  // might mean "someone knows it", in which case the tokens should go too, or might be routine, in
  // which case stopping every automation would be the surprise. Only the member knows — so they choose.
  const asksAboutTokens = isStaff && hasPassword;
  const [liveTokens, setLiveTokens] = useState<number | 'unknown' | null>(null);
  const [tokenChoice, setTokenChoice] = useState<'keep' | 'revoke' | null>(null);
  useEffect(() => {
    if (!asksAboutTokens) return;
    let active = true;
    api
      .listMemberTokens()
      .then((res) => {
        if (active) setLiveTokens(res.items.filter((t) => new Date(t.expiresAt).getTime() > Date.now()).length);
      })
      .catch(() => {
        if (active) setLiveTokens('unknown');
      });
    return () => {
      active = false;
    };
  }, [asksAboutTokens]);
  const mustChoose = asksAboutTokens && liveTokens !== null && liveTokens !== 0;

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  // When the account has no password (OIDC-provisioned), this is "set a password" — no current one.
  const canSubmit =
    (!hasPassword || currentPassword.length > 0) &&
    isPasswordValid(newPassword) &&
    newPassword === confirm &&
    !saving &&
    // Not until we know whether there is a question to ask, and not until it is answered.
    (!asksAboutTokens || liveTokens !== null) &&
    (!mustChoose || tokenChoice !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    // The member's answer when there was a question. With no question to ask, NOTHING is said and
    // the server takes its cautious reading (revoke) — a no-op when there really are no tokens, and
    // the right outcome if one was minted in another tab after this form counted none. The one
    // explicit "keep" is a FIRST password: there is no old password that could have leaked.
    const answer = mustChoose ? tokenChoice === 'revoke' : !hasPassword && isStaff ? false : undefined;
    const revoke = answer === true;
    try {
      await api.changePassword(hasPassword ? currentPassword : undefined, newPassword, answer);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setTokenChoice(null);
      if (revoke) setLiveTokens(0);
      onPasswordChanged();
      toast.show(
        !hasPassword
          ? 'Password set'
          : revoke
            ? 'Password changed — other sessions were signed out and your member tokens revoked'
            : 'Password changed — other sessions were signed out',
        'success',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save password');
    } finally {
      setSaving(false);
    }
  }

  const tokenCount = typeof liveTokens === 'number' ? liveTokens : null;
  const tokensLabel = tokenCount === null ? 'your member tokens' : tokenCount === 1 ? 'your member token' : `your ${tokenCount} member tokens`;

  return (
    <form onSubmit={submit} className={`flex flex-col gap-4 ${glassCard} p-5`}>
      <div>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{hasPassword ? 'Change password' : 'Set a password'}</h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
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
        <input id="pw-new" type="password" autoComplete="new-password" className={glassInput} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} />
        <PasswordRequirements value={newPassword} />
      </div>
      <div>
        <label className={fieldLabel} htmlFor="pw-confirm">Confirm new password</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" className={glassInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {mismatch && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Passwords don’t match.</p>}
      </div>
      {mustChoose && (
        <fieldset className="flex flex-col gap-2">
          <legend className={fieldLabel}>Member tokens</legend>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agents and automation sign in with {tokensLabel}, not with your password. What should happen to {tokenCount === 1 ? 'it' : 'them'}?
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="pw-member-tokens" className="mt-0.5" aria-labelledby="pw-tokens-keep" aria-describedby="pw-tokens-keep-hint" checked={tokenChoice === 'keep'} onChange={() => setTokenChoice('keep')} />
            <span>
              <span id="pw-tokens-keep" className="font-medium text-slate-800 dark:text-slate-100">Keep {tokenCount === 1 ? 'it' : 'them'} working</span>
              <span id="pw-tokens-keep-hint" className="block text-xs text-slate-500 dark:text-slate-400">For a routine change. Nothing that uses a token is interrupted.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="pw-member-tokens" className="mt-0.5" aria-labelledby="pw-tokens-revoke" aria-describedby="pw-tokens-revoke-hint" checked={tokenChoice === 'revoke'} onChange={() => setTokenChoice('revoke')} />
            <span>
              <span id="pw-tokens-revoke" className="font-medium text-slate-800 dark:text-slate-100">Revoke {tokenCount === 1 ? 'it' : 'them'}</span>
              <span id="pw-tokens-revoke-hint" className="block text-xs text-slate-500 dark:text-slate-400">
                If someone else may know your password. Everything using a token stops, on every project, until you create a new one.
                Check the passkeys on your Security tab as well: a password change does not remove them.
              </span>
            </span>
          </label>
        </fieldset>
      )}
      {error && <FormError>{error}</FormError>}
      <div>
        <button type="submit" className={primaryButton} disabled={!canSubmit}>
          {saving ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </button>
      </div>
    </form>
  );
}

/** One of the Access keys tab's two sections: a heading with its "?" explanation, then the manager. */
function TokenSection({ id, title, tip, children }: { id: string; title: string; tip: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      {/* The "?" sits BESIDE the heading, not inside it — inside, its tip text would become part of
          the section's accessible name. */}
      <div className="flex items-center gap-1.5">
        <h3 id={id} className="text-sm font-bold text-slate-800 dark:text-slate-100">
          {title}
        </h3>
        <SectionHelp tip={tip} />
      </div>
      {children}
    </section>
  );
}

function AccessKeysTab({ project, isStaff, isInstanceAdmin, hasPassword }: { project: Project | null; isStaff: boolean; isInstanceAdmin: boolean; hasPassword: boolean }) {
  const ownsOpenProject = project !== null && project.role === 'owner';
  return (
    <div className="flex flex-col gap-8">
      <TokenSection
        id="project-tokens-heading"
        title="Project tokens"
        tip="Bound to one project and nothing else. For CI, a headless tool, or an agent that should only ever touch this site."
      >
        {ownsOpenProject ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Project-scoped tokens (PATs) for <span className="font-medium text-slate-700 dark:text-slate-200">{project.name}</span> — used by CI and headless tools.
            </p>
            {/* Keyed so the one-time-token banner + state reset if the open project changes. */}
            <ApiKeysManager key={project.id} project={project} isInstanceAdmin={isInstanceAdmin} />
          </>
        ) : (
          <div className={`${glassCard} p-5 text-sm text-slate-500 dark:text-slate-400`}>
            Open a project you own to manage its project tokens. A project token is bound to that one
            project.
          </div>
        )}
      </TokenSection>
      {/* Staff only: an invited client cannot hold a member token, so the section would be a dead end. */}
      {isStaff && (
        <TokenSection
          id="member-tokens-heading"
          title="Member tokens"
          tip="Belongs to you, not to a project. For agents and automation that create and manage several projects with one token."
        >
          <MemberTokensManager isInstanceAdmin={isInstanceAdmin} hasPassword={hasPassword} />
        </TokenSection>
      )}
    </div>
  );
}
