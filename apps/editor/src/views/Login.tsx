import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';

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
    <div className="mx-auto mt-24 max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Sitewright</h1>
      <p className="mb-6 text-sm text-slate-500">
        {mode === 'register' ? 'Create your account' : 'Sign in to your account'}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          aria-label="Email"
          type="email"
          className="rounded-md border border-slate-300 px-3 py-2"
          placeholder="you@agency.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          aria-label="Password"
          type="password"
          className="rounded-md border border-slate-300 px-3 py-2"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
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
