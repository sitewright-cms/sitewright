import { useEffect, useState } from 'react';
import { api, type OrgMember, type Invite } from '../api';
import { InvitePanel } from './InvitePanel';
import { useDialogs } from './ui/Dialogs';
import { glassPanel, dangerButton } from '../theme';

/**
 * Platform-staff surface: list the instance's staff and invite a DEVELOPER via a
 * one-time link. Clients are invited per-project from the project's Clients tab, not here.
 */
export function TeamManager() {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useDialogs();

  async function load() {
    try {
      const [m, inv] = await Promise.all([api.listMembers(), api.listInvites()]);
      setMembers(m.members);
      // Only platform-staff (developer) invites belong on this tab.
      setInvites(inv.invites.filter((i) => i.projectId === null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load team');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(userId: string) {
    const email = members.find((m) => m.userId === userId)?.email ?? 'this member';
    const ok = await confirm({
      title: 'Remove team member',
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

  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 text-lg font-bold">Team</h3>
      <p className="mb-4 text-sm text-slate-500">
        Your platform staff. Invite a <strong>developer</strong> to give them full access to every
        project on this instance.
      </p>

      <ul className="mb-6 flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.userId}
            className={`flex items-center justify-between ${glassPanel} px-4 py-2.5`}
          >
            <span>
              <span className="font-medium text-slate-800">{m.email}</span>{' '}
              <span className="ml-1 rounded-full border border-white/60 bg-white/60 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {m.role}
              </span>
            </span>
            {m.role !== 'owner' && (
              <button
                aria-label={`Remove ${m.email}`}
                className={dangerButton}
                onClick={() => remove(m.userId)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="text-sm text-slate-400">No team members yet.</li>}
      </ul>

      <InvitePanel
        kind="developer"
        invites={invites}
        onInvite={(email) => api.inviteDeveloper(email)}
        onRevoke={(id) => api.revokeInvite(id)}
        onChanged={load}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {dialog}
    </div>
  );
}
