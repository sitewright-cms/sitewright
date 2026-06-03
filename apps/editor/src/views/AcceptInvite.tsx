import { useEffect, useState } from 'react';
import { api, ApiError, type InvitePeek } from '../api';
import { glassCard, primaryButton } from '../theme';
import { Login } from './Login';

interface AcceptInviteProps {
  token: string;
  /** Whether an interactive session is already established. */
  authed: boolean;
  /** Called after a successful sign-in/registration so the app can re-resolve auth. */
  onAuthed: () => void;
  /** Called to leave the accept flow (clears the invite from the URL). */
  onDone: () => void;
}

/**
 * The invite landing screen. A token holder sees who invited them and to what; they
 * sign in (or register) as the invited email, then accept — which materializes their
 * membership server-side. A leaked link is useless without that email's account.
 */
export function AcceptInvite({ token, authed, onAuthed, onDone }: AcceptInviteProps) {
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .peekInvite(token)
      .then((res) => {
        if (!cancelled) setPeek(res.invite);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'invite not found');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      await api.acceptInvite(token);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not accept the invite');
    } finally {
      setAccepting(false);
    }
  }

  const card = (children: React.ReactNode) => (
    <div className={`mx-auto mt-24 max-w-md ${glassCard} p-8`}>
      {children}
    </div>
  );

  if (loadError) {
    return card(
      <>
        <h1 className="mb-2 text-xl font-bold">Invitation</h1>
        <p className="text-sm text-red-600">This invite link is invalid or has expired.</p>
        <button className="mt-4 text-sm text-slate-500 hover:text-slate-900" onClick={onDone}>
          ← Continue to Sitewright
        </button>
      </>,
    );
  }

  if (!peek) return <div className="p-8 text-slate-500">Loading invitation…</div>;

  const target =
    peek.role === 'member' && peek.projectName
      ? `to edit “${peek.projectName}”`
      : `to join as a ${peek.role}`;

  if (peek.accepted) {
    return card(
      <>
        <h1 className="mb-2 text-xl font-bold">Already accepted</h1>
        <p className="text-sm text-slate-600">This invitation has already been used.</p>
        <button className="mt-4 text-sm text-slate-500 hover:text-slate-900" onClick={onDone}>
          ← Continue to Sitewright
        </button>
      </>,
    );
  }
  if (peek.expired) {
    return card(
      <>
        <h1 className="mb-2 text-xl font-bold">Invitation expired</h1>
        <p className="text-sm text-slate-600">Ask the sender to send a new invite link.</p>
        <button className="mt-4 text-sm text-slate-500 hover:text-slate-900" onClick={onDone}>
          ← Continue to Sitewright
        </button>
      </>,
    );
  }

  if (!authed) {
    return (
      <div>
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-indigo-200/60 bg-indigo-50/70 p-4 text-center text-sm text-indigo-900 shadow-sm backdrop-blur-xl">
          You’ve been invited as <strong>{peek.email}</strong> {target}. Sign in or create an
          account with that email to accept.
        </div>
        <Login onAuthed={onAuthed} />
      </div>
    );
  }

  return card(
    <>
      <h1 className="mb-1 text-xl font-bold">You’re invited</h1>
      <p className="mb-4 text-sm text-slate-600">
        <strong>{peek.email}</strong> was invited {target}.
      </p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={accept}
          disabled={accepting}
          className={primaryButton}
        >
          {accepting ? 'Accepting…' : 'Accept invitation'}
        </button>
        <button className="text-sm text-slate-500 hover:text-slate-900" onClick={onDone}>
          Not now
        </button>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        Signed in as the wrong account? Accepting will fail unless you are {peek.email}.
      </p>
    </>,
  );
}
