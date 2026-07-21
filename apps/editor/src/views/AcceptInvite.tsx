import { useEffect, useState } from 'react';
import { api, ApiError, type InvitePeek, type Branding } from '../api';
import { glassCard, primaryButton, ghostButton } from '../theme';
import { Login } from './Login';
import { DEFAULT_BRANDING } from '../lib/use-branding';
import { SkeletonList } from './ui/Skeleton';

interface AcceptInviteProps {
  token: string;
  /** Whether an interactive session is already established. */
  authed: boolean;
  /** Called after a successful sign-in/registration so the app can re-resolve auth. */
  onAuthed: () => void;
  /** Called to leave the accept flow (clears the invite from the URL). */
  onDone: () => void;
  /** The admin-panel branding (name for the copy, logo for the embedded sign-in); defaults to built-in. */
  branding?: Branding;
}

/**
 * The invite landing. A token holder sees who invited them and to what, then either SETS A PASSWORD
 * for the invited email (shown disabled) or — when OIDC providers are configured — chooses to complete
 * registration via a provider. If the email already has an account, the password path becomes a
 * sign-in. Once authenticated, the invite is auto-accepted (materializing project membership) and the
 * client lands in their project with full editing. A leaked link is useless without that email's auth.
 */
export function AcceptInvite({ token, authed, onAuthed, onDone, branding = DEFAULT_BRANDING }: AcceptInviteProps) {
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  // Once OIDC is offered, 'password' means the user picked the set-password / sign-in path.
  const [method, setMethod] = useState<'choose' | 'password'>('choose');
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .peekInvite(token)
      .then((res) => !cancelled && setPeek(res.invite))
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof ApiError ? err.message : 'invite not found'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Enabled OIDC providers drive the "complete registration with …" choice (best-effort; absent on failure).
  useEffect(() => {
    let active = true;
    api
      .loginConfig()
      .then((c) => active && setProviders(c.oidcProviders))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Once authenticated via the PASSWORD path (set-password / sign-in), auto-accept — this materializes
  // the project membership. (The OIDC path accepts server-side: resolveOidcUser → acceptPendingInvites
  // ForEmail on the verified email, then lands at the app root without the token, so it never reaches here.)
  useEffect(() => {
    if (!authed || !peek || peek.accepted || peek.expired) return;
    let cancelled = false;
    setAccepting(true);
    setAcceptError(null);
    api
      .acceptInvite(token)
      .then(() => !cancelled && onDone())
      .catch((err: unknown) => !cancelled && setAcceptError(err instanceof ApiError ? err.message : 'could not accept the invite'))
      .finally(() => !cancelled && setAccepting(false));
    return () => {
      cancelled = true;
    };
    // Deps intentionally exclude onDone/onAuthed (stable callbacks) — this is a one-shot on auth.
  }, [authed, peek, token]);

  const retryAccept = () => {
    setAcceptError(null);
    setAccepting(true);
    return api
      .acceptInvite(token)
      .then(() => onDone())
      .catch((err: unknown) => setAcceptError(err instanceof ApiError ? err.message : 'could not accept the invite'))
      .finally(() => setAccepting(false));
  };

  const card = (children: React.ReactNode) => <div className={`mx-auto mt-24 max-w-md ${glassCard} p-8`}>{children}</div>;
  const leave = (
    <button className="mt-4 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100" onClick={onDone}>
      ← Continue to {branding.name}
    </button>
  );

  if (loadError) {
    return card(
      <>
        <h1 className="mb-2 text-xl font-bold">Invitation</h1>
        <p className="text-sm text-red-600 dark:text-red-400">This invite link is invalid or has expired.</p>
        {leave}
      </>,
    );
  }
  if (!peek) return <SkeletonList rows={3} className="mx-auto max-w-md p-8" label="Loading invitation…" />;

  const target = peek.role === 'member' && peek.projectName ? `to edit “${peek.projectName}”` : `to join as a ${peek.role}`;

  if (peek.accepted) {
    return card(
      <>
        <h1 className="mb-2 text-xl font-bold">Already accepted</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">This invitation has already been used.</p>
        {leave}
      </>,
    );
  }
  if (peek.expired) {
    return card(
      <>
        <h1 className="mb-2 text-xl font-bold">Invitation expired</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Ask the sender to send a new invite link.</p>
        {leave}
      </>,
    );
  }

  // Authenticated → auto-accepting (or an accept error, e.g. signed in as the wrong account).
  if (authed) {
    return card(
      <>
        <h1 className="mb-1 text-xl font-bold">{acceptError ? 'Could not accept' : 'Joining…'}</h1>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          {acceptError ? acceptError : `Adding you ${target}.`}
        </p>
        {acceptError && (
          <p className="mb-3 text-[11px] text-slate-400 dark:text-slate-500">
            Accepting requires being signed in as <strong>{peek.email}</strong>. Sign out and use the invite link again with that email.
          </p>
        )}
        <div className="flex items-center gap-3">
          {acceptError && (
            <button onClick={() => void retryAccept()} disabled={accepting} className={primaryButton}>
              {accepting ? 'Accepting…' : 'Try again'}
            </button>
          )}
          <button className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100" onClick={onDone}>
            Not now
          </button>
        </div>
      </>,
    );
  }

  // Not authenticated. When OIDC providers exist, first offer the choice: set a password vs. complete
  // with a provider. Otherwise (or once "password" is picked) show the locked-email Login form.
  const hasOidc = providers.length > 0;
  if (hasOidc && method === 'choose') {
    return card(
      <>
        <h1 className="mb-1 text-xl font-bold">You’re invited</h1>
        <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
          <strong>{peek.email}</strong> was invited {target}. Choose how to continue:
        </p>
        <div className="flex flex-col gap-2.5">
          <button className={`${primaryButton} w-full justify-center`} onClick={() => setMethod('password')}>
            {peek.hasAccount ? 'Sign in with a password' : 'Set up a password'}
          </button>
          {providers.map((p) => (
            // A real navigation: GET /start 302s to the IdP; its callback accepts the invite for this email.
            <a key={p.id} href={api.oidcStartUrl(p.id)} className={`${ghostButton} w-full justify-center`}>
              {peek.hasAccount ? `Continue with ${p.label}` : `Complete registration with ${p.label}`}
            </a>
          ))}
        </div>
        {leave}
      </>,
    );
  }

  return (
    <div>
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-indigo-200/60 dark:border-indigo-500/20 bg-indigo-50/70 dark:bg-indigo-500/10 p-4 text-center text-sm text-indigo-900 dark:text-indigo-200 shadow-sm backdrop-blur-xl">
        You’ve been invited as <strong>{peek.email}</strong> {target}.{' '}
        {peek.hasAccount ? 'Sign in to accept.' : 'Set a password to accept.'}
        {hasOidc && (
          <button className="ml-1 underline hover:no-underline" onClick={() => setMethod('choose')}>
            Use single sign-on instead
          </button>
        )}
      </div>
      {/* Email is locked to the invited address; allowRegister opens set-password mode for a NEW email.
          OIDC is offered on the choice screen above, so it's hidden inside the form (hideOidc). */}
      <Login
        onAuthed={onAuthed}
        lockedEmail={peek.email}
        allowRegister={peek.hasAccount ? undefined : true}
        hideOidc
        branding={branding}
      />
    </div>
  );
}
