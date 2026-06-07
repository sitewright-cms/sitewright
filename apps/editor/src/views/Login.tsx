import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') await api.register(email, password);
      else await api.login(email, password);
      onAuthed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mx-auto mt-24 max-w-sm ${glassCard} p-8`}>
      <h1 className="mb-1 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <svg width="28" height="28" viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <path d="M30 18 V72 H78" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="40" y="52" width="26" height="14" rx="3" fill="#14B8A6" />
          <rect x="40" y="35" width="26" height="14" rx="3" fill="#4F2DD8" />
        </svg>
        <span className="font-display">Sitewright</span>
      </h1>
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
        <button
          type="submit"
          disabled={busy}
          className={`${primaryButton} w-full`}
        >
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
    </div>
  );
}
