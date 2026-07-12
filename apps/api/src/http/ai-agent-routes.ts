import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';
import type { AiUsageRepository } from '../repo/ai-usage.js';
import type { AgentProvider, AgentMessage } from '../ai/agent-provider.js';
import { runAgentLoop } from '../ai/agent-loop.js';
import { McpToolBridge } from '../ai/tool-bridge.js';
import { mintAgentToken, revokeAgentToken, clearAgentTokenActive } from '../ai/agent-token.js';
import { runCloneOrchestration, type ClonePageTask, type CloneGateResult } from '../ai/clone-orchestrator.js';
import type { AgentGrantsRepository } from '../repo/agent-grants.js';

/** First instant of the current UTC month — the basis for monthly token quotas. */
function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Capabilities an on-page agent may ever hold (never `deploy` — there is no deploy tool). */
const AGENT_MAX_CAPS: readonly ApiKeyCapability[] = ['content:read', 'content:write', 'content:delete', 'publish'];
/** Tools never offered to the agent regardless of capability. Empty now that media deletes are
 *  recoverable (soft-delete → 90-day Recycle Bin), so `delete_media` is safe behind `content:delete`. */
const WITHHELD_TOOLS = new Set<string>();
/** Scoped token lifetime — comfortably longer than any single loop, revoked at the end. */
const AGENT_TOKEN_TTL_MS = 15 * 60_000;
// A full landing page built incrementally (get_page + put_page per section, plus previews) can take
// dozens of tool-use turns, so give the loop generous headroom before it hands back for a "continue".
const MAX_ITERATIONS = 60;
/**
 * Default per-turn output-token ceiling. 8192 comfortably holds a full page's HTML in one `put_page`
 * call (the old 4096 truncated large edits mid-call, so they silently did nothing). Operators can
 * raise it per-instance or per-project up to their model's real limit via `maxOutputTokens`.
 */
export const DEFAULT_AGENT_MAX_OUTPUT_TOKENS = 8192;
/** Idle conversations are dropped from the in-memory store after this long. */
const CONVERSATION_TTL_MS = 30 * 60_000;
/** A whole-site clone authors many pages across many turns — give its scoped token a long lease (revoked
 *  at the end regardless). */
const CLONE_TOKEN_TTL_MS = 2 * 60 * 60_000;
/** Author→gate→fix rounds per page before the orchestrator moves on (bounds runaway cost per page). */
const CLONE_MAX_ROUNDS = 4;

const CapabilityEnum = z.enum(['content:read', 'content:write', 'content:delete', 'publish']);

/** Allowed attachment MIME types — raster images (both providers) + PDF (Anthropic only). */
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** ~7.5 MB of raw bytes per attachment (base64 is ~1.34×); the route bodyLimit bounds the whole request. */
const MAX_ATTACHMENT_B64 = 10_000_000;

const AttachmentSchema = z
  .object({
    kind: z.enum(['image', 'document']),
    mimeType: z.string().min(1).max(100),
    data: z.string().min(1).max(MAX_ATTACHMENT_B64),
    name: z.string().max(255).optional(),
  })
  // kind ⇔ mime must agree, and only the allowlisted types are accepted (no arbitrary bytes to the model).
  .refine(
    (a) => (a.kind === 'image' ? (IMAGE_MIME as readonly string[]).includes(a.mimeType) : a.mimeType === 'application/pdf'),
    'unsupported attachment type',
  );

const MessageBody = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  // A message may be attachment-only, so allow empty text when attachments are present (checked below).
  message: z.string().max(8000),
  attachments: z.array(AttachmentSchema).max(6).optional(),
  context: z
    .object({
      pageId: z.string().max(200).optional(),
      path: z.string().max(400).optional(),
      selection: z.string().max(2000).optional(),
    })
    .optional(),
});

const GrantBody = z.object({
  capabilities: z.array(CapabilityEnum),
  autonomy: z.enum(['full', 'ask']).default('full'),
});

/** The effective assistant for one project: the provider + the caps that govern its usage. */
export interface ResolvedAgent {
  provider: AgentProvider;
  /** Effective per-project monthly token cap (undefined/0 = unlimited). */
  projectMonthlyTokens?: number;
  /** Per-turn output-token ceiling for this project's model (undefined → DEFAULT_AGENT_MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
  /** Whether platform admins bypass all caps under this config. */
  adminsUnlimited: boolean;
  /** true = the platform's key (the org + per-user caps apply); false = a project's OWN key (BYO —
   *  only its own per-project cap applies, never the platform budget). */
  platformFunded: boolean;
}

export interface AiAgentRoutesDeps {
  db: Database;
  /** Resolves the effective assistant for a project (per-project BYO → instance → env), or null when
   *  the assistant is not configured for this project. */
  resolveAgent: (ctx: ProjectContext) => Promise<ResolvedAgent | null>;
  agentGrants: AgentGrantsRepository;
  aiUsageRepo: AiUsageRepository;
  /** Platform + per-user monthly caps (from env). The per-project cap comes from the resolved agent. */
  aiQuota: { orgMonthlyTokens?: number; userMonthlyTokens?: number };
  resolveProject: (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext }>;
  isWriter: (ctx: ProjectContext) => boolean;
  isAdmin: (userId: string) => Promise<boolean>;
  getAgentInstructions: () => Promise<string>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  /** Optional clone-orchestration hooks (app.ts supplies them — they need contentRepo + the render/gate
   *  functions). When present, the owner-only `POST /projects/:id/ai-clone` route is registered. */
  cloneOrchestration?: {
    /** The imported pages that still need authoring, in a sensible order (home first). */
    listPages: (ctx: ProjectContext) => Promise<ClonePageTask[]>;
    /** The AUTHORITATIVE per-page gate — re-renders + re-reads server-side, ignoring the agent's claim.
     *  `token` is the scoped agent token (so it can reuse the audit routes); returns the combined verdict. */
    runGate: (token: string, ctx: ProjectContext, pageId: string) => Promise<CloneGateResult>;
  };
}

interface Conversation {
  userId: string;
  projectId: string;
  messages: AgentMessage[];
  updatedAt: number;
  busy: boolean;
}

/**
 * The on-page AI assistant's streaming chat endpoint. The browser calls it with the
 * session cookie (never a token); the server reads the requested capabilities, mints a
 * SHORT-LIVED scoped `swk_` token internally, and runs the agent loop — so all tool
 * calls land through the gated MCP path as `actor:'agent'` writes (which auto-reload any
 * open preview). Streams provider-neutral status over SSE. The token never leaves the server.
 */
export function registerAiAgentRoutes(app: FastifyInstance, deps: AiAgentRoutesDeps): void {
  const conversations = new Map<string, Conversation>();

  const sweep = (): void => {
    const cutoff = Date.now() - CONVERSATION_TTL_MS;
    for (const [id, c] of conversations) if (!c.busy && c.updatedAt < cutoff) conversations.delete(id);
  };

  /**
   * Month-to-date token usage vs the configured caps. `userIsAdmin` + `since` are hoisted by the
   * caller (they don't change within a request), so a 25-turn loop doesn't re-query the platform role
   * or recompute the month window on every turn.
   */
  const overQuota = async (
    ctx: ProjectContext,
    userIsAdmin: boolean,
    since: Date,
    resolved: ResolvedAgent,
  ): Promise<'platform' | 'user' | 'project' | null> => {
    if (userIsAdmin && resolved.adminsUnlimited) return null;
    // The platform org/user budget applies only to the platform-funded key — a project's own BYO key
    // is metered solely against its own per-project cap.
    if (resolved.platformFunded) {
      if (deps.aiQuota.orgMonthlyTokens && (await deps.aiUsageRepo.tokensSince(since)) >= deps.aiQuota.orgMonthlyTokens) return 'platform';
      if (deps.aiQuota.userMonthlyTokens && (await deps.aiUsageRepo.tokensSince(since, ctx.userId)) >= deps.aiQuota.userMonthlyTokens) return 'user';
    }
    if (resolved.projectMonthlyTokens && (await deps.aiUsageRepo.tokensSince(since, undefined, ctx.projectId)) >= resolved.projectMonthlyTokens) return 'project';
    return null;
  };

  // First-connect CONSENT: the capabilities the user has granted the assistant on this project.
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/agent/grant', { config: deps.rl(30) }, async (req, reply) => {
    const { ctx } = await deps.resolveProject(req, 'session-only');
    if (!deps.isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const grant = await deps.agentGrants.get(ctx.userId, ctx.projectId);
    // Default = full autonomy (all caps pre-checked in the consent panel) until the user narrows it.
    return reply.send({ configured: grant !== null, capabilities: grant?.capabilities ?? AGENT_MAX_CAPS, autonomy: grant?.autonomy ?? 'full' });
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/agent/grant', { config: deps.rl(30) }, async (req, reply) => {
    const { ctx } = await deps.resolveProject(req, 'session-only');
    if (!deps.isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const body = GrantBody.parse(req.body);
    // Clamp to what an agent may ever hold (never deploy); content:read is always implied.
    const granted = body.capabilities as ApiKeyCapability[];
    const capabilities = AGENT_MAX_CAPS.filter((c) => granted.includes(c));
    if (!capabilities.includes('content:read')) capabilities.unshift('content:read');
    const saved = await deps.agentGrants.upsert(ctx.userId, ctx.projectId, { capabilities, autonomy: body.autonomy });
    return reply.send({ configured: true, ...saved });
  });

  // Whether the assistant is available on this project — gates the preview "AI" button.
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/agent/status', { config: deps.rl(60) }, async (req, reply) => {
    const { ctx } = await deps.resolveProject(req, 'session-only');
    const resolved = deps.isWriter(ctx) ? await deps.resolveAgent(ctx) : null;
    return reply.send({ enabled: resolved !== null });
  });

  // A higher bodyLimit than the app default: attachments (base64 images/PDFs) make this request large.
  // 6 × ~7.5 MB attachments + overhead → 60 MB ceiling.
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/agent/messages', { config: deps.rl(20), bodyLimit: 60 * 1024 * 1024 }, async (req, reply) => {
    // --- Preflight (JSON errors) BEFORE hijacking the socket ---
    const { ctx } = await deps.resolveProject(req, 'session-only');
    if (!deps.isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const resolved = await deps.resolveAgent(ctx);
    if (!resolved) return reply.code(501).send({ error: 'AI assistant is not configured' });
    const body = MessageBody.parse(req.body);
    // A turn needs SOMETHING — text or at least one attachment.
    if (body.message.trim() === '' && !body.attachments?.length) {
      return reply.code(400).send({ error: 'a message or an attachment is required' });
    }

    // Hoisted for the whole request (admin status + month window don't change mid-loop).
    const userIsAdmin = await deps.isAdmin(ctx.userId);
    const since = startOfMonthUTC(new Date());
    const over = await overQuota(ctx, userIsAdmin, since, resolved);
    if (over) return reply.code(429).send({ error: `AI ${over} quota exhausted for this month` });

    // Capabilities come from the stored consent grant — the user chose them on first connect. No grant
    // yet → FULL autonomy by default (a deliberate product choice: the consent panel pre-checks all and
    // lets the user NARROW it). Not an escalation: the caller is already a session writer who holds all
    // of these caps directly, and `deploy` is never included. The editor always PUTs a grant via the
    // consent panel before the first message, so the no-grant default only applies to direct API use.
    const grant = await deps.agentGrants.get(ctx.userId, ctx.projectId);
    const requested = (grant?.capabilities ?? AGENT_MAX_CAPS) as ApiKeyCapability[];
    const capabilities = AGENT_MAX_CAPS.filter((c) => requested.includes(c));
    if (!capabilities.includes('content:read')) capabilities.unshift('content:read');

    sweep();
    const conversationId = body.conversationId ?? randomUUID();
    const existing = conversations.get(conversationId);
    // A conversation is bound to the user + project that created it — never replay another user's
    // (or another project's) history. 404 (not 403) so a guessed id can't be confirmed to exist.
    if (existing && (existing.userId !== ctx.userId || existing.projectId !== ctx.projectId)) {
      return reply.code(404).send({ error: 'conversation not found' });
    }
    const convo: Conversation = existing ?? {
      userId: ctx.userId,
      projectId: ctx.projectId,
      messages: [],
      updatedAt: Date.now(),
      busy: false,
    };
    if (convo.busy) return reply.code(409).send({ error: 'this conversation is already processing a message' });
    convo.busy = true;
    conversations.set(conversationId, convo);

    const provider = resolved.provider;
    const instructions = await deps.getAgentInstructions();
    const system = `${instructions}\n\n${pageContext(body.context)}`;
    // Seed a LOCAL copy — don't mutate the stored history until the turn completes, so a failed
    // mint/tool-load (502) doesn't leave a dangling user message that would double up on retry.
    // Attachments (images / PDFs) ride on the user turn so the model can SEE them.
    const seed: AgentMessage[] = [
      ...convo.messages,
      { role: 'user', content: body.message, ...(body.attachments?.length ? { attachments: body.attachments } : {}) },
    ];

    // --- Mint the scoped token, build the tool bridge, then stream ---
    const abort = new AbortController();
    let minted: { token: string; keyId: string } | undefined;
    let bridge: McpToolBridge;
    let tools;
    try {
      minted = await mintAgentToken(deps.db, {
        projectId: ctx.projectId,
        userId: ctx.userId,
        role: ctx.role === 'owner' ? 'owner' : 'member',
        capabilities,
        ttlMs: AGENT_TOKEN_TTL_MS,
      });
      bridge = new McpToolBridge(app, minted.token);
      tools = await bridge.listTools(new Set(capabilities), WITHHELD_TOOLS);
    } catch {
      if (minted) {
        clearAgentTokenActive(minted.token);
        await revokeAgentToken(deps.db, minted.keyId).catch(() => {});
      }
      convo.busy = false;
      return reply.code(502).send({ error: 'failed to start the assistant' });
    }
    const agentKeyId = minted.keyId;
    const agentToken = minted.token;

    reply.hijack();
    const raw = reply.raw;
    // (A long agentic build can stream for minutes; Node/Fastify apply no default socket idle timeout,
    //  and the 15s heartbeat below keeps intermediaries from dropping the connection.)
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      // The hijack bypasses the security-headers hook — replicate the essentials.
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'x-frame-options': 'DENY',
    });
    const send = (event: string, data: unknown): void => {
      if (raw.writable) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // Heartbeat every 15s keeps intermediaries from dropping an idle connection; it also DETECTS a
    // dead client (write fails / socket gone) and aborts the loop, so the agent doesn't keep burning
    // tokens + editing after the user has navigated away or the connection stalled.
    const heartbeat = setInterval(() => {
      if (raw.writable && !raw.destroyed) raw.write(': ping\n\n');
      else abort.abort();
    }, 15_000);
    req.raw.on('close', () => abort.abort());

    send('start', { conversationId, model: provider.model });

    const meter = async (usage: { inputTokens: number; outputTokens: number }): Promise<void> => {
      await deps.aiUsageRepo.record(ctx.userId, ctx.projectId, provider.model, usage);
      send('usage', {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        projectMonthToDate: await deps.aiUsageRepo.tokensSince(since, undefined, ctx.projectId),
      });
      const over2 = await overQuota(ctx, userIsAdmin, since, resolved);
      if (over2) throw new Error(`AI ${over2} quota exhausted for this month`);
    };

    try {
      const result = await drain(
        runAgentLoop({
          provider,
          bridge,
          system,
          tools,
          messages: seed,
          maxIterations: MAX_ITERATIONS,
          maxTokens: resolved.maxOutputTokens ?? DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
          signal: abort.signal,
          onUsage: meter,
        }),
        (ev) => {
          if (ev.type === 'usage') return; // already sent inside meter
          send(ev.type, ev);
        },
      );
      convo.messages = result.messages;
    } catch (err) {
      send('error', { code: 'provider', message: err instanceof Error ? err.message : 'agent error' });
    } finally {
      clearInterval(heartbeat);
      convo.busy = false;
      convo.updatedAt = Date.now();
      clearAgentTokenActive(agentToken);
      await revokeAgentToken(deps.db, agentKeyId).catch(() => {});
      if (raw.writable) raw.end();
    }
  });

  // ── The autonomous CLONE ORCHESTRATOR (owner-initiated). Authors EVERY imported page to the acceptance
  // gate automatically: import → author → AUTHORITATIVE gate (vision diff vs the live original + structure/
  // behaviour + an anti-lie marker check on the stored source) → feed defects back → iterate until green.
  // Streams per-page progress over SSE. Only registered when app.ts wires the clone hooks (contentRepo +
  // the render/gate functions live there). This is the missing automation layer the tools always lacked.
  if (deps.cloneOrchestration) {
    const clone = deps.cloneOrchestration;
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/ai-clone', { config: deps.rl(3) }, async (req, reply) => {
      const { ctx } = await deps.resolveProject(req, 'session-only');
      if (!deps.isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const resolved = await deps.resolveAgent(ctx);
      if (!resolved) return reply.code(501).send({ error: 'AI assistant is not configured' });
      const userIsAdmin = await deps.isAdmin(ctx.userId);
      const since = startOfMonthUTC(new Date());
      if (await overQuota(ctx, userIsAdmin, since, resolved)) return reply.code(429).send({ error: 'AI quota exhausted for this month' });
      const pages = await clone.listPages(ctx);
      if (pages.length === 0) return reply.code(400).send({ error: 'no imported pages to author — import a site with ?foundation=1 first' });

      // An owner-run whole-site clone gets the full (non-deploy) capability set: it authors, deletes junk
      // datasets/media, and publishes. Same gated MCP path as the on-page assistant (actor:'agent').
      const capabilities = [...AGENT_MAX_CAPS];
      const abort = new AbortController();
      let minted: { token: string; keyId: string } | undefined;
      let bridge: McpToolBridge;
      let tools;
      try {
        minted = await mintAgentToken(deps.db, {
          projectId: ctx.projectId,
          userId: ctx.userId,
          role: ctx.role === 'owner' ? 'owner' : 'member',
          capabilities,
          ttlMs: CLONE_TOKEN_TTL_MS,
        });
        bridge = new McpToolBridge(app, minted.token);
        tools = await bridge.listTools(new Set(capabilities), WITHHELD_TOOLS);
      } catch {
        if (minted) {
          clearAgentTokenActive(minted.token);
          await revokeAgentToken(deps.db, minted.keyId).catch(() => {});
        }
        return reply.code(502).send({ error: 'failed to start the clone' });
      }
      const cloneToken = minted.token;
      const cloneKeyId = minted.keyId;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'x-frame-options': 'DENY',
      });
      const send = (event: string, data: unknown): void => {
        if (raw.writable) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const heartbeat = setInterval(() => {
        if (raw.writable && !raw.destroyed) raw.write(': ping\n\n');
        else abort.abort();
      }, 15_000);
      req.raw.on('close', () => abort.abort());
      send('start', { model: resolved.provider.model, pages: pages.length });

      const meter = async (usage: { inputTokens: number; outputTokens: number }): Promise<void> => {
        await deps.aiUsageRepo.record(ctx.userId, ctx.projectId, resolved.provider.model, usage);
        if (await overQuota(ctx, userIsAdmin, since, resolved)) throw new Error('AI quota exhausted for this month');
      };
      const system = await deps.getAgentInstructions();
      try {
        const gen = runCloneOrchestration({
          provider: resolved.provider,
          bridge,
          system,
          tools,
          pages,
          runGate: (pageId) => clone.runGate(cloneToken, ctx, pageId),
          maxIterations: MAX_ITERATIONS,
          maxTokens: resolved.maxOutputTokens ?? DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
          maxRounds: CLONE_MAX_ROUNDS,
          signal: abort.signal,
          onUsage: meter,
        });
        let next = await gen.next();
        while (!next.done) {
          send(next.value.type, next.value);
          next = await gen.next();
        }
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'clone error' });
      } finally {
        clearInterval(heartbeat);
        clearAgentTokenActive(cloneToken);
        await revokeAgentToken(deps.db, cloneKeyId).catch(() => {});
        if (raw.writable) raw.end();
      }
    });
  }
}

/** Consume the loop generator, forwarding each event, and return its final result. */
async function drain<T, R>(gen: AsyncGenerator<T, R>, onEvent: (ev: T) => void): Promise<R> {
  let next = await gen.next();
  while (!next.done) {
    onEvent(next.value);
    next = await gen.next();
  }
  return next.value;
}

function pageContext(context?: { pageId?: string; path?: string; selection?: string }): string {
  if (!context || (!context.pageId && !context.path)) {
    return 'The user is viewing the site preview. Ask which page to edit if it is unclear; resolve page names with list_content("page").';
  }
  // Strip newlines — these are client-supplied and go verbatim into the system prompt; a CRLF could
  // otherwise inject fake instruction lines.
  const clean = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();
  const parts = [
    'The user is currently viewing this page in the live preview:',
    context.path ? `- path: ${clean(context.path)}` : '',
    context.pageId ? `- page id: ${clean(context.pageId)}` : '',
    context.selection ? `- the user highlighted: "${clean(context.selection).slice(0, 500)}"` : '',
    'When they say "this page" they mean the one above. Resolve other page names with list_content("page").',
  ];
  return parts.filter(Boolean).join('\n');
}
