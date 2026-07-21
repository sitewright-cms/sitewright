import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, Wrench, CircleCheck, CircleX, Paperclip, FileText, SquarePen } from 'lucide-react';
import { api, type AgentAttachment, type AgentGrantView, type ApiKeyCapability } from '../api';
import { glassInput, primaryButton, ghostButton, toggleInput } from '../theme';
import { OVERLAY_STACK } from './ui/overlay';
import { ChatMarkdown } from '../lib/chat-markdown';

/** Attachment MIME types the chat accepts (raster images anywhere; PDF is Anthropic-only). */
const ACCEPT_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 7_000_000;

/** A pending attachment: the wire payload plus a local preview URL (images) + byte size for display. */
type PendingAttachment = AgentAttachment & { previewUrl?: string; size: number };

/** Read a File into a base64 attachment (strips the `data:<mime>;base64,` prefix). */
function fileToAttachment(file: File): Promise<PendingAttachment | null> {
  return new Promise((resolve) => {
    if (!ACCEPT_MIME.includes(file.type) || file.size > MAX_ATTACHMENT_BYTES) return resolve(null);
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const url = String(reader.result);
      const base64 = url.slice(url.indexOf(',') + 1);
      const kind = file.type === 'application/pdf' ? 'document' : 'image';
      resolve({ kind, mimeType: file.type, data: base64, name: file.name, size: file.size, previewUrl: kind === 'image' ? url : undefined });
    };
    reader.readAsDataURL(file);
  });
}

/** Capabilities the consent panel offers (never `deploy`). */
const CONSENT_CAPS: { cap: ApiKeyCapability; label: string; hint: string }[] = [
  { cap: 'content:read', label: 'Read content', hint: 'always on — the agent must read to act' },
  { cap: 'content:write', label: 'Edit content', hint: 'create & change pages, snippets, datasets' },
  { cap: 'content:delete', label: 'Delete content', hint: 'remove pages/entries (recoverable via History)' },
  { cap: 'publish', label: 'Publish', hint: 'build & publish the live site' },
];

type ToolActivity = { id: string; name: string; ok?: boolean; summary?: string };
type ChatMsg =
  | { role: 'user'; text: string; attachments?: { kind: 'image' | 'document'; previewUrl?: string; name?: string }[] }
  | { role: 'assistant'; text: string; tools: ToolActivity[]; streaming: boolean; tokens?: number };

type Status = 'idle' | 'thinking' | 'working';

/** Persisted chat state (per project) so the transcript survives a page reload. */
interface PersistedChat {
  conversationId?: string;
  messages: ChatMsg[];
  sessionTokens: number;
}
const CHAT_STORE_PREFIX = 'sw-agent-chat:';
const chatKey = (projectId: string): string => `${CHAT_STORE_PREFIX}${projectId}`;

/** Best-effort read of a persisted chat; any streaming flag is cleared (a reload ends any live turn). */
function loadChat(projectId: string): PersistedChat | null {
  try {
    const raw = localStorage.getItem(chatKey(projectId));
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistedChat;
    const messages = (p.messages ?? []).map((m) => (m.role === 'assistant' ? { ...m, streaming: false } : m));
    return { conversationId: p.conversationId, messages, sessionTokens: p.sessionTokens ?? 0 };
  } catch {
    return null;
  }
}
/** Persist the chat; strips attachment data-URL previews (localStorage quota) — the labelled chip stays. */
function saveChat(projectId: string, messages: ChatMsg[], conversationId: string | undefined, sessionTokens: number): void {
  try {
    const slim = messages.map((m) =>
      m.role === 'user' && m.attachments
        ? { ...m, attachments: m.attachments.map((a) => ({ kind: a.kind, name: a.name })) }
        : m.role === 'assistant'
          ? { ...m, streaming: false }
          : m,
    );
    localStorage.setItem(chatKey(projectId), JSON.stringify({ conversationId, messages: slim, sessionTokens }));
  } catch {
    /* quota exceeded / storage unavailable — persistence is best-effort */
  }
}
function clearChat(projectId: string): void {
  try {
    localStorage.removeItem(chatKey(projectId));
  } catch {
    /* ignore */
  }
}

/**
 * The on-page AI assistant chat drawer — a right-side overlay on the preview. On first open it shows the
 * consent panel (the user picks the agent's capabilities); after that, a streaming chat. The server
 * drives the agent + edits the DRAFT, so the preview reloads itself as the agent works.
 */
export function AgentDrawer({
  projectId,
  open,
  onClose,
  getPath,
  onStatusChange,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  getPath: () => string;
  /** Reports the live turn status up so the preview shell can animate its AI button. */
  onStatusChange?: (s: Status) => void;
}) {
  const [grant, setGrant] = useState<AgentGrantView | null>(null);
  const [caps, setCaps] = useState<Set<ApiKeyCapability>>(new Set());
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sessionTokens, setSessionTokens] = useState(0);
  const conversationId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The agent interleaves prose + tool calls; when it resumes talking AFTER acting, start a fresh
  // assistant bubble (so multi-step work reads as separate replies, not one concatenated blob).
  const newSegmentRef = useRef(false);
  // Whether a terminal frame (done/error) arrived — a stream that ends without one dropped mid-turn.
  const gotTerminalRef = useRef(false);
  // Guards the persist effect so it can't overwrite stored history with the empty initial state
  // before the one-time rehydrate has run.
  const hydratedRef = useRef(false);

  // --- session persistence: the transcript + conversationId survive a page reload (per project) ---
  useEffect(() => {
    const p = loadChat(projectId);
    if (p && p.messages.length) {
      setMessages(p.messages);
      conversationId.current = p.conversationId;
      setSessionTokens(p.sessionTokens);
    }
    hydratedRef.current = true;
  }, [projectId]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (messages.length === 0) clearChat(projectId); // an empty chat drops the stored key entirely
    else saveChat(projectId, messages, conversationId.current, sessionTokens);
  }, [messages, sessionTokens, projectId]);

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setSessionTokens(0);
    setError(null);
    conversationId.current = undefined;
    clearChat(projectId);
  }

  // Add dropped/picked/pasted files as attachments (dedup by name+size, cap the count + reject others).
  async function addFiles(files: FileList | File[]) {
    const converted = (await Promise.all(Array.from(files).map(fileToAttachment))).filter((a): a is PendingAttachment => a !== null);
    if (converted.length < Array.from(files).length) {
      setError('Some files were skipped — only images (PNG/JPEG/WebP/GIF) or PDFs up to 7 MB are accepted.');
    }
    setAttachments((prev) => [...prev, ...converted].slice(0, MAX_ATTACHMENTS));
  }

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

  // Auto-grow the composer with its content up to ~50vh, then it scrolls internally.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.5))}px`;
  }, [input]);

  // Surface the live turn status to the shell (animates the preview's AI button).
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // Closing the drawer does NOT cancel an in-flight turn: the drawer stays mounted (just slid
  // off-screen), so the stream keeps running, the transcript keeps updating, and the status keeps
  // flowing to the shell's AI button (which pulses while closed). Aborting is an explicit action
  // (the Stop button, or New chat) — reopen the drawer to reach Stop.

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
    // Guard on the abort REF (set synchronously below), not the `status` state — a rapid double-click
    // sees the same pre-render `status` in both closures, but the ref is updated immediately.
    if ((!text && attachments.length === 0) || abortRef.current) return;
    setError(null);
    setInput('');
    const sent = attachments;
    setAttachments([]);
    const shownAttach = sent.map((a) => ({ kind: a.kind, previewUrl: a.previewUrl, name: a.name }));
    setMessages((m) => [...m, { role: 'user', text, attachments: shownAttach.length ? shownAttach : undefined }, { role: 'assistant', text: '', tools: [], streaming: true }]);
    setStatus('thinking');
    newSegmentRef.current = false;
    gotTerminalRef.current = false;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api.streamAgentMessage(
        projectId,
        {
          conversationId: conversationId.current,
          message: text,
          ...(sent.length ? { attachments: sent.map(({ kind, mimeType, data, name }) => ({ kind, mimeType, data, name })) } : {}),
          context: { path: getPath() },
        },
        {
          onStart: (e) => (conversationId.current = e.conversationId),
          onText: (delta) => {
            if (newSegmentRef.current) {
              // First prose after a tool call → seal the current bubble and open a new one.
              newSegmentRef.current = false;
              setMessages((m) => {
                const sealed = m.map((msg, i) => (i === m.length - 1 && msg.role === 'assistant' ? { ...msg, streaming: false } : msg));
                return [...sealed, { role: 'assistant', text: delta, tools: [], streaming: true }];
              });
            } else {
              patchAssistant((a) => ({ ...a, text: a.text + delta }));
            }
          },
          onTool: (t) => {
            setStatus('working');
            patchAssistant((a) => ({ ...a, tools: [...a.tools, { id: t.id, name: t.name }] }));
            newSegmentRef.current = true; // the next prose is a new reply segment
          },
          onToolResult: (r) => {
            setStatus('thinking');
            // Keep the result summary — on a FAILED tool it's the reason (e.g. a validation error),
            // which the bubble shows so a failed edit isn't just a silent ✗.
            patchAssistant((a) => ({ ...a, tools: a.tools.map((tool) => (tool.id === r.id ? { ...tool, ok: r.ok, summary: r.summary } : tool)) }));
          },
          // Per-segment tokens under the bubble + a running SESSION total in the header.
          onUsage: (u) => {
            const n = u.inputTokens + u.outputTokens;
            setSessionTokens((t) => t + n);
            patchAssistant((a) => ({ ...a, tokens: (a.tokens ?? 0) + n }));
          },
          onDone: (msg) => {
            gotTerminalRef.current = true;
            patchAssistant((a) => ({ ...a, text: a.text || msg, streaming: false }));
          },
          onError: (msg) => {
            gotTerminalRef.current = true;
            setError(msg);
            patchAssistant((a) => ({ ...a, streaming: false }));
          },
        },
        ac.signal,
      );
    } finally {
      abortRef.current = null;
      setStatus('idle');
      // Finalize the streaming bubble — an aborted turn returns without a done/error frame, so this
      // clears the "…" placeholder / streaming flag when the user hits Stop.
      patchAssistant((a) => ({ ...a, streaming: false }));
      // Stream ended with NO terminal frame and the user didn't stop it → the connection dropped
      // mid-turn. Tell them (the server aborts its side on disconnect; the work can be resumed).
      if (!gotTerminalRef.current && !ac.signal.aborted) {
        setError('The connection ended before the agent finished — send “continue” to resume.');
      }
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
      {/* No full-screen backdrop: the drawer is a NON-MODAL side panel — the preview stays fully
          visible + interactive on the left while you chat (close via ×, Esc, or the AI badge). */}
      <aside
        className={`fixed right-0 top-0 z-[61] flex h-full w-[26rem] max-w-[92vw] flex-col border-l border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 shadow-2xl backdrop-blur-xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-label="AI Assistant"
      >
        <header className="flex items-center gap-2 border-b border-slate-200/70 dark:border-slate-700/70 px-4 py-3">
          <span className="sw-brand-gradient inline-flex h-7 w-7 items-center justify-center rounded-lg text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-800 dark:text-slate-100">AI Assistant</div>
            <StatusPill status={status} label={statusLabel} />
          </div>
          {sessionTokens > 0 && (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500" title="Total tokens used this session">
              {sessionTokens.toLocaleString()} tok
            </span>
          )}
          {messages.length > 0 && (
            <button type="button" aria-label="New chat" title="New chat" className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" onClick={newChat}>
              <SquarePen className="h-4 w-4" />
            </button>
          )}
          <button type="button" aria-label="Close" className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        {needConsent ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">Choose what the assistant may do on this site. You can change this anytime.</p>
            <div className="flex flex-col gap-2">
              {CONSENT_CAPS.map(({ cap, label, hint }) => (
                <label key={cap} className="flex items-start gap-2.5 rounded-xl border border-white/60 dark:border-white/10 bg-white/60 dark:bg-slate-900/60 p-2.5">
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
                    <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
                    <span className="block text-xs text-slate-400 dark:text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <button type="button" className={primaryButton} onClick={approve}>
              Approve &amp; start
            </button>
            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="mt-6 text-center text-sm text-slate-400 dark:text-slate-500">
                  Ask me to change this page — e.g. “make the headline shorter” or “add a contact section”.
                </p>
              )}
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            </div>
            <div className="border-t border-slate-200/70 dark:border-slate-700/70 p-3">
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((a, i) => (
                    <span key={i} className="relative inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/70 p-1 pr-5 text-xs text-slate-600 dark:text-slate-300">
                      {a.previewUrl ? (
                        <img src={a.previewUrl} alt={a.name ?? ''} className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-slate-500">
                          <FileText className="h-4 w-4" />
                        </span>
                      )}
                      <span className="max-w-[7rem] truncate">{a.name ?? a.mimeType}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${a.name ?? 'attachment'}`}
                        className="absolute right-0.5 top-0.5 rounded p-0.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-600 dark:hover:text-slate-300"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={ACCEPT_MIME.join(',')}
                  multiple
                  onChange={(e) => {
                    if (e.target.files?.length) void addFiles(e.target.files);
                    e.target.value = ''; // allow re-selecting the same file
                  }}
                />
                <button
                  type="button"
                  aria-label="Attach an image or PDF"
                  title="Attach an image or PDF"
                  className={`${ghostButton} px-2.5`}
                  onClick={() => fileRef.current?.click()}
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  ref={taRef}
                  className={`${glassInput} max-h-[50vh] min-h-[2.5rem] flex-1 resize-none overflow-y-auto`}
                  aria-label="Message the assistant"
                  placeholder="Ask the assistant to edit this page…"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(e) => {
                    // Paste image data straight from the clipboard (screenshots, copied images).
                    const files = Array.from(e.clipboardData.items)
                      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
                      .map((it) => it.getAsFile())
                      .filter((f): f is File => f !== null);
                    if (files.length) {
                      e.preventDefault();
                      void addFiles(files);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {status === 'idle' ? (
                  <button type="button" aria-label="Send" className={`${primaryButton} px-3`} onClick={() => void send()} disabled={!input.trim() && attachments.length === 0}>
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
  // During activity the indicator is a prominent, pulsing pill so it's obvious the agent is busy.
  if (status === 'working')
    return (
      <span className="relative inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300">
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {label}
      </span>
    );
  if (status === 'thinking')
    return (
      <span className="inline-flex animate-pulse items-center gap-1.5 rounded-full bg-indigo-100 dark:bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-300">
        <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        {label}
      </span>
    );
  return <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{label}</span>;
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user')
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {msg.attachments.map((a, i) =>
              a.previewUrl ? (
                <img key={i} src={a.previewUrl} alt={a.name ?? ''} className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-white/10" />
              ) : (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-white/10 px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
                  <FileText className="h-3.5 w-3.5" /> {a.name ?? 'document'}
                </span>
              ),
            )}
          </div>
        )}
        {msg.text && <div className="rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white shadow-sm">{msg.text}</div>}
      </div>
    );
  return (
    <div className="self-start rounded-2xl rounded-bl-sm border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 shadow-sm">
      {msg.tools.length > 0 && (
        <ul className="mb-1.5 flex flex-col gap-1">
          {msg.tools.map((t, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {t.ok === undefined ? (
                  <Wrench className="h-3.5 w-3.5 animate-pulse text-amber-500" />
                ) : t.ok ? (
                  <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <CircleX className="h-3.5 w-3.5 text-rose-500" />
                )}
                {toolLabel(t.name)}
              </span>
              {/* On a failure, show WHY (e.g. a validation error) so the user isn't left with a bare ✗. */}
              {t.ok === false && t.summary && (
                <span className="ml-5 whitespace-pre-wrap break-words text-[11px] leading-snug text-rose-600 dark:text-rose-400">{t.summary}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg.text ? <ChatMarkdown text={msg.text} /> : msg.streaming ? <span className="text-slate-400 dark:text-slate-500">…</span> : null}
      {msg.tokens != null && msg.tokens > 0 && !msg.streaming && (
        <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{msg.tokens.toLocaleString()} tokens</div>
      )}
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
