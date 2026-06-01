import { useEffect, useState } from 'react';
import { api, type Org, type Project, type OrgMember, type Invite } from '../api';
import { InvitePanel } from './InvitePanel';

interface ClientsManagerProps {
  org: Org;
  project: Project;
}

/**
 * Owner/admin surface to manage a PROJECT's clients (project-scoped members). A client
 * invited here can edit only this project's editable regions — never the rest of the
 * org's projects.
 */
export function ClientsManager({ org, project }: ClientsManagerProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [m, inv] = await Promise.all([
        api.listProjectMembers(org.id, project.id),
        api.listInvites(org.id, project.id),
      ]);
      setMembers(m.members);
      setInvites(inv.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load clients');
    }
  }

  useEffect(() => {
    void load();
  }, [org.id, project.id]);

  async function remove(userId: string) {
    setError(null);
    try {
      await api.removeProjectMember(org.id, project.id, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to remove client');
    }
  }

  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 text-lg font-semibold">Clients</h3>
      <p className="mb-4 text-sm text-slate-500">
        People who can edit <strong>{project.name}</strong>’s content — only the blocks you mark
        “Editable by client”, and only this project.
      </p>

      <ul className="mb-6 flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5"
          >
            <span className="font-medium">{m.email}</span>
            <button
              aria-label={`Remove ${m.email}`}
              className="text-xs text-red-500 hover:text-red-700"
              onClick={() => remove(m.userId)}
            >
              Remove
            </button>
          </li>
        ))}
        {members.length === 0 && <li className="text-sm text-slate-400">No clients yet.</li>}
      </ul>

      <InvitePanel
        kind="client"
        invites={invites}
        onInvite={(email) => api.inviteClient(org.id, project.id, email)}
        onRevoke={(id) => api.revokeInvite(org.id, id)}
        onChanged={load}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
