import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { BrandMark } from './ui/BrandMark';
import { glassCard, glassInput, primaryButton } from '../theme';

interface LoginProps {
  onAuthed: () => void;
}

export function Login({ onAuthed }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when a password login needs a second factor — the credentials form yields to the code step.
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

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
