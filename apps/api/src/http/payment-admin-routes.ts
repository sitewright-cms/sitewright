import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  PaymentGatewayInputSchema,
  PaymentBindingInputSchema,
  PaymentModeSchema,
  FulfilmentStateSchema,
  GatewayIdSchema,
  toPublicGateway,
  bindingKeysStatus,
  fromMinorUnits,
  type PaymentGatewayStored,
  type PaymentMode,
  type Shop,
} from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { GatewayRepository } from '../payments/gateways.js';
import type { ShopTransactionRepository } from '../repo/shop-transactions.js';
import type { ShopStockRepository } from '../repo/shop-stock.js';
import { BUILTIN_GATEWAYS, isBuiltinGateway } from '../payments/builtin-gateways.js';
import { checkoutReadiness } from '../payments/readiness.js';
import { createCheckoutSession, refundPayment, GatewayError, type ExecutorIo } from '../payments/executor.js';
import type { InterpolationScope } from '../payments/interpolate.js';
import type { ApiKeyCapability } from '../db/schema.js';

/**
 * GATEWAY ADMINISTRATION — level 1 (instance-wide definitions) and level 2 (a project's own keys).
 *
 * ★ The two levels have deliberately different gates, and the asymmetry is the point:
 *
 *  - **Level 1 is instance-admin only.** A gateway definition affects every project on the box, so
 *    `requireInstanceAdmin` (which is session-only — a bearer token is never an instance admin)
 *    guards every write. An AGENT reaches it through one explicitly-granted capability,
 *    `payments:provider:write`, which is never implied by `content:write`.
 *
 *  - **Level 2 is SESSION-ONLY, with no bearer path at all** — not even `content:write`, which the
 *    sibling `project_smtp` routes do accept. An agent that can mint a live Stripe key into a project
 *    can redirect that project's revenue, and no agent task is worth that. A human with the project's
 *    writer role sets payment credentials, in a browser.
 */

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface PaymentAdminDeps {
  gateways: GatewayRepository;
  transactions: ShopTransactionRepository;
  /** Only used to put units back when an operator says a refunded order's goods are sellable. */
  stock: ShopStockRepository;
  /** Throws unless the caller is an instance admin on an interactive session. */
  requireInstanceAdmin: (req: FastifyRequest) => Promise<string>;
  /** True when the caller holds `payments:provider:write` on a bearer token. */
  hasProviderWriteScope: (req: FastifyRequest) => Promise<boolean>;
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  /** Absolute base for the webhook URL an operator pastes into the provider's dashboard. */
  publicBaseUrl: () => string;
  /** The project's shop settings — which checkout channels charge through which gateway. */
  getShop: (projectId: string) => Promise<Shop | null>;
  /** How many projects, instance-wide, hold keys for a gateway id ({@link projectsHoldingKeys}). */
  projectsHoldingKeys: (gatewayId: string) => Promise<number>;
  io: ExecutorIo;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/**
 * Body of a refund request.
 *
 * `amountMinor` absent means "everything still outstanding". `restock` is explicit and defaults to
 * FALSE: the platform must never silently invent inventory, and only the operator knows whether the
 * goods came back in a state anyone can sell.
 */
const RefundBodySchema = z.object({
  amountMinor: z.number().int().min(1).max(100_000_000).optional(),
  restock: z.boolean().optional(),
});

/** Payment statuses an order has been paid in — the only ones a token may move fulfilment on. */
const PAID_STATUSES: ReadonlySet<string> = new Set(['paid', 'partially_refunded', 'refunded']);

/** The shipped name and addresses of a built-in gateway id, for comparing a definition against. */
function shippedOf(id: string): { shipped: { name: string; apiBase: PaymentGatewayStored['apiBase']; allowedOrigins: string[] } } | Record<string, never> {
  const b = BUILTIN_GATEWAYS.find((g) => g.id === id);
  return b ? { shipped: { name: b.name, apiBase: b.apiBase, allowedOrigins: b.allowedOrigins } } : {};
}

/** What {@link registerPaymentAdminRoutes}' author check returns for a bearer token rather than a person. */
const AGENT_AUTHOR = 'agent';

/** Body of a fork request. */
const ForkBodySchema = z.object({ id: GatewayIdSchema, name: z.string().min(1).max(120).optional() });
/**
 * Body of a dry run: which mode to prove, a nominal amount, and which gateway.
 *
 * ★★ There is deliberately NO `projectId` here. It used to be a body field, and the handler built a
 * synthetic `{ userId: 'system', role: 'owner' }` context from it — so any caller who passed the
 * level-1 gate could name ANY project and have the server decrypt that project's stored secret and
 * spend it against the real provider. The project is now a ROUTE param resolved through the ordinary
 * membership check, which is the only thing that ties the credentials used to the caller entitled
 * to use them.
 */
const VerifyBodySchema = z.object({
  mode: PaymentModeSchema.default('test'),
  /** Minor units to attempt. Small by default — a dry run should not look like a real order. */
  amountMinor: z.number().int().min(1).max(1_000_000).default(100),
  currency: z.string().length(3).default('EUR'),
  /** Which gateway definition this run is proving. Must match what the project is bound to. */
  gatewayId: GatewayIdSchema,
});

export function registerPaymentAdminRoutes(app: FastifyInstance, deps: PaymentAdminDeps): void {
  const { gateways, requireInstanceAdmin, hasProviderWriteScope, resolveProject, isWriter, io, rl, transactions, stock } = deps;

  /**
   * Authorises a LEVEL 1 write.
   *
   * Either an instance admin on a session, or a bearer token carrying
   * `payments:provider:write` — the capability that makes "an agent adds a payment provider" work.
   * ★ Deliberately NOT `content:write`: that capability is handed out routinely, and gateway
   * definitions are instance-wide infrastructure.
   */
  async function requireGatewayAuthor(req: FastifyRequest): Promise<string> {
    if (await hasProviderWriteScope(req)) return AGENT_AUTHOR;
    return requireInstanceAdmin(req);
  }

  /**
   * Why an AGENT may not make this change to a definition, or null when it may.
   *
   * ★ Two rules, both about a bearer token that may be acting on injected instructions. A person on a
   * session is held to neither — they are the approver the proof step exists for.
   *
   *  1. A LIVE gateway — enabled and proven — is off-limits. Any write un-proves it (`put` clears
   *     `verified`), so one edit stops live checkout in every project on the instance that charges
   *     through it, and a delete does the same with no way back. An agent forks instead: the copy
   *     carries no live traffic until a person proves it and projects are switched over.
   *  2. Once ANY project holds keys for an id, the definition at that id is off-limits too — editing
   *     it, deleting it, and creating or forking one onto it after a delete (keys are filed under the
   *     id and outlive the definition). Not just its hosts: a definition decides what the provider is
   *     ASKED to do with the keys, and a body can hand a key to the provider inside a return or
   *     webhook URL that the provider then calls — so every field is a way out, and only "no keys
   *     yet" is safe to change. To iterate, a person removes the project's keys, or the agent forks.
   *
   * Not atomic with the write that follows: a project saving keys in the same instant is missed. The
   * window is one request's, not the provider call's, and the next agent write is refused again.
   */
  async function agentRefusal(author: string, gatewayId: string, change: 'edit' | 'create' | 'delete'): Promise<string | null> {
    if (author !== AGENT_AUTHOR) return null;
    const current = await gateways.byId(gatewayId);
    if (current?.gateway.enabled && current.gateway.verified) {
      return `"${gatewayId}" is live (enabled and proven), and an agent may not change a live payment provider — an edit would un-prove it and stop live checkout in every project that charges through it. Fork it (fork_gateway_definition), change the fork, and have a person prove it before projects switch over; or ask an instance admin.`;
    }
    const holding = await deps.projectsHoldingKeys(gatewayId);
    if (holding === 0) return null;
    const used = `${holding} project${holding === 1 ? ' holds' : 's hold'} keys for "${gatewayId}"`;
    if (change === 'edit') {
      return `${used}, so an agent may not change it — a definition decides where and how those keys are used. Ask the person to remove the keys (Settings → Website → Payments → Remove these keys) and change it then, or fork it to a new id.`;
    }
    if (change === 'delete') return `${used} — a person removes a payment provider that projects use.`;
    return `${used} under that id, so an agent may not create a definition there — it would decide where those keys go. Pick a new id.`;
  }


  // ---- level 1: the gateway definitions ----------------------------------------------------------

  app.get('/admin/payment-gateways', { config: rl(60) }, async (req, reply) => {
    await requireGatewayAuthor(req);
    const all = await gateways.list();
    return reply.send({
      gateways: all.map(({ gateway, builtin }) => ({
        ...gateway,
        builtin,
        // ★ For a built-in id, what the PLATFORM ships — never inferred from the stored record, which a
        // proof rewrites (`builtin:false`) and an override replaces. It is the one reference a person
        // checking a definition can trust, because no author wrote it.
        ...shippedOf(gateway.id),
        // Where the provider's dashboard should send events. Shown so an operator can copy it rather
        // than assemble it by hand and get it subtly wrong.
        webhookUrl: `${deps.publicBaseUrl().replace(/\/+$/, '')}/pay/<projectId>/webhook/${gateway.id}`,
      })),
    });
  });

  app.put<{ Params: { id: string } }>('/admin/payment-gateways/:id', { config: rl(30) }, async (req, reply) => {
    const userId = await requireGatewayAuthor(req);
    // ★ A built-in is READ-ONLY in place. It may be forked, which is what keeps an operator's fix
    // from being overwritten by the next upgrade — and keeps the shipped reference honest.
    if (isBuiltinGateway(req.params.id)) {
      return reply.code(409).send({ error: 'a built-in gateway cannot be edited — fork it first', forkable: true });
    }
    const input = PaymentGatewayInputSchema.parse({ ...(req.body as object), id: req.params.id });
    const refused = await agentRefusal(userId, req.params.id, (await gateways.byId(req.params.id)) ? 'edit' : 'create');
    if (refused) return reply.code(409).send({ error: refused, forkable: true });
    const saved = await gateways.put(input as PaymentGatewayStored, userId);
    // `verified` is cleared by `put`; say so, because an operator who just edited a live gateway needs
    // to know it has to be re-proven before it can take money again.
    return reply.send({ gateway: saved, mustReverify: true });
  });

  app.post<{ Params: { id: string } }>('/admin/payment-gateways/:id/fork', { config: rl(30) }, async (req, reply) => {
    const userId = await requireGatewayAuthor(req);
    const body = ForkBodySchema.parse(req.body ?? {});
    if ((await gateways.byId(body.id)) !== undefined) {
      return reply.code(409).send({ error: `a gateway with the id "${body.id}" already exists` });
    }
    const refused = await agentRefusal(userId, body.id, 'create');
    if (refused) return reply.code(409).send({ error: refused });
    const forked = await gateways.fork(req.params.id, body.id, userId);
    if (!forked) return reply.code(404).send({ error: 'gateway not found' });
    return reply.code(201).send({ gateway: body.name ? await gateways.put({ ...forked, name: body.name }, userId) : forked });
  });

  app.delete<{ Params: { id: string } }>('/admin/payment-gateways/:id', { config: rl(30) }, async (req, reply) => {
    const userId = await requireGatewayAuthor(req);
    const refused = await agentRefusal(userId, req.params.id, 'delete');
    if (refused) return reply.code(409).send({ error: refused });
    // Deleting a built-in's STORED OVERRIDE reverts to the shipped definition; the built-in itself
    // cannot be removed, so there is always a reference implementation to compare against.
    if (!isBuiltinGateway(req.params.id)) {
      // ★ Not while an order through it is still open, in any project. A buyer may be paying at the
      // provider right now; with the definition gone their webhook cannot be verified and the
      // reconciler cannot ask, so a PAID order would never be confirmed. The same rule as removing
      // one project's keys, held instance-wide because a definition is.
      const open = await transactions.countOpenForGateway(req.params.id);
      if (open > 0) {
        return reply.code(409).send({ error: `${open} order${open > 1 ? 's' : ''} through "${req.params.id}" ${open > 1 ? 'are' : 'is'} still open — keep the definition until ${open > 1 ? 'they are' : 'it is'} paid, expired or cancelled` });
      }
    }
    await gateways.remove(req.params.id, userId);
    return reply.code(204).send();
  });

  /**
   * THE DRY RUN — the only thing that can mark a gateway `verified`.
   *
   * ★ It performs a REAL test-mode checkout against the provider with the project's own credentials.
   * That is the whole point: a template can be syntactically perfect and still produce a request the
   * provider rejects, and the only way to know is to send one. A gateway that has not survived this
   * cannot take live money (see `resolveCredentials`).
   *
   * ★ It refuses to run in `live` mode. "Prove it works" must never mean "take a real payment", and
   * an operator clicking a verify button should not be able to charge anybody by accident.
   */
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/payment/verify', { config: rl(10) }, async (req, reply) => {
    // ★★ BOTH gates, and they check different things. `resolveProject` proves the caller may use THIS
    // project's stored credentials (session-only, membership-checked); `requireGatewayAuthor` proves
    // they may flip the instance-wide `verified` flag the run sets. Either one alone was a hole: a
    // project writer must not mark a definition proven for every tenant, and a gateway author must
    // not spend a tenant's secret. An agent bearer token cannot reach this at all — `session-only`
    // refuses it — which is right for a step whose real proof is an operator LOOKING at the
    // provider's own page.
    const { ctx, project } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const userId = await requireGatewayAuthor(req);
    const body = VerifyBodySchema.parse(req.body ?? {});
    if (body.mode !== 'test') {
      return reply.code(400).send({ error: 'a gateway is proven in test mode only — verifying in live mode would take a real payment' });
    }
    const rec = await gateways.byId(body.gatewayId);
    if (!rec) return reply.code(404).send({ error: 'gateway not found' });

    const resolved = await gateways.resolveCredentials(ctx, rec.gateway.id);
    if (!resolved.ok) {
      return reply.code(409).send({ error: 'the project has no usable credentials for this gateway', reason: resolved.reason, missing: resolved.missing });
    }
    if (resolved.mode !== 'test') {
      return reply.code(409).send({ error: 'the project must be in test mode to prove a gateway' });
    }

    const base = deps.publicBaseUrl().replace(/\/+$/, '');
    try {
      const session = await createCheckoutSession(rec.gateway, 'test', {
        cred: resolved.cred,
        amount: { minor: body.amountMinor, decimal: fromMinorUnits(body.amountMinor, body.currency), currency: body.currency.toUpperCase() },
        // Clearly-labelled placeholders: this is a probe, and anything that reaches the provider's
        // dashboard should say so rather than looking like a real order.
        txn: { id: 'sw-verify', publicToken: 'sw-verify', reference: 'sw-verify' },
        url: { return: `${base}/`, cancel: `${base}/`, webhook: `${base}/pay/${project.id}/webhook/${rec.gateway.id}` },
        field: {},
        text: { order_name: 'Sitewright gateway verification' },
      }, io);
      if (!(await gateways.markVerified(rec.gateway.id, userId === AGENT_AUTHOR ? 'system' : userId, rec.gateway))) {
        return reply.code(409).send({ verified: false, reason: 'changed', message: 'the definition changed while it was being proven — prove it again' });
      }
      return reply.send({
        verified: true,
        // Returned so an operator can open it and SEE the provider's own page — the proof that
        // matters is visual, not a 200 from this route.
        redirectUrl: session.redirectUrl,
      });
    } catch (err) {
      const kind = err instanceof GatewayError ? err.kind : 'upstream';
      app.log.warn({ gatewayId: rec.gateway.id, kind, errMsg: err instanceof Error ? err.message : 'unknown' }, 'gateway verification failed');
      // The provider's own refusal is the useful part, and it is safe here: this is an admin route,
      // and GatewayError messages never carry a URL or a response body.
      return reply.code(422).send({ verified: false, reason: kind, message: err instanceof Error ? err.message : 'the attempt failed' });
    }
  });

  // ---- level 2: one project's credentials ---------------------------------------------------------

  /**
   * What a project may read about the gateways available to it, and how ready its checkout is.
   *
   * Public metadata, plus — per gateway — whether the project's keys are there for each mode and
   * which mode it transacts in ({@link bindingKeysStatus}: key names and presence, never a value or
   * a mask). Reachable by an agent's `content:read`, because building a checkout that works needs
   * exactly this: which gateway ids exist, and what a person still has to enter.
   */
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/payment-gateways', { config: rl(60) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const [all, bindings, shop] = await Promise.all([gateways.list(), gateways.bindingsPublic(ctx), deps.getShop(ctx.projectId)]);
    const base = deps.publicBaseUrl().replace(/\/+$/, '');
    const bindingOf = new Map(bindings.map((b) => [b.gatewayId, b]));
    const readiness = all.map(({ gateway }) => {
      const binding = bindingOf.get(gateway.id);
      return { gateway, keys: binding ? bindingKeysStatus(binding, gateway.credentialFields) : null };
    });
    const checkout = (Array.isArray(shop?.channels) ? shop.channels : []).filter((c) => c?.kind === 'checkout');
    const { problems, notes } = checkoutReadiness(shop, readiness);
    return reply.send({
      // ★ Only ENABLED and VERIFIED gateways are offered. Letting a project bind an unproven one
      // would mean the first sign of an unfinished gateway is a buyer unable to pay.
      gateways: readiness
        .filter(({ gateway }) => gateway.enabled && gateway.verified)
        .map(({ gateway, keys }) => ({
          ...toPublicGateway(gateway),
          // The exact URL to paste into the provider's dashboard, assembled here rather than left for
          // an operator to build by hand and get subtly wrong.
          webhookUrl: `${base}/pay/${ctx.projectId}/webhook/${gateway.id}`,
          keys,
          // The checkout channels that charge through it.
          channels: checkout.filter((c) => c.gatewayId === gateway.id).map((c) => c.key),
        })),
      problems,
      notes,
    });
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/payment', { config: rl(60) }, async (req, reply) => {
    // ★ SESSION-ONLY. See the file header: an agent must not read or write payment credentials.
    const { ctx } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const base = deps.publicBaseUrl().replace(/\/+$/, '');
    // A project may hold credentials for several gateways — one per provider its checkout channels use.
    const bindings = (await gateways.bindingsPublic(ctx)).map((b) => ({
      ...b,
      webhookUrl: `${base}/pay/${ctx.projectId}/webhook/${b.gatewayId}`,
    }));
    const first = bindings[0];
    return reply.send({
      bindings,
      // The single-provider shape, kept for callers that predate several: the first binding.
      binding: first ?? null,
      ...(first ? { webhookUrl: first.webhookUrl } : {}),
    });
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/payment', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const input = PaymentBindingInputSchema.parse(req.body);
    const saved = await gateways.saveBinding(ctx, input);
    if (!saved.ok) return reply.code(400).send({ error: 'invalid credentials', details: saved.errors });
    return reply.send({ binding: saved.binding });
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/payment/mode', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const body = z.object({ mode: PaymentModeSchema, gatewayId: z.string().min(1).max(64).optional() }).parse(req.body);
    const { mode } = body;
    // Which provider to switch: named, or the only one the project has. With several, it must be named
    // — switching an unnamed one would be a guess about which provider takes real money.
    let gatewayId = body.gatewayId;
    if (!gatewayId) {
      const all = await gateways.bindings(ctx);
      if (all.length !== 1) return reply.code(400).send({ error: 'name the gateway to switch (gatewayId) — this project has several' });
      gatewayId = all[0]!.gatewayId;
    }
    const result = await gateways.setMode(ctx, gatewayId, mode);
    if (!result.ok) {
      // ★ Refused rather than allowed-and-broken: going live with no live key would make the first
      // symptom a real customer unable to pay.
      return reply.code(409).send({ error: `the ${mode} credentials are incomplete`, missing: result.missing });
    }
    return reply.send({ mode, gatewayId });
  });

  app.delete<{ Params: { projectId: string; gatewayId: string } }>('/projects/:projectId/payment/:gatewayId', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const parsedId = GatewayIdSchema.safeParse(req.params.gatewayId);
    if (!parsedId.success) return reply.code(404).send({ error: 'no credentials for that gateway' });
    const gatewayId = parsedId.data;
    // A checkout channel still charging through it would turn every order there into an error, so the
    // channel goes first.
    const users = ((await deps.getShop(ctx.projectId))?.channels ?? []).filter((c) => c.kind === 'checkout' && c.gatewayId === gatewayId);
    if (users.length > 0) {
      return reply.code(409).send({ error: `checkout channel${users.length > 1 ? 's' : ''} ${users.map((c) => `"${c.key}"`).join(', ')} still charge through "${gatewayId}" — remove or switch ${users.length > 1 ? 'them' : 'it'} first` });
    }
    // ★ And not while an order through it is still open. A buyer may be paying at the provider right
    // now: without the keys their webhook cannot be verified and the reconciler cannot ask, so a PAID
    // order would never be confirmed, its stock never committed and nobody mailed.
    const open = await transactions.countOpen(ctx.projectId, gatewayId);
    if (open > 0) {
      return reply.code(409).send({ error: `${open} order${open > 1 ? 's' : ''} through "${gatewayId}" ${open > 1 ? 'are' : 'is'} still open — keep the keys until ${open > 1 ? 'they are' : 'it is'} paid, expired or cancelled` });
    }
    if (!(await gateways.removeBinding(ctx, gatewayId))) return reply.code(404).send({ error: 'no credentials for that gateway' });
    return reply.code(204).send();
  });

  // ---- the transactions inbox --------------------------------------------------------------------

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/transactions', { config: rl(60) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const q = req.query as { limit?: string; offset?: string; status?: string };
    const page = await transactions.list(project.id, {
      ...(q.limit ? { limit: Number(q.limit) } : {}),
      ...(q.offset ? { offset: Number(q.offset) } : {}),
      ...(q.status ? { status: q.status as never } : {}),
    });
    return reply.send(page);
  });

  app.get<{ Params: { projectId: string; id: string } }>('/projects/:projectId/transactions/:id', { config: rl(60) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const row = await transactions.byId(project.id, req.params.id);
    if (!row) return reply.code(404).send({ error: 'transaction not found' });
    return reply.send({ transaction: row });
  });

  /**
   * How many orders are still owed a mail.
   *
   * ★ Emailing somebody about broken email is circular, so this has to surface somewhere they
   * already look. The two kinds are counted separately because they mean different things: a missed
   * notification is an order the shop has not seen; a missed receipt is a customer wondering where
   * their money went.
   */
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/transactions-undelivered', { config: rl(60) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    return reply.send(await transactions.undeliveredSummary(project.id));
  });

  /** Puts one mail back in the queue — what an operator clicks after fixing SMTP. */
  app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/transactions/:id/resend', { config: rl(30) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const { kind } = z.object({ kind: z.enum(['notify', 'receipt']) }).parse(req.body ?? {});
    if (ctx.actor === 'agent') {
      // ★ A token resends only a mail that did NOT arrive. A person may resend a delivered receipt on
      // purpose (the buyer lost it), from the inbox; an agent looping over orders would mail every
      // buyer twice — and a second order confirmation reads as a second charge.
      const row = await transactions.byId(project.id, req.params.id);
      if (!row) return reply.code(404).send({ error: 'transaction not found' });
      const state = kind === 'notify' ? row.notifyState : row.receiptState;
      if (state !== 'failed' && state !== 'abandoned') {
        return reply.code(409).send({ error: `this order's ${kind === 'notify' ? 'shop notification' : 'receipt'} is "${state}", not failed — a token resends only a mail that failed (a person can resend a delivered one from the Orders inbox)` });
      }
    }
    const queued = await transactions.requeueMail(project.id, req.params.id, kind);
    if (!queued) return reply.code(404).send({ error: 'transaction not found' });
    return reply.send({ queued: true, kind });
  });

  /** Moves the operator-owned fulfilment state. Refuses an illegal or backwards move. */
  app.patch<{ Params: { projectId: string; id: string } }>('/projects/:projectId/transactions/:id/fulfilment', { config: rl(60) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const body = z.object({ to: FulfilmentStateSchema, note: z.string().max(2000).optional() }).parse(req.body);
    if (ctx.actor === 'agent') {
      // A token moves fulfilment only on an order that was PAID. Marking an unpaid or failed order
      // "shipped" is how goods leave without the money having arrived.
      const row = await transactions.byId(project.id, req.params.id);
      if (!row) return reply.code(404).send({ error: 'transaction not found' });
      if (!PAID_STATUSES.has(row.status)) {
        return reply.code(409).send({ error: `this order is "${row.status}", not paid — a token moves fulfilment only on a paid order` });
      }
    }
    const moved = await transactions.setFulfilment(project.id, req.params.id, body.to, body.note);
    if (!moved.ok) {
      return moved.reason === 'not-found'
        ? reply.code(404).send({ error: 'transaction not found' })
        : reply.code(409).send({ error: `an order cannot move to "${body.to}" from where it is` });
    }
    return reply.send({ transaction: moved.row });
  });

  /**
   * REFUNDS part or all of a paid order.
   *
   * ★★ SESSION-ONLY, like the credential routes and for the same reason. Every other operator
   * action here moves a label; this one moves money OUT of the merchant's account. `content:write`
   * is handed to agents routinely, and no agent task is worth the ability to drain a shop's
   * balance — a human with the project's writer role does this, in a browser.
   *
   * ★ The amount is optional and defaults to everything still outstanding, because "refund this
   * order" is overwhelmingly the common case and making an operator compute the remainder of a
   * partially-refunded order by hand is how the wrong number gets typed.
   */
  app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/transactions/:id/refund', { config: rl(20) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const body = RefundBodySchema.parse(req.body ?? {});

    const txn = await transactions.byId(project.id, req.params.id);
    if (!txn) return reply.code(404).send({ error: 'transaction not found' });
    // ★ A PREVIEW order never took money, so there is nothing to give back and asking the provider
    // would be a real request about an order it has never heard of.
    if (txn.preview) return reply.code(409).send({ error: 'a preview order never took a payment' });

    const outstanding = txn.amounts.totalMinor - txn.refundedMinor;
    const amountMinor = body.amountMinor ?? outstanding;

    // ★ The order's OWN gateway, not whichever provider the project uses for new orders today. A shop
    // that switched providers must not have last month's orders refunded through the new one's API.
    const resolved = await gateways.resolveCredentials(ctx, txn.gatewayId);
    if (!resolved.ok) {
      return reply.code(409).send({ error: `the project has no usable credentials for "${txn.gatewayId}", the gateway this order was taken through`, reason: resolved.reason });
    }
    if (!resolved.gateway.refund) return reply.code(409).send({ error: 'this gateway cannot issue refunds' });
    // ★ Refund in the mode the ORDER was taken in. Refunding a live payment with test credentials
    // reaches a provider that has never seen it.
    if (resolved.mode !== txn.mode) {
      return reply.code(409).send({ error: `this order was taken in ${txn.mode} mode and the project is now in ${resolved.mode} mode` });
    }

    // ★★ CLAIM BEFORE CALLING. See `claimRefund`: this is what makes a double-click, two operators,
    // or a retry unable to refund the same money twice.
    const claim = await transactions.claimRefund(project.id, req.params.id, amountMinor);
    if (!claim.ok) {
      if (claim.reason === 'not-found') return reply.code(404).send({ error: 'transaction not found' });
      if (claim.reason === 'not-refundable') {
        return reply.code(409).send({ error: `an order with status "${txn.status}" cannot be refunded` });
      }
      return reply.code(409).send({
        error: 'that is more than the order has left to refund',
        outstandingMinor: outstanding,
        outstanding: fromMinorUnits(outstanding, txn.currency),
      });
    }

    try {
      await refundPayment(resolved.gateway, resolved.mode, refundScope(resolved.cred, txn, amountMinor), io);
    } catch (err) {
      const kind = err instanceof GatewayError ? err.kind : 'upstream';
      const status = err instanceof GatewayError ? err.status : undefined;
      // ★★ ROLL BACK ONLY ON A DEFINITE REFUSAL. `config` means nothing was ever sent; a 4xx means
      // the provider looked at it and said no. A timeout, a 5xx or an unreadable reply may mean the
      // refund HAPPENED, and releasing the claim there would let the next attempt pay it again — so
      // the claim stands and an operator is told to go and look.
      const definitelyRefused = kind === 'config' || (kind === 'upstream' && status !== undefined && status >= 400 && status < 500);
      if (definitelyRefused) await transactions.releaseRefundClaim(req.params.id, amountMinor);
      app.log.error(
        { projectId: project.id, txnId: txn.id, kind, status, released: definitelyRefused, errMsg: err instanceof Error ? err.message : 'unknown' },
        'a refund failed',
      );
      return reply.code(502).send({
        error: definitelyRefused
          ? 'the payment provider refused the refund — nothing was refunded'
          : 'the refund could not be confirmed. Check the provider dashboard before trying again: it may have gone through.',
        settled: definitelyRefused,
      });
    }

    const row = await transactions.settleRefund(project.id, req.params.id);
    // ★ Only when the operator said so — a refund is a money event and says nothing about whether
    // the goods came back sellable. See `uncommit`.
    // A booking's payment held no stock (its lines name the booking): nothing to put back.
    const restock = body.restock === true && !txn.preview && !txn.bookingClaimId;
    if (restock) {
      await stock.uncommit(project.id, txn.lines.map((l) => ({ sku: l.sku, qty: l.qty }))).catch(() => undefined);
    }
    return reply.send({
      transaction: row ?? claim.row,
      refundedMinor: amountMinor,
      refunded: fromMinorUnits(amountMinor, txn.currency),
      restocked: restock,
    });
  });

}

/** Scope for a refund: credentials, the REFUND amount, and the payment's reference. */
export function refundScope(
  cred: Readonly<Record<string, string>>,
  txn: { amounts: { totalMinor: number }; currency: string; id: string; publicToken: string; providerRef: string | null; providerPaymentRef?: string | null },
  amountMinor: number,
): InterpolationScope {
  return {
    cred,
    // ★★ The REFUND amount, not the order total. A template saying `${AMOUNT:minor}` means "the
    // amount of this operation", and handing it the total here would refund the whole order every
    // time somebody asked for part of it.
    amount: { minor: amountMinor, decimal: fromMinorUnits(amountMinor, txn.currency), currency: txn.currency },
    // ★ `reference` prefers the PAYMENT ref over the session ref: Stripe refunds a payment_intent,
    // not a checkout session, and the two are different ids.
    txn: { id: txn.id, publicToken: txn.publicToken, reference: txn.providerPaymentRef ?? txn.providerRef ?? txn.id },
    url: { return: '', cancel: '', webhook: '' },
    field: {},
    text: {},
  };
}

/** Re-exported so app.ts does not reach past this module. */
export type { PaymentMode };
