import { useEffect, useState } from 'react';
import { api, type Org, type OrgMember, type Invite } from '../api';
import { InvitePanel } from './InvitePanel';

interface TeamManagerProps {
  org: Org;
}

/**
 * Owner/admin surface for the agency's own team: list staff (owner/admin) and invite a
 * DEVELOPER (org-level admin) via a one-time link. Clients are invited per-project from
 * the project's Clients tab, not here.
 */
export function TeamManager({ org }: TeamManagerProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [m, inv] = await Promise.all([api.listMembers(org.id), api.listInvites(org.id)]);
      setMembers(m.members);
      // Only org-level (developer) invites belong on this tab.
      setInvites(inv.invites.filter((i) => i.projectId === null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load team');
    }
  }

  useEffect(() => {
    void load();
  }, [org.id]);

  async function remove(userId: string) {
    setError(null);
    try {
      await api.removeMember(org.id, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to remove member');
    }
  }

  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 text-lg font-semibold">Team</h3>
      <p className="mb-4 text-sm text-slate-500">
        Your agency’s staff. Invite a <strong>developer</strong> to give them full access to every
        project in this organization.
      </p>

      <ul className="mb-6 flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5"
          >
            <span>
              <span className="font-medium">{m.email}</span>{' '}
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                {m.role}
              </span>
            </span>
            {m.role !== 'owner' && (
              <button
                aria-label={`Remove ${m.email}`}
                className="text-xs text-red-500 hover:text-red-700"
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
        onInvite={(email) => api.inviteDeveloper(org.id, email)}
        onRevoke={(id) => api.revokeInvite(org.id, id)}
        onChanged={load}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
