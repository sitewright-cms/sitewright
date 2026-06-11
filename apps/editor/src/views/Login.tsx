import { useEffect, useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { BrandMark } from './ui/BrandMark';
import { ghostButton, glassCard, glassInput, primaryButton } from '../theme';

interface LoginProps {
  onAuthed: () => void;
  /** A TOTP ticket carried back from an OIDC callback — start straight on the code step. */
  initialMfaTicket?: string | null;
  /** A notice (e.g. an OIDC callback error) to show on the sign-in screen. */
  initialNotice?: string | null;
}

export function Login({ onAuthed, initialMfaTicket, initialNotice }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialNotice ?? null);
  const [busy, setBusy] = useState(false);
  // Set when a password login needs a second factor — the credentials form yields to the code step.
  // Seeded from an OIDC callback that returned a TOTP ticket.
  const [ticket, setTicket] = useState<string | null>(initialMfaTicket ?? null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);

  // The enabled OIDC providers drive the "Sign in with …" buttons (best-effort; absent on failure).
  useEffect(() => {
    let active = true;
    api.loginConfig().then((c) => active && setProviders(c.oidcProviders)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
          <BrandMark className="h-7 w-7" />
          <span className="font-display">Sitewright</span>
        </h1>

        {ticket ? (
          <>
            <p className="mb-6 text-sm text-slate-500">
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
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy || code.trim().length === 0} className={`${primaryButton} w-full`}>
                {busy ? 'Verifying…' : 'Verify'}
              </button>
            </form>
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                className="text-slate-500 hover:text-slate-900"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setCode('');
                  setError(null);
                }}
              >
                {useRecovery ? 'Use your authenticator app' : 'Use a recovery code'}
              </button>
              <button className="text-slate-500 hover:text-slate-900" onClick={restart}>
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-slate-500">
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
                required
              />
              <input
                aria-label="Password"
                type="password"
                className={glassInput}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
                {mode === 'register' ? 'Create account' : 'Sign in'}
              </button>
            </form>
            {mode === 'login' && browserSupportsWebAuthn() && (
              <button type="button" disabled={busy} onClick={() => void signInWithPasskey()} className={`${ghostButton} mt-3 w-full`}>
                Sign in with a passkey
              </button>
            )}
            {mode === 'login' &&
              providers.map((p) => (
                // A real navigation (not fetch): the GET /start route 302s to the identity provider.
                <a key={p.id} href={api.oidcStartUrl(p.id)} className={`${ghostButton} mt-3 w-full`}>
                  Sign in with {p.label}
                </a>
              ))}
            <button
              className="mt-4 text-sm text-slate-500 hover:text-slate-900"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
