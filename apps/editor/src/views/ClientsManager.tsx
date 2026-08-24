import { useEffect, useState } from 'react';
import { api, type Project, type OrgMember, type Invite } from '../api';
import { InvitePanel } from './InvitePanel';
import { useDialogs } from './ui/Dialogs';
import { useToast } from './ui/Toast';
import { OneTimeSecret } from './ui/OneTimeSecret';
import { glassPanel, dangerButton, ghostButton } from '../theme';

interface ClientsManagerProps {
  project: Project;
}

/**
 * Owner surface to manage a PROJECT's clients (project-scoped members). A client
 * invited here can edit only this project's editable regions — never any other project.
 */
export function ClientsManager({ project }: ClientsManagerProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A password the server just minted, held until the admin dismisses it. Never refetched — the server
  // keeps only the hash, so leaving this screen loses it for good.
  const [issued, setIssued] = useState<{ label: string; secret: string } | null>(null);
  const { confirm, dialog } = useDialogs();
  const toast = useToast();

  async function load() {
    try {
      const [m, inv] = await Promise.all([
        api.listProjectMembers(project.id),
        api.listProjectInvites(project.id),
      ]);
      setMembers(m.members);
      setInvites(inv.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load project members');
    }
  }

  useEffect(() => {
    void load();
  }, [project.id]);

  async function remove(userId: string) {
    const email = members.find((m) => m.userId === userId)?.email ?? 'this member';
    const ok = await confirm({
      title: 'Remove project member',
      message: `Remove ${email} from ${project.name}? They lose access to edit this project.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.removeProjectMember(project.id, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to remove project member');
    }
  }

  /** Approve a pending invite outright — the admin vouches instead of the invitee clicking a link. */
  async function approve(invite: Invite) {
    const ok = await confirm({
      title: 'Approve without the invite link',
      message:
        `Grant ${invite.email} access to ${project.name} now? ` +
        'If they have no account yet, one is created and a password is shown ONCE. ' +
        'The outstanding invite link stops working either way.',
      confirmLabel: 'Approve',
      danger: false,
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await api.approveProjectInvite(project.id, invite.id);
      // An existing account keeps its own password — there is nothing to reveal, and saying so beats a
      // blank panel the admin waits on.
      if (res.password) setIssued({ label: res.email, secret: res.password });
      else toast.show(`${res.email} already had an account — access granted, password unchanged.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to approve the invite');
    }
  }

  /** Issue a fresh password for a member who cannot sign in (lost it, or never had one via SSO). */
  async function resetPassword(userId: string, email: string) {
    const ok = await confirm({
      title: 'Issue a new password',
      message: `Replace ${email}'s password? Their current one stops working immediately, and the new one is shown ONCE.`,
      confirmLabel: 'Issue new password',
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await api.resetProjectMemberPassword(project.id, userId);
      setIssued({ label: res.email ?? email, secret: res.password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to issue a new password');
    }
  }

  // Agency staff (platform admin/developer) aren't clients — hide them from this list (and the server
  // refuses to remove them anyway). Only plain client members are listed/removable here.
  const clients = members.filter((m) => !m.platformRole);

  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 text-lg font-bold">Project Members</h3>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        People you’ve invited to edit <strong>{project.name}</strong> — full editing of this one
        project (they can’t delete it or invite others).
      </p>

      {issued && <OneTimeSecret label={issued.label} secret={issued.secret} onDismiss={() => setIssued(null)} />}

      <ul className="mb-6 flex flex-col gap-2">
        {clients.map((m) => (
          <li
            key={m.userId}
            className={`flex items-center justify-between ${glassPanel} px-4 py-2.5`}
          >
            <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">{m.email}</span>
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
          </li>
        ))}
        {clients.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No project members yet.</li>}
      </ul>

      <InvitePanel
        kind="client"
        invites={invites}
        onInvite={(email) => api.inviteClient(project.id, email)}
        onRevoke={(id) => api.revokeInvite(id)}
        onChanged={load}
        onApprove={approve}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {dialog}
    </div>
  );
}
