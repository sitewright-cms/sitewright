import { useCallback, useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { api, type ApiKeyView } from '../api';
import { glassPanel, dangerButton } from '../theme';

/** Human time: "just now" / "3m ago" / a date; "never" for null (e.g. an unused token). */
function when(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * "AI agent details" — opened from the header's "Agent editing" indicator. Lists the project's
 * ACTIVE agent connections (MCP/OAuth sessions + personal tokens), each with what it can do and when
 * it last acted, and lets an owner DISCONNECT one (revokes the token; for an OAuth session this also
 * severs its refresh chain server-side, so it can't reconnect without re-authorizing).
 */
export function AgentDetailsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [items, setItems] = useState<ApiKeyView[] | null>(null);
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
      await api.deleteApiKey(projectId, id);
      setConfirmId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to disconnect');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="AI agent details" size="lg" onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-slate-500">
          Agents and tokens currently connected to this project. Disconnecting revokes the token immediately — an
          OAuth/MCP agent must re-authorize to reconnect.
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {items === null && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {items !== null && items.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">No active agent connections.</p>
        )}
        {items?.map((c) => (
          <div key={c.id} className={`${glassPanel} flex flex-wrap items-center gap-x-4 gap-y-2 p-3`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-800">{c.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    c.source === 'oauth' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c.source === 'oauth' ? 'OAuth / MCP' : 'Personal token'}
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
                {c.role} · last active {when(c.lastUsedAt)} · connected {when(c.createdAt)}
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
      </div>
    </Modal>
  );
}
