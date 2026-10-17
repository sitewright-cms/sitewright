import { useEffect, useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { api, ApiError, type ApiKeyCapability, type MemberTokenAdminCapability, type MemberTokenCapability, type MemberTokenView } from '../api';
import { glassCard, glassPanel, glassInput, fieldLabel, primaryButton, ghostButton, dangerButton, toggleInput } from '../theme';
import { useDialogs } from './ui/Dialogs';
import { IssuedTokenBanner } from './ui/IssuedTokenBanner';
import { ProviderWriteCapability } from './ui/ProviderWriteCapability';

/** What the token may do INSIDE each project it reaches — the same set a project token offers. */
const PROJECT_CAPABILITIES: ApiKeyCapability[] = ['content:read', 'content:write', 'content:delete', 'publish', 'deploy'];

/**
 * What it may do ACROSS the account. Every one is off until the member turns it on: each reaches past a
 * single project, and two of them (delete, members) are the kind of thing nobody wants an automation to
 * hold by default.
 */
const ACCOUNT_CAPABILITIES: Array<{ cap: MemberTokenAdminCapability; label: string; hint: string }> = [
  {
    cap: 'projects:create',
    label: 'Create projects',
    hint: 'New, duplicated and imported projects, up to the daily limit below. Duplicating also needs content:read.',
  },
  { cap: 'projects:rename', label: 'Rename projects', hint: 'Change the name and slug of projects you own.' },
  {
    cap: 'projects:delete',
    label: 'Delete projects',
    hint: 'Moves a project you own to Deleted projects; an admin can restore it.',
  },
  {
    cap: 'members:manage',
    label: 'Manage members and invites',
    hint: 'List and remove members, and list and revoke invites, on projects you own.',
  },
  {
    // Separate from managing, and worded bluntly: this is the one capability that reaches PAST the
    // token — an invite becomes a person's own login, and approving one hands the token a password.
    cap: 'members:invite',
    label: 'Invite and add members',
    hint: 'Invites people to a project you own, or adds them at once without the invite link — for a new address that creates the account and returns a temporary password to the token, which the person replaces at first sign-in. Either way they get their own sign-in: full editing and the project’s settings, payments included. They stay a member after this token is revoked.',
  },
];

interface MemberTokensManagerProps {
  /** An instance admin reaches every project — said out loud, because so does their token. */
  isInstanceAdmin: boolean;
  /** Minting is confirmed with the account password or a passkey; this says whether there is a password. */
  hasPassword: boolean;
}

/** A passkey the browser can offer on this page's host (see PasskeysSection for the rpID rule). */
const usableHere = (rpId: string | null): boolean => rpId === null || rpId === window.location.hostname;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Account → Access keys → Member tokens: create / list / revoke bearer tokens that belong to the
 * signed-in staff member rather than to one project. A member token reaches every project its owner
 * can open, at the role they hold there, so automation that creates and manages several projects
 * needs one token instead of a key per project. The raw token is shown exactly once.
 */
export function MemberTokensManager({ isInstanceAdmin, hasPassword }: MemberTokensManagerProps) {
  const { confirm, dialog } = useDialogs();
  const [tokens, setTokens] = useState<MemberTokenView[]>([]);
  // The most projects any one token may create a day (the admin's setting); null until loaded.
  const [dailyMax, setDailyMax] = useState<number | null>(null);
  // The limit for THIS token. Null = "not touched", which follows the maximum.
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [caps, setCaps] = useState<MemberTokenCapability[]>(['content:read', 'content:write']);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [currentPassword, setCurrentPassword] = useState('');
  // Whether this account has a passkey the browser can offer here — the other way to confirm.
  const [hasPasskey, setHasPasskey] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // A mint by password is in flight — without this a double click mints two tokens and shows one.
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listMemberTokens();
      if (!isActive()) return; // a tab switch may have unmounted us mid-fetch
      setTokens(res.items);
      setDailyMax(res.dailyProjectMax);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load member tokens');
    }
  }
  useEffect(() => {
    let active = true;
    void load(() => active);
    if (browserSupportsWebAuthn()) {
      api
        .listPasskeys()
        .then((res) => {
          if (active) setHasPasskey(res.items.some((pk) => usableHere(pk.rpId)));
        })
        .catch(() => {
          /* no passkey option then — the password one still works */
        });
    }
    return () => {
      active = false;
    };
  }, []);

  function toggleCap(cap: MemberTokenCapability) {
    setCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  }

  const createsProjects = caps.includes('projects:create');
  const effectiveLimit = dailyLimit ?? dailyMax;
  const canCreate = caps.length > 0 && name.trim().length > 0 && !confirming && !submitting;

  /** Mints the token once the member has confirmed it is them, by password or by passkey. */
  async function mint(proof: Pick<Parameters<typeof api.createMemberToken>[0], 'currentPassword' | 'passkey'>) {
    const res = await api.createMemberToken({
      ...proof,
      name,
      capabilities: caps,
      expiresInDays,
      // Sent only when the member lowered it: left alone, the token follows the instance maximum.
      ...(createsProjects && dailyLimit !== null && dailyMax !== null && dailyLimit < dailyMax ? { dailyProjectLimit: dailyLimit } : {}),
    });
    setIssued(res.token); // shown ONCE
    setName('');
    setCurrentPassword('');
    setDailyLimit(null);
    await load();
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setError(null);
    setIssued(null);
    setSubmitting(true);
    try {
      await mint({ currentPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create member token');
    } finally {
      setSubmitting(false);
    }
  }

  async function createWithPasskey() {
    setError(null);
    setIssued(null);
    setConfirming(true);
    try {
      const { options, handle } = await api.passkeyConfirmOptions();
      const response = await startAuthentication({ optionsJSON: options });
      await mint({ passkey: { handle, response } });
    } catch (err) {
      // Only a dismissed or timed-out prompt is "cancelled". Anything else — a refused confirmation,
      // a dropped connection after the authenticator answered — is reported as what it was, because
      // "cancelled" would tell the member nothing happened when a token may have been made.
      const cancelled = !(err instanceof ApiError) && err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
      setError(cancelled ? 'The passkey prompt was cancelled or didn’t complete.' : err instanceof Error ? err.message : 'failed to create member token');
    } finally {
      setConfirming(false);
    }
  }

  async function revoke(token: MemberTokenView) {
    setError(null);
    if (
      !(await confirm({
        title: 'Revoke member token',
        message: `Revoke “${token.name}”? Anything using it stops working immediately, on every project.`,
        confirmLabel: 'Revoke',
      }))
    )
      return;
    try {
      await api.deleteMemberToken(token.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to revoke member token');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        A member token acts as you on{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {isInstanceAdmin ? 'every project on this instance' : 'every project you can open'}
        </span>
        , at the role you hold there — including projects created later. Give it only what the automation needs.
      </p>
      {issued && <IssuedTokenBanner token={issued} label="New member token" onDismiss={() => setIssued(null)} />}

      <form onSubmit={create} className={`flex flex-col gap-4 ${glassCard} p-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className={fieldLabel} htmlFor="member-token-name">Name</label>
            <input
              id="member-token-name"
              aria-label="Member token name"
              className={glassInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Site fleet"
              required
            />
          </div>
          <div className="flex flex-col">
            <label className={fieldLabel} htmlFor="member-token-ttl">Expires (days)</label>
            <input
              id="member-token-ttl"
              aria-label="Member token expiry in days"
              type="number"
              min={1}
              max={365}
              className={`w-24 ${glassInput}`}
              value={expiresInDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v) && v >= 1 && v <= 365) setExpiresInDays(v);
              }}
            />
          </div>
        </div>
        <fieldset className="flex flex-col">
          <legend className={fieldLabel}>In each project</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {PROJECT_CAPABILITIES.map((cap) => (
              <label key={cap} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" className={toggleInput} checked={caps.includes(cap)} onChange={() => toggleCap(cap)} /> {cap}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col">
          <legend className={fieldLabel}>Across your account — off unless you turn it on</legend>
          <div className="flex flex-col gap-2 pt-1">
            {ACCOUNT_CAPABILITIES.map(({ cap, label, hint }) => (
              <label key={cap} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" className={`${toggleInput} mt-0.5`} checked={caps.includes(cap)} onChange={() => toggleCap(cap)} />
                <span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">{label}</span>
                  <span className="block text-slate-500 dark:text-slate-400">{hint}</span>
                </span>
              </label>
            ))}
            {isInstanceAdmin && (
              <ProviderWriteCapability checked={caps.includes('payments:provider:write')} onToggle={() => toggleCap('payments:provider:write')} />
            )}
          </div>
        </fieldset>
        {createsProjects && dailyMax !== null && (
          <div className="flex flex-col">
            <label className={fieldLabel} htmlFor="member-token-daily-limit">New projects per day</label>
            <input
              id="member-token-daily-limit"
              type="number"
              min={1}
              max={dailyMax}
              // `glassInput` is full-width; the cap keeps a two-digit number from spanning the card.
              className={`max-w-24 ${glassInput}`}
              value={effectiveLimit ?? ''}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) setDailyLimit(Math.max(1, Math.min(dailyMax, v)));
              }}
            />
            <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              The most projects this token may create in 24 hours. The maximum on this instance is {dailyMax}
              {isInstanceAdmin ? ' — change it in System settings → Security.' : ', set by an admin.'} Left at the
              maximum, the token follows it if it is changed later.
            </span>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className={fieldLabel}>Confirm it is you</span>
          <span className="-mt-1 text-xs text-slate-500 dark:text-slate-400">
            This token keeps working after you sign out, so creating it asks for
            {hasPassword && hasPasskey ? ' your password or a passkey.' : hasPasskey ? ' a passkey.' : ' your password.'}
          </span>
          {hasPassword && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label className={fieldLabel} htmlFor="member-token-password">Your password</label>
                <input
                  id="member-token-password"
                  type="password"
                  autoComplete="current-password"
                  className={`w-56 max-w-full ${glassInput}`}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <button type="submit" disabled={!canCreate || currentPassword.length === 0} className={`${primaryButton} disabled:opacity-50`}>
                Create member token
              </button>
            </div>
          )}
          {hasPasskey && (
            <div>
              <button
                type="button"
                disabled={!canCreate}
                className={`${hasPassword ? ghostButton : primaryButton} disabled:opacity-50`}
                onClick={() => void createWithPasskey()}
              >
                {confirming ? 'Waiting for your device…' : hasPassword ? 'Create with a passkey instead' : 'Create with a passkey'}
              </button>
            </div>
          )}
          {!hasPassword && !hasPasskey && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Your account signs in via single sign-on and has neither a password nor a passkey here. Add a passkey on the Security tab, or set a password on the Password tab — then sign in again and create the token.
            </p>
          )}
        </div>
      </form>

      <ul className="flex flex-col gap-2">
        {tokens.map((t) => {
          const expired = new Date(t.expiresAt).getTime() <= Date.now();
          return (
            <li key={t.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${glassPanel} px-4 py-3 text-sm`}>
              <span className="font-medium text-slate-800 dark:text-slate-100">{t.name}</span>
              <code className="text-xs text-slate-500 dark:text-slate-400">{t.tokenPrefix}…</code>
              <span className={`text-xs ${expired ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {expired ? 'Expired' : 'Expires'} {formatDate(t.expiresAt)}
              </span>
              <button aria-label={`Revoke member token ${t.name}`} className={`ml-auto ${dangerButton}`} onClick={() => void revoke(t)}>
                Revoke
              </button>
              <span className="basis-full text-xs text-slate-500 dark:text-slate-400">
                {t.capabilities.join(', ')}
                {t.capabilities.includes('projects:create') && dailyMax !== null && (
                  <> · up to {Math.min(t.dailyProjectLimit ?? dailyMax, dailyMax)} new projects a day</>
                )}
              </span>
            </li>
          );
        })}
        {tokens.length === 0 && (
          <li className="text-sm text-slate-500 dark:text-slate-400">
            No member tokens yet. Create one for an agent or automation that works across several projects.
          </li>
        )}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
