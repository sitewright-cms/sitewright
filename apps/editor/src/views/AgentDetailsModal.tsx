import { useCallback, useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { api, type AgentConnection } from '../api';
import { glassPanel, dangerButton } from '../theme';

/** Human time: "just now" / "3m ago" / a date; "never" for null (e.g. an agent that hasn't acted). */
function when(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Step-by-step "how to connect an agent" — the same MCP setup the admin guide describes, inline so
 * a project owner can wire up an agent without leaving the editor. `origin` is this instance's URL. */
function ConnectGuide({ emphasized }: { emphasized: boolean }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-instance';
  const code = 'rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono text-slate-700';
  return (
    <section className={`rounded-lg border p-4 ${emphasized ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connect an agent</h3>
      <p className="mt-1 text-sm text-slate-600">
        Let an AI agent build this site over MCP. No login step first — the agent triggers it on demand.
      </p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 marker:text-slate-400">
        <li>
          Register the MCP server in your agent: <code className={code}>sitewright mcp --url {origin}</code>
        </li>
        <li>
          When the agent calls its <code className={code}>login</code> tool it shows a link + code (device flow). Open it,
          pick this project, approve — and keep the editor open to watch its changes appear live.
        </li>
        <li>
          Prefer to sign in ahead of time? <code className={code}>sitewright login --url {origin}</code> (add{' '}
          <code className={code}>--device</code> for headless/SSH).
        </li>
      </ol>
    </section>
  );
}

/**
 * "AI agent details" — opened from the header agent indicator. Lists the project's ACTIVE agent
 * connections: live OAuth/MCP agent sessions (shown for the whole session window, even when idle)
 * and personal tokens. Each shows what it can do and when it last acted; an owner can DISCONNECT one
 * (a PAT is revoked; an OAuth session is fully severed server-side — refresh chain + access tokens —
 * so it can't reconnect without re-authorizing). When there are none, the connect guide leads.
 * `onChanged` fires after a disconnect so the header indicator can refresh its count.
 */
export function AgentDetailsModal({
  projectId,
  onClose,
  onChanged,
}: {
  projectId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<AgentConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .listAgentConnections(projectId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load connections'));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  async function disconnect(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.disconnectAgent(projectId, id);
      setConfirmId(null);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to disconnect');
    } finally {
      setBusyId(null);
    }
  }

  const empty = items !== null && items.length === 0;

  return (
    <Modal title="AI agent details" size="lg" onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-slate-500">
          Agents and tokens connected to this project. Disconnecting takes effect immediately — an OAuth/MCP agent must
          re-authorize to reconnect.
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {items === null && !error && <p className="text-sm text-slate-400">Loading…</p>}

        {/* No connections → lead with the connect guide so owners know they CAN add an agent. */}
        {empty && <ConnectGuide emphasized />}

        {items?.map((c) => (
          <div key={c.id} className={`${glassPanel} flex flex-wrap items-center gap-x-4 gap-y-2 p-3`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-800">{c.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    c.kind === 'oauth' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c.kind === 'oauth' ? 'OAuth / MCP' : 'Personal token'}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.capabilities.map((cap) => (
                  <span key={cap} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                    {cap}
                  </span>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {c.role} · last active {when(c.lastUsedAt)} · connected {when(c.connectedAt)}
              </div>
            </div>
            {confirmId === c.id ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-slate-500">Disconnect?</span>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void disconnect(c.id)}
                  className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  {busyId === c.id ? 'Disconnecting…' : 'Confirm'}
                </button>
                <button type="button" onClick={() => setConfirmId(null)} className="px-1.5 text-xs text-slate-500 hover:text-slate-800">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmId(c.id)} className={`${dangerButton} shrink-0`}>
                Disconnect
              </button>
            )}
          </div>
        ))}

        {/* Connections present → the guide still trails, for adding another agent. */}
        {items !== null && items.length > 0 && <ConnectGuide emphasized={false} />}
      </div>
    </Modal>
  );
}
