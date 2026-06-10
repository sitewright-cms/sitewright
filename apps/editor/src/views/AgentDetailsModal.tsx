import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

type ConnectTab = 'chatgpt' | 'claude' | 'lechat' | 'cli';
const TAB_ORDER: ConnectTab[] = ['chatgpt', 'claude', 'lechat', 'cli'];
const CODE = 'rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono text-slate-700';
const PRE = 'mt-1.5 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100';

/** A hosted MCP client (ChatGPT / Claude.ai) connects to the remote MCP server over OAuth. */
function RemoteSteps({ mcpUrl, settingsPath, planNote }: { mcpUrl: string; settingsPath: string; planNote: string }) {
  return (
    <>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600 marker:text-slate-400">
        <li>{settingsPath}</li>
        <li>
          Paste this remote MCP server URL and name it “Sitewright”: <code className={CODE}>{mcpUrl}</code>
        </li>
        <li>
          Connect — you’re sent here to sign in and pick <strong>this</strong> project, then approve. (One project per
          connection; add another connector for another project.)
        </li>
        <li>
          In a chat, enable the Sitewright tools and ask it to build or edit the site — keep this editor open to watch
          the changes appear live.
        </li>
      </ol>
      <p className="mt-2 text-[11px] text-slate-400">{planNote}</p>
    </>
  );
}

/** Step-by-step "how to connect an agent" — three ways: hosted ChatGPT / Claude.ai over the remote MCP
 * endpoint, or a local CLI agent over the device-flow bridge. Inline so an owner can wire up an agent
 * without leaving the editor. `origin` is this instance's URL; `origin/mcp` is the remote MCP endpoint. */
function ConnectGuide({ emphasized }: { emphasized: boolean }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-instance';
  const mcpUrl = `${origin}/mcp`;
  // The block Cursor / Cline / Windsurf / Gemini CLI accept verbatim (mirrors `sitewright config`).
  const cliConfig = useMemo(
    () => JSON.stringify({ mcpServers: { sitewright: { command: 'sitewright', args: ['mcp', '--url', origin] } } }, null, 2),
    [origin],
  );
  const [tab, setTab] = useState<ConnectTab>('chatgpt');
  const tabRefs = useRef(new Map<ConnectTab, HTMLButtonElement | null>());

  // Arrow-key roving between tabs (WAI-ARIA tablist pattern): move selection AND focus.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = TAB_ORDER.indexOf(tab);
    const next = TAB_ORDER[(i + step + TAB_ORDER.length) % TAB_ORDER.length]!;
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  const tabBtn = (key: ConnectTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`agent-tab-${key}`}
      ref={(el) => {
        tabRefs.current.set(key, el);
      }}
      aria-selected={tab === key}
      aria-controls="agent-connect-panel"
      tabIndex={tab === key ? 0 : -1}
      onClick={() => setTab(key)}
      className={`waves-effect rounded-lg px-2.5 py-1 text-xs font-medium transition ${
        tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className={`rounded-lg border p-4 ${emphasized ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Connect an agent</h3>
      <p className="mt-1 text-sm text-slate-600">
        Let an AI agent build this site over MCP — hosted in ChatGPT, Claude.ai or Le Chat, or via a local CLI agent:
      </p>
      <div
        role="tablist"
        aria-label="Connect an agent"
        onKeyDown={onTabKey}
        className="mt-3 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
      >
        {tabBtn('chatgpt', 'ChatGPT.com')}
        {tabBtn('claude', 'Claude.ai')}
        {tabBtn('lechat', 'Le Chat')}
        {tabBtn('cli', 'Local CLI Agents')}
      </div>
      <div role="tabpanel" id="agent-connect-panel" aria-labelledby={`agent-tab-${tab}`} className="mt-3">
        {tab === 'chatgpt' && (
          <RemoteSteps
            mcpUrl={mcpUrl}
            settingsPath="In ChatGPT, open Settings → Connectors → “Add custom connector”."
            planNote="Custom MCP connectors require a ChatGPT plan that supports them (Plus / Pro / Team / Enterprise)."
          />
        )}
        {tab === 'claude' && (
          <RemoteSteps
            mcpUrl={mcpUrl}
            settingsPath="In Claude.ai, open Settings → Connectors → “Add custom connector”."
            planNote="Custom connectors require a paid Claude plan (Pro / Max / Team / Enterprise)."
          />
        )}
        {tab === 'lechat' && (
          <RemoteSteps
            mcpUrl={mcpUrl}
            settingsPath="In Mistral Le Chat, open Connectors → “+ Add Connector” → the “Custom MCP Connector” tab."
            planNote="Le Chat supports custom MCP connectors on its Free plan (it’s an admin-only feature; on Free you’re the admin by default). Its OAuth 2.1 flow matches Sitewright’s — the only major hosted chat with a free path."
          />
        )}
        {tab === 'cli' && (
          <div className="space-y-2.5 text-sm text-slate-600">
            <ol className="list-decimal space-y-1.5 pl-5 marker:text-slate-400">
              <li>
                Install the CLI: <code className={CODE}>npm install -g @sitewright/cli</code> (or run it with{' '}
                <code className={CODE}>npx @sitewright/cli</code>).
              </li>
              <li>
                Add this MCP server to your agent — the same block works for Cursor, Cline, Windsurf, Gemini CLI and most
                MCP-aware tools:
                <pre className={PRE}>{cliConfig}</pre>
              </li>
              <li>
                Or let the CLI print the exact snippet (and file path) for your agent:{' '}
                <code className={CODE}>sitewright config &lt;agent&gt; --url {origin}</code> — e.g.{' '}
                <code className={CODE}>cursor</code>, <code className={CODE}>windsurf</code>,{' '}
                <code className={CODE}>gemini</code>, <code className={CODE}>vscode</code>. Claude Code one-liner:{' '}
                <code className={CODE}>claude mcp add sitewright -- sitewright mcp --url '{origin}'</code>.
              </li>
              <li>
                On first run the agent’s <code className={CODE}>login</code> tool shows a link + code (device flow) — open
                it, pick this project, approve, and keep the editor open to watch changes appear live. Prefer to sign in
                ahead? <code className={CODE}>sitewright login --url {origin}</code> (add <code className={CODE}>--device</code>{' '}
                for headless/SSH).
              </li>
            </ol>
            <p className="text-[11px] text-slate-400">
              Where the block goes: Cursor <code className={CODE}>~/.cursor/mcp.json</code> · Windsurf{' '}
              <code className={CODE}>~/.codeium/windsurf/mcp_config.json</code> · Gemini CLI{' '}
              <code className={CODE}>~/.gemini/settings.json</code> · VS Code <code className={CODE}>.vscode/mcp.json</code>.
            </p>
          </div>
        )}
      </div>
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
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
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
                  className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
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
