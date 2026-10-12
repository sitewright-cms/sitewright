import { useEffect, useState } from 'react';
import { api, type OrgMember, type Invite } from '../api';
import { InvitePanel } from './InvitePanel';
import { useDialogs } from './ui/Dialogs';
import { useToast } from './ui/Toast';
import { OneTimeSecret } from './ui/OneTimeSecret';
import { Modal } from './ui/Modal';
import { glassPanel, dangerButton, ghostButton, primaryButton } from '../theme';

/** The staff roles an admin may grant. Developer first — the safer default for a new staff account. */
const STAFF_ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'admin', label: 'Admin' },
] as const;

/**
 * Platform-staff surface ("Administrators"): list the instance's staff and invite a DEVELOPER via a
 * one-time link. Project members are invited per-project from the project's Project Members panel, not here.
 */
export function TeamManager() {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ label: string; secret: string } | null>(null);
  // A password reset waiting on the admin's answer about that account's member tokens.
  const [pendingReset, setPendingReset] = useState<{ userId: string; email: string; liveTokens: number | 'unknown' } | null>(null);
  const { confirm, dialog } = useDialogs();
  const toast = useToast();

  async function load() {
    try {
      const [m, inv] = await Promise.all([api.listMembers(), api.listInvites()]);
      setMembers(m.members);
      // Only platform-staff (developer) invites belong on this tab.
      setInvites(inv.invites.filter((i) => i.projectId === null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load administrators');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(userId: string) {
    const email = members.find((m) => m.userId === userId)?.email ?? 'this member';
    const ok = await confirm({
      title: 'Remove administrator',
      message: `Remove ${email} from this instance? They lose access to every project.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.removeMember(userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to remove member');
    }
  }

  /** Approve a pending staff invite outright — the link flow's alternative, same as for clients. */
  async function approve(invite: Invite) {
    const ok = await confirm({
      title: `Approve ${invite.role} without the invite link`,
      message:
        `Grant ${invite.email} the ${invite.role} role on this instance now? ` +
        (invite.role === 'admin'
          ? 'An admin can change instance settings and reaches EVERY project. '
          : 'A developer can create projects and reaches every project they own. ') +
        'If they have no account yet, one is created and a password is shown ONCE.',
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await api.approveStaffInvite(invite.id);
      if (res.password) setIssued({ label: res.email, secret: res.password });
      else toast.show(`${res.email} already had an account — the ${invite.role} role was granted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to approve the invite');
    }
  }

  /**
   * Issue a fresh password for another staff account (never your own — see the route).
   *
   * Their automation signs in with member tokens, not this password. A forgotten password is no
   * reason to stop it; a compromised account is. The admin knows which — so when the account has
   * working tokens (or we could not find out), the confirmation ASKS, in the same dialog, and
   * dismissing it cancels the whole reset rather than answering for them.
   */
  async function resetPassword(userId: string, email: string) {
    setError(null);
    const live = await api
      .listAllMemberTokens()
      .then((res) => res.items.filter((t) => t.owner.userId === userId && t.status === 'active').length)
      .catch(() => 'unknown' as const);
    if (live !== 0) {
      setPendingReset({ userId, email, liveTokens: live });
      return;
    }
    const ok = await confirm({
      title: 'Issue a new password',
      message: `Replace ${email}'s password? Their current one stops working immediately, and the new one is shown ONCE.`,
      confirmLabel: 'Issue new password',
    });
    // No tokens, so nothing was asked and nothing is said: the server's cautious default (revoke)
    // is a no-op here, and the right call if a token was minted since the count was read.
    if (ok) await issuePassword(userId, email, undefined);
  }

  async function issuePassword(userId: string, email: string, revokeMemberTokens: boolean | undefined) {
    setPendingReset(null);
    try {
      const res = await api.resetStaffPassword(userId, revokeMemberTokens);
      setIssued({ label: res.email ?? email, secret: res.password });
      if (res.revokedMemberTokens > 0) {
        toast.show(`${res.revokedMemberTokens === 1 ? 'Their member token was' : `Their ${res.revokedMemberTokens} member tokens were`} revoked.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to issue a new password');
    }
  }

  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 text-lg font-bold">Administrators</h3>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Your platform staff. A <strong>developer</strong> can create projects and reaches every project
        they own; an <strong>admin</strong> can additionally change instance settings and reaches every
        project on this instance.
      </p>

      {issued && <OneTimeSecret label={issued.label} secret={issued.secret} onDismiss={() => setIssued(null)} />}

      <ul className="mb-6 flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.userId}
            className={`flex items-center justify-between ${glassPanel} px-4 py-2.5`}
          >
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{m.email}</span>{' '}
              <span className="ml-1 rounded-full border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {m.role}
              </span>
            </span>
            {m.role !== 'owner' && (
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`Issue a new password for ${m.email}`}
                  className={`${ghostButton} px-2.5 py-1 text-xs`}
                  onClick={() => void resetPassword(m.userId, m.email)}
                >
                  New password
                </button>
                <button
                  aria-label={`Remove ${m.email}`}
                  className={dangerButton}
                  onClick={() => remove(m.userId)}
                >
                  Remove
                </button>
              </span>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No administrators yet.</li>}
      </ul>

      <InvitePanel
        kind="developer"
        invites={invites}
        onInvite={(email, role) => api.inviteDeveloper(email, role)}
        onRevoke={(id) => api.revokeInvite(id)}
        onChanged={load}
        onApprove={approve}
        roleOptions={STAFF_ROLES}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {dialog}
      {pendingReset && (
        <ResetPasswordDialog
          email={pendingReset.email}
          liveTokens={pendingReset.liveTokens}
          onCancel={() => setPendingReset(null)}
          onConfirm={(revoke) => void issuePassword(pendingReset.userId, pendingReset.email, revoke)}
        />
      )}
    </div>
  );
}

/**
 * "Issue a new password" for an account that has member tokens: the confirmation and the question
 * about those tokens in ONE dialog. Neither answer is pre-selected and the action stays disabled
 * until one is chosen; closing the dialog any other way issues nothing.
 */
function ResetPasswordDialog({
  email,
  liveTokens,
  onCancel,
  onConfirm,
}: {
  email: string;
  /** How many working tokens the account has, or 'unknown' when the list could not be read. */
  liveTokens: number | 'unknown';
  onCancel: () => void;
  onConfirm: (revokeMemberTokens: boolean) => void;
}) {
  const [choice, setChoice] = useState<'keep' | 'revoke' | null>(null);
  const one = liveTokens === 1;
  const holds = liveTokens === 'unknown' ? 'may have member tokens' : one ? 'has a member token' : `has ${liveTokens} member tokens`;
  return (
    <Modal title="Issue a new password" size="md" onClose={onCancel}>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Replace {email}&rsquo;s password? Their current one stops working immediately, and the new one is shown ONCE.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-bold text-slate-700 dark:text-slate-200">Their member tokens</legend>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {email} {holds} that agents or automation sign in with — not with this password.
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="reset-member-tokens" className="mt-0.5" aria-labelledby="reset-tokens-keep" aria-describedby="reset-tokens-keep-hint" checked={choice === 'keep'} onChange={() => setChoice('keep')} />
            <span>
              <span id="reset-tokens-keep" className="font-medium text-slate-800 dark:text-slate-100">Keep {one ? 'it' : 'them'} working</span>
              <span id="reset-tokens-keep-hint" className="block text-xs text-slate-500 dark:text-slate-400">For a forgotten password. Nothing that uses a token is interrupted.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="reset-member-tokens" className="mt-0.5" aria-labelledby="reset-tokens-revoke" aria-describedby="reset-tokens-revoke-hint" checked={choice === 'revoke'} onChange={() => setChoice('revoke')} />
            <span>
              <span id="reset-tokens-revoke" className="font-medium text-slate-800 dark:text-slate-100">Revoke {one ? 'it' : 'them'}</span>
              <span id="reset-tokens-revoke-hint" className="block text-xs text-slate-500 dark:text-slate-400">
                If the account may be compromised. Everything using a token stops, on every project.
              </span>
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${primaryButton} disabled:opacity-50`} disabled={choice === null} onClick={() => choice !== null && onConfirm(choice === 'revoke')}>
            Issue new password
          </button>
        </div>
      </div>
    </Modal>
  );
}
