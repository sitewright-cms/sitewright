import { useEffect, useState, type FormEvent } from 'react';
import { api, type Org, type OrgMember } from '../api';

interface TeamManagerProps {
  org: Org;
}

/**
 * Owner/admin surface to add CLIENTS to the org as the constrained `member` role.
 * Adding a brand-new client returns a one-time temporary password (shown once, like
 * an API token) for the inviter to share out-of-band — there is no email infra. The
 * member role is the only role this surface can grant.
 */
export function TeamManager({ org }: TeamManagerProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await api.listMembers(org.id);
      setMembers(res.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load members');
    }
  }

  useEffect(() => {
    void load();
  }, [org.id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.addMember(org.id, email.trim());
      if (res.tempPassword) {
        setTempPassword({ email: res.member.email, password: res.tempPassword });
      }
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add member');
    } finally {
      setBusy(false);
    }
  }

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
      <h3 className="mb-1 text-lg font-semibold">Team &amp; clients</h3>
      <p className="mb-4 text-sm text-slate-500">
        Add a client as a <strong>member</strong> — they sign in and can edit only the blocks
        you mark “Editable by client”, on the pages you build.
      </p>

      {tempPassword && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">
            One-time password for {tempPassword.email}
          </p>
          <p className="mt-1 text-amber-800">
            Share this with your client now — it is shown once and cannot be retrieved again.
            They should change it after signing in.
          </p>
          <code className="mt-2 block rounded bg-white px-2 py-1 font-mono text-amber-900">
            {tempPassword.password}
          </code>
          <button
            className="mt-2 text-xs text-amber-700 underline"
            onClick={() => setTempPassword(null)}
          >
            Dismiss
          </button>
        </div>
      )}

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
            {m.role === 'member' && (
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
        {members.length === 0 && <li className="text-sm text-slate-400">No members yet.</li>}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col">
          <label className="text-xs text-slate-500" htmlFor="member-email">
            Client email
          </label>
          <input
            id="member-email"
            aria-label="Client email"
            type="email"
            className="rounded-md border border-slate-300 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@example.com"
            required
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add client'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
