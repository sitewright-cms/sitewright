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
import { mintAgentToken, revokeAgentToken } from '../ai/agent-token.js';

/** First instant of the current UTC month — the basis for monthly token quotas. */
function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Capabilities an on-page agent may ever hold (never `deploy` — there is no deploy tool). */
const AGENT_MAX_CAPS: ApiKeyCapability[] = ['content:read', 'content:write', 'content:delete', 'publish'];
/** Not yet recoverable (no media tombstone until the recycle bin ships) → keep it out of the agent's hands. */
const WITHHELD_TOOLS = new Set(['delete_media']);
/** Scoped token lifetime — comfortably longer than any single loop, revoked at the end. */
const AGENT_TOKEN_TTL_MS = 15 * 60_000;
const MAX_ITERATIONS = 25;
/** Idle conversations are dropped from the in-memory store after this long. */
const CONVERSATION_TTL_MS = 30 * 60_000;

const MessageBody = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  message: z.string().min(1).max(8000),
  capabilities: z.array(z.enum(['content:read', 'content:write', 'content:delete', 'publish'])).optional(),
  context: z
    .object({
      pageId: z.string().max(200).optional(),
      path: z.string().max(400).optional(),
      selection: z.string().max(2000).optional(),
    })
    .optional(),
});

/** The effective assistant for one project: the provider + the caps that govern its usage. */
export interface ResolvedAgent {
  provider: AgentProvider;
  /** Effective per-project monthly token cap (undefined/0 = unlimited). */
  projectMonthlyTokens?: number;
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

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/agent/messages', { config: deps.rl(20) }, async (req, reply) => {
    // --- Preflight (JSON errors) BEFORE hijacking the socket ---
    const { ctx } = await deps.resolveProject(req, 'session-only');
    if (!deps.isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const resolved = await deps.resolveAgent(ctx);
    if (!resolved) return reply.code(501).send({ error: 'AI assistant is not configured' });
    const body = MessageBody.parse(req.body);

    // Hoisted for the whole request (admin status + month window don't change mid-loop).
    const userIsAdmin = await deps.isAdmin(ctx.userId);
    const since = startOfMonthUTC(new Date());
    const over = await overQuota(ctx, userIsAdmin, since, resolved);
    if (over) return reply.code(429).send({ error: `AI ${over} quota exhausted for this month` });

    const requested = (body.capabilities ?? ['content:read', 'content:write', 'publish']) as ApiKeyCapability[];
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
    const seed: AgentMessage[] = [...convo.messages, { role: 'user', content: body.message }];

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
      if (minted) await revokeAgentToken(deps.db, minted.keyId).catch(() => {});
      convo.busy = false;
      return reply.code(502).send({ error: 'failed to start the assistant' });
    }
    const agentKeyId = minted.keyId;

    reply.hijack();
    const raw = reply.raw;
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
    const heartbeat = setInterval(() => {
      if (raw.writable) raw.write(': ping\n\n');
    }, 25_000);
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
      await revokeAgentToken(deps.db, agentKeyId).catch(() => {});
      if (raw.writable) raw.end();
    }
  });
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
