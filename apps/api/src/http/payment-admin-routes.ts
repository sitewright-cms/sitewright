import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  PaymentGatewayInputSchema,
  PaymentBindingInputSchema,
  PaymentModeSchema,
  FulfilmentStateSchema,
  GatewayIdSchema,
  toPublicGateway,
  fromMinorUnits,
  type PaymentGatewayStored,
  type PaymentMode,
} from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { GatewayRepository } from '../payments/gateways.js';
import type { ShopTransactionRepository } from '../repo/shop-transactions.js';
import type { ShopStockRepository } from '../repo/shop-stock.js';
import { isBuiltinGateway } from '../payments/builtin-gateways.js';
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
    if (await hasProviderWriteScope(req)) return 'agent';
    return requireInstanceAdmin(req);
  }

  // ---- level 1: the gateway definitions ----------------------------------------------------------

  app.get('/admin/payment-gateways', { config: rl(60) }, async (req, reply) => {
    await requireGatewayAuthor(req);
    const all = await gateways.list();
    return reply.send({
      gateways: all.map(({ gateway, builtin }) => ({
        ...gateway,
        builtin,
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
    const forked = await gateways.fork(req.params.id, body.id, userId);
    if (!forked) return reply.code(404).send({ error: 'gateway not found' });
    return reply.code(201).send({ gateway: body.name ? await gateways.put({ ...forked, name: body.name }, userId) : forked });
  });

  app.delete<{ Params: { id: string } }>('/admin/payment-gateways/:id', { config: rl(30) }, async (req, reply) => {
    const userId = await requireGatewayAuthor(req);
    // Deleting a built-in's STORED OVERRIDE reverts to the shipped definition; the built-in itself
    // cannot be removed, so there is always a reference implementation to compare against.
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

    const resolved = await gateways.resolveCredentials(ctx);
    if (!resolved.ok) {
      return reply.code(409).send({ error: 'the project has no usable credentials for this gateway', reason: resolved.reason, missing: resolved.missing });
    }
    if (resolved.gateway.id !== rec.gateway.id) {
      return reply.code(409).send({ error: 'that project is bound to a different gateway' });
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
      await gateways.markVerified(rec.gateway.id, userId === 'agent' ? 'system' : userId);
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

  /** What a project may read about the gateways available to it. Public metadata only. */
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/payment-gateways', { config: rl(60) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const all = await gateways.list();
    const base = deps.publicBaseUrl().replace(/\/+$/, '');
    return reply.send({
      // ★ Only ENABLED and VERIFIED gateways are offered. Letting a project bind an unproven one
      // would mean the first sign of an unfinished gateway is a buyer unable to pay.
      gateways: all
        .filter(({ gateway }) => gateway.enabled && gateway.verified)
        .map(({ gateway }) => ({
          ...toPublicGateway(gateway),
          // The exact URL to paste into the provider's dashboard, assembled here rather than left for
          // an operator to build by hand and get subtly wrong.
          webhookUrl: `${base}/pay/${ctx.projectId}/webhook/${gateway.id}`,
        })),
    });
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/payment', { config: rl(60) }, async (req, reply) => {
    // ★ SESSION-ONLY. See the file header: an agent must not read or write payment credentials.
    const { ctx } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const binding = await gateways.bindingPublic(ctx);
    const base = deps.publicBaseUrl().replace(/\/+$/, '');
    return reply.send({
      binding,
      ...(binding ? { webhookUrl: `${base}/pay/${ctx.projectId}/webhook/${binding.gatewayId}` } : {}),
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
    const { mode } = z.object({ mode: PaymentModeSchema }).parse(req.body);
    const result = await gateways.setMode(ctx, mode);
    if (!result.ok) {
      // ★ Refused rather than allowed-and-broken: going live with no live key would make the first
      // symptom a real customer unable to pay.
      return reply.code(409).send({ error: `the ${mode} credentials are incomplete`, missing: result.missing });
    }
    return reply.send({ mode });
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
    const queued = await transactions.requeueMail(project.id, req.params.id, kind);
    if (!queued) return reply.code(404).send({ error: 'transaction not found' });
    return reply.send({ queued: true, kind });
  });

  /** Moves the operator-owned fulfilment state. Refuses an illegal or backwards move. */
  app.patch<{ Params: { projectId: string; id: string } }>('/projects/:projectId/transactions/:id/fulfilment', { config: rl(60) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const body = z.object({ to: FulfilmentStateSchema, note: z.string().max(2000).optional() }).parse(req.body);
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

    const resolved = await gateways.resolveCredentials(ctx);
    if (!resolved.ok) return reply.code(409).send({ error: 'the project has no usable payment credentials', reason: resolved.reason });
    // ★ The order's OWN gateway, not whatever the project is bound to today. A shop that switched
    // providers must not have last month's orders refunded through the new one's API.
    if (resolved.gateway.id !== txn.gatewayId) {
      return reply.code(409).send({ error: 'this order was taken through a different gateway, which the project is no longer bound to' });
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
    if (body.restock && !txn.preview) {
      await stock.uncommit(project.id, txn.lines.map((l) => ({ sku: l.sku, qty: l.qty }))).catch(() => undefined);
    }
    return reply.send({
      transaction: row ?? claim.row,
      refundedMinor: amountMinor,
      refunded: fromMinorUnits(amountMinor, txn.currency),
      restocked: body.restock === true,
    });
  });

}

/** Scope for a refund: credentials, the REFUND amount, and the payment's reference. */
function refundScope(
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
