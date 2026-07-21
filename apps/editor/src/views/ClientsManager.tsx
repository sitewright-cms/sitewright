import { useEffect, useState } from 'react';
import { api, type Project, type OrgMember, type Invite } from '../api';
import { InvitePanel } from './InvitePanel';
import { useDialogs } from './ui/Dialogs';
import { glassPanel, dangerButton } from '../theme';

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
  const { confirm, dialog } = useDialogs();

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

      <ul className="mb-6 flex flex-col gap-2">
        {clients.map((m) => (
          <li
            key={m.userId}
            className={`flex items-center justify-between ${glassPanel} px-4 py-2.5`}
          >
            <span className="font-medium text-slate-800 dark:text-slate-100">{m.email}</span>
            <button
              aria-label={`Remove ${m.email}`}
              className={dangerButton}
              onClick={() => remove(m.userId)}
            >
              Remove
            </button>
          </li>
        ))}
        {clients.length === 0 && <li className="text-sm text-slate-400 dark:text-slate-500">No project members yet.</li>}
      </ul>

      <InvitePanel
        kind="client"
        invites={invites}
        onInvite={(email) => api.inviteClient(project.id, email)}
        onRevoke={(id) => api.revokeInvite(id)}
        onChanged={load}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {dialog}
    </div>
  );
}
