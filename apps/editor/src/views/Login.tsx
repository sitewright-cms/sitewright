import { useEffect, useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { isPasswordValid } from '@sitewright/schema';
import { api, ApiError, type Branding } from '../api';
import { BrandLogo } from './ui/BrandLogo';
import { DEFAULT_BRANDING } from '../lib/use-branding';
import { PasswordRequirements } from './ui/PasswordRequirements';
import { ghostButton, glassCard, glassInput, primaryButton } from '../theme';

interface LoginProps {
  onAuthed: () => void;
  /** The admin-panel branding (name + logo) for the sign-in wordmark; defaults to the built-in brand. */
  branding?: Branding;
  /** A TOTP ticket carried back from an OIDC callback — start straight on the code step. */
  initialMfaTicket?: string | null;
  /** A notice (e.g. an OIDC callback error) to show on the sign-in screen. */
  initialNotice?: string | null;
  /**
   * Enable the "create account" (set-password) option. Registration is INVITE-ONLY, so this is set
   * ONLY by the invite-accept flow (an invited email holds a pending invite). `undefined` → sign-in
   * only (no public self-registration). Typed `true` so it can only ever force-enable.
   */
  allowRegister?: true;
  /** Lock the email to a fixed address (pre-filled + disabled) — the invite-accept flow passes the
   *  invited email so it can't be changed. With `allowRegister`, the form opens in set-password
   *  (register) mode; the sign-in/register toggle is hidden (the invite determines the path). */
  lockedEmail?: string;
  /** Hide the OIDC "Sign in with …" buttons (the invite landing offers those on its own choice screen). */
  hideOidc?: boolean;
}

export function Login({ onAuthed, initialMfaTicket, initialNotice, allowRegister, lockedEmail, hideOidc, branding = DEFAULT_BRANDING }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>(lockedEmail && allowRegister ? 'register' : 'login');
  const [email, setEmail] = useState(lockedEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialNotice ?? null);
  const [busy, setBusy] = useState(false);
  // Set when a password login needs a second factor — the credentials form yields to the code step.
  // Seeded from an OIDC callback that returned a TOTP ticket.
  const [ticket, setTicket] = useState<string | null>(initialMfaTicket ?? null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);

  // The public login config drives the OIDC "Sign in with …" buttons (best-effort; absent on failure).
  useEffect(() => {
    let active = true;
    api
      .loginConfig()
      .then((c) => {
        if (active) setProviders(c.oidcProviders);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Registration is INVITE-ONLY: there is no public self-registration. Only the invite-accept flow
  // (which passes `allowRegister`) ever reaches register mode.
  const canRegister = allowRegister ?? false;
  // In register mode, gate submit on the shared password policy (the server enforces it regardless).
  const registerBlocked = mode === 'register' && !isPasswordValid(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await api.register(email, password);
        onAuthed();
        return;
      }
      const res = await api.login(email, password);
      if ('mfaRequired' in res) {
        // Password OK but TOTP is required — switch to the code step (no session yet).
        setTicket(res.ticket);
        setCode('');
        setUseRecovery(false);
      } else {
        onAuthed();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    setError(null);
    setBusy(true);
    try {
      await api.loginTotp(ticket, code.trim());
      onAuthed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setError(null);
    setBusy(true);
    try {
      const { options, handle } = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      const res = await api.passkeyLoginVerify(handle, response);
      if ('mfaRequired' in res) {
        // A passkey is the first factor; this account also requires TOTP on top.
        setTicket(res.ticket);
        setCode('');
        setUseRecovery(false);
      } else {
        onAuthed();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Passkey sign-in was cancelled or didn’t complete.');
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setTicket(null);
    setCode('');
    setPassword('');
    setError(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className={`w-full max-w-sm ${glassCard} p-8`}>
        <h1 className="mb-1 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <BrandLogo logoUrl={branding.logoUrl} name={branding.name} className="h-7 w-7" />
          <span className="font-display">{branding.name}</span>
        </h1>

        {ticket ? (
          <>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              {useRecovery ? 'Enter one of your recovery codes' : 'Enter the 6-digit code from your authenticator app'}
            </p>
            <form onSubmit={submitTotp} className="flex flex-col gap-3">
              <input
                aria-label="Authentication code"
                type="text"
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                className={glassInput}
                placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button type="submit" disabled={busy || code.trim().length === 0} className={`${primaryButton} w-full`}>
                {busy ? 'Verifying…' : 'Verify'}
              </button>
            </form>
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setCode('');
                  setError(null);
                }}
              >
                {useRecovery ? 'Use your authenticator app' : 'Use a recovery code'}
              </button>
              <button className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100" onClick={restart}>
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              {mode === 'register' ? 'Create your account' : 'Sign in to your account'}
            </p>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <input
                aria-label="Email"
                type="email"
                className={glassInput}
                placeholder="you@agency.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!!lockedEmail}
                required
              />
              <input
                aria-label="Password"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className={glassInput}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {mode === 'register' && <PasswordRequirements value={password} />}
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button type="submit" disabled={busy || registerBlocked} className={`${primaryButton} w-full`}>
                {mode === 'register' ? 'Create account' : 'Sign in'}
              </button>
            </form>
            {mode === 'login' && browserSupportsWebAuthn() && (
              <button type="button" disabled={busy} onClick={() => void signInWithPasskey()} className={`${ghostButton} mt-3 w-full`}>
                Sign in with a passkey
              </button>
            )}
            {mode === 'login' &&
              !hideOidc &&
              providers.map((p) => (
                // A real navigation (not fetch): the GET /start route 302s to the identity provider.
                <a key={p.id} href={api.oidcStartUrl(p.id)} className={`${ghostButton} mt-3 w-full`}>
                  Sign in with {p.label}
                </a>
              ))}
            {canRegister && !lockedEmail && (
              <button
                className="mt-4 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setError(null);
                }}
              >
                {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
