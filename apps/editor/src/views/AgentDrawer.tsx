import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, Wrench, CircleCheck, CircleX } from 'lucide-react';
import { api, type AgentGrantView, type ApiKeyCapability } from '../api';
import { glassInput, primaryButton, ghostButton, toggleInput } from '../theme';
import { OVERLAY_STACK } from './ui/overlay';

/** Capabilities the consent panel offers (never `deploy`). */
const CONSENT_CAPS: { cap: ApiKeyCapability; label: string; hint: string }[] = [
  { cap: 'content:read', label: 'Read content', hint: 'always on — the agent must read to act' },
  { cap: 'content:write', label: 'Edit content', hint: 'create & change pages, snippets, datasets' },
  { cap: 'content:delete', label: 'Delete content', hint: 'remove pages/entries (recoverable via History)' },
  { cap: 'publish', label: 'Publish', hint: 'build & publish the live site' },
];

type ToolActivity = { id: string; name: string; ok?: boolean };
type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; tools: ToolActivity[]; streaming: boolean };

type Status = 'idle' | 'thinking' | 'working';

/**
 * The on-page AI assistant chat drawer — a right-side overlay on the preview. On first open it shows the
 * consent panel (the user picks the agent's capabilities); after that, a streaming chat. The server
 * drives the agent + edits the DRAFT, so the preview reloads itself as the agent works.
 */
export function AgentDrawer({ projectId, open, onClose, getPath }: { projectId: string; open: boolean; onClose: () => void; getPath: () => string }) {
  const [grant, setGrant] = useState<AgentGrantView | null>(null);
  const [caps, setCaps] = useState<Set<ApiKeyCapability>>(new Set());
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the consent grant on first open.
  useEffect(() => {
    if (!open || grant) return;
    let active = true;
    api
      .getAgentGrant(projectId)
      .then((g) => {
        if (!active) return;
        setGrant(g);
        setCaps(new Set(g.capabilities));
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'failed to load the assistant'));
    return () => {
      active = false;
    };
  }, [open, grant, projectId]);

  // Esc closes when this is the top overlay.
  useEffect(() => {
    if (!open) return;
    const tok = {};
    OVERLAY_STACK.push(tok);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && OVERLAY_STACK[OVERLAY_STACK.length - 1] === tok) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = OVERLAY_STACK.indexOf(tok);
      if (at !== -1) OVERLAY_STACK.splice(at, 1);
    };
  }, [open, onClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight; // scrollTop (not scrollTo) works in jsdom too
  }, [messages, status]);

  function patchAssistant(fn: (a: Extract<ChatMsg, { role: 'assistant' }>) => Extract<ChatMsg, { role: 'assistant' }>) {
    setMessages((ms) => {
      const next = [...ms];
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i]!;
        if (m.role === 'assistant') {
          next[i] = fn(m);
          break;
        }
      }
      return next;
    });
  }

  async function approve() {
    try {
      const ordered = CONSENT_CAPS.map((c) => c.cap).filter((c) => c === 'content:read' || caps.has(c));
      const g = await api.putAgentGrant(projectId, { capabilities: ordered, autonomy: 'full' });
      setGrant(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to save your choices');
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || status !== 'idle') return;
    setError(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '', tools: [], streaming: true }]);
    setStatus('thinking');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api.streamAgentMessage(
        projectId,
        { conversationId: conversationId.current, message: text, context: { path: getPath() } },
        {
          onStart: (e) => (conversationId.current = e.conversationId),
          onText: (delta) => patchAssistant((a) => ({ ...a, text: a.text + delta })),
          onTool: (t) => {
            setStatus('working');
            patchAssistant((a) => ({ ...a, tools: [...a.tools, { id: t.id, name: t.name }] }));
          },
          onToolResult: (r) => {
            setStatus('thinking');
            patchAssistant((a) => ({ ...a, tools: a.tools.map((tool) => (tool.id === r.id ? { ...tool, ok: r.ok } : tool)) }));
          },
          onDone: (msg) => patchAssistant((a) => ({ ...a, text: a.text || msg, streaming: false })),
          onError: (msg) => {
            setError(msg);
            patchAssistant((a) => ({ ...a, streaming: false }));
          },
        },
        ac.signal,
      );
    } finally {
      abortRef.current = null;
      setStatus('idle');
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStatus('idle');
  }

  const needConsent = grant !== null && !grant.configured;
  const statusLabel = status === 'working' ? 'Working…' : status === 'thinking' ? 'Thinking…' : messages.length ? 'Waiting for you' : 'Ready';

  return (
    <>
      {open && <div className="fixed inset-0 z-[60] bg-slate-900/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden />}
      <aside
        className={`fixed right-0 top-0 z-[61] flex h-full w-[26rem] max-w-[92vw] flex-col border-l border-white/60 bg-white/80 shadow-2xl backdrop-blur-xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-label="AI Assistant"
      >
        <header className="flex items-center gap-2 border-b border-slate-200/70 px-4 py-3">
          <span className="sw-brand-gradient inline-flex h-7 w-7 items-center justify-center rounded-lg text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-800">AI Assistant</div>
            <StatusPill status={status} label={statusLabel} />
          </div>
          <button type="button" aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        {needConsent ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-sm text-slate-600">Choose what the assistant may do on this site. You can change this anytime.</p>
            <div className="flex flex-col gap-2">
              {CONSENT_CAPS.map(({ cap, label, hint }) => (
                <label key={cap} className="flex items-start gap-2.5 rounded-xl border border-white/60 bg-white/60 p-2.5">
                  <input
                    type="checkbox"
                    className={toggleInput}
                    aria-label={label}
                    checked={cap === 'content:read' || caps.has(cap)}
                    disabled={cap === 'content:read'}
                    onChange={(e) =>
                      setCaps((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(cap);
                        else n.delete(cap);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-700">{label}</span>
                    <span className="block text-xs text-slate-400">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <button type="button" className={primaryButton} onClick={approve}>
              Approve &amp; start
            </button>
            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="mt-6 text-center text-sm text-slate-400">
                  Ask me to change this page — e.g. “make the headline shorter” or “add a contact section”.
                </p>
              )}
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
            <div className="border-t border-slate-200/70 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  className={`${glassInput} max-h-32 min-h-[2.5rem] flex-1 resize-none`}
                  aria-label="Message the assistant"
                  placeholder="Ask the assistant to edit this page…"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {status === 'idle' ? (
                  <button type="button" aria-label="Send" className={`${primaryButton} px-3`} onClick={() => void send()} disabled={!input.trim()}>
                    <Send className="h-4 w-4" />
                  </button>
                ) : (
                  <button type="button" className={`${ghostButton} px-3`} onClick={stop}>
                    Stop
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function StatusPill({ status, label }: { status: Status; label: string }) {
  if (status === 'working')
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        {label}
      </span>
    );
  if (status === 'thinking')
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
        <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        {label}
      </span>
    );
  return <span className="text-[11px] font-medium text-slate-400">{label}</span>;
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user')
    return (
      <div className="self-end rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white shadow-sm">{msg.text}</div>
    );
  return (
    <div className="self-start rounded-2xl rounded-bl-sm border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-700 shadow-sm">
      {msg.tools.length > 0 && (
        <ul className="mb-1.5 flex flex-col gap-1">
          {msg.tools.map((t, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs text-slate-500">
              {t.ok === undefined ? (
                <Wrench className="h-3.5 w-3.5 animate-pulse text-amber-500" />
              ) : t.ok ? (
                <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <CircleX className="h-3.5 w-3.5 text-rose-500" />
              )}
              {toolLabel(t.name)}
            </li>
          ))}
        </ul>
      )}
      {msg.text ? <span className="whitespace-pre-wrap">{msg.text}</span> : msg.streaming ? <span className="text-slate-400">…</span> : null}
    </div>
  );
}

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    put_page: 'Editing a page',
    delete_page: 'Deleting a page',
    put_content: 'Editing content',
    delete_content: 'Deleting content',
    publish_project: 'Publishing',
    list_pages: 'Reading pages',
    get_page: 'Reading a page',
  };
  return map[name] ?? name.replace(/_/g, ' ');
}
