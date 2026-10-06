import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CheckoutItemSchema,
  HONEYPOT_FIELD,
  INTERACTION_FIELD,
  POW_FIELD,
  TIMETRAP_FIELD,
  CAPTCHA_RESPONSE_FIELDS,
  MIN_SUBMIT_ELAPSED_MS,
  MAX_CHECKOUT_LINES,
  fromMinorUnits,
  validateFormSubmission,
  type CaptchaProvider,
  type FormField,
  type Shop,
  type ShopChannel,
} from '@sitewright/schema';
import { z } from 'zod';
import type { ShopCatalog } from '@sitewright/blocks';
import { createPowChallenge, powScope, verifyPowSolution } from './form-pow.js';
import type { CaptchaVerifier } from '../mail/captcha.js';
import type { ProjectContext } from '../repo/context.js';
import type { ShopTransactionRepository, TransactionRow } from '../repo/shop-transactions.js';
import type { ShopStockRepository } from '../repo/shop-stock.js';
import type { GatewayRepository } from '../payments/gateways.js';
import { amountMatches, describeAmounts, describeLines, priceOrder } from '../payments/pricing.js';
import {
  createCheckoutSession,
  fetchProviderStatus,
  interpretWebhook,
  GatewayError,
  readStringPath,
  type ExecutorIo,
} from '../payments/executor.js';
import type { InterpolationScope } from '../payments/interpolate.js';

/**
 * PUBLIC PAYMENT ENDPOINTS.
 *
 * ★ Three rules shape every handler here, and each exists because the alternative is a real defect:
 *
 * 1. **The body never carries an amount.** It carries `{sku, qty}` and buyer fields. Every figure is
 *    recomputed from the catalog snapshot, so there is nothing for a tampered cart to change.
 *
 * 2. **A trap hit answers with an ERROR, not a silent 200.** This is the one deliberate inversion
 *    from `/f/`. A form visitor needs no response to proceed, so a silent success is the right way to
 *    avoid telling a bot it was caught. A BUYER does need the response — a silent success with no
 *    redirect is a lost sale with no explanation. The error stays generic, so no gate is named.
 *
 * 3. **The webhook is the only thing that may resolve a payment.** The buyer's return navigation is a
 *    navigation they can forge, and nothing here reads it.
 */

/** Maximum raw webhook body. Provider events are a few KB; this bounds memory without clipping one. */
const MAX_WEBHOOK_BYTES = 256 * 1024;
/** Maximum checkout request body. */
const MAX_CHECKOUT_BODY_BYTES = 64 * 1024;
/** Per-field caps on buyer input, matching the form endpoint's. */
const MAX_FIELD_VALUE_LEN = 10_000;
const MAX_FIELDS = 40;
/**
 * Ceiling on unresolved sessions per project.
 *
 * A storage bound, not a business rule: without it, a script can mint `created` rows indefinitely.
 * Generous enough that a real shop never meets it, since a legitimate session resolves or expires.
 */
const MAX_OPEN_TRANSACTIONS = 2000;

/** Content type used for the raw-body webhook parser. */
const JSON_MIME = 'application/json';

export interface PaymentRoutesDeps {
  transactions: ShopTransactionRepository;
  stock: ShopStockRepository;
  gateways: GatewayRepository;
  captcha: CaptchaVerifier;
  getProjectCaptcha: (projectId: string) => Promise<{ provider: CaptchaProvider; secret: string | null; minScore?: number } | null>;
  getPowSecret: () => string;
  /**
   * Spends a proof-of-work challenge, so one solve buys one checkout.
   *
   * ★ Injected rather than reusing the payment-event spent table. Those are different namespaces
   * with different lifetimes — and `payment_gateway` ids are free-form enough that an admin could
   * legitimately create one called `pow`, which would then share a key space with challenges.
   * `formPowSpent` is purpose-built, carries the signed expiry, and is already swept.
   */
  claimPowChallenge: (challenge: string, expiresAt: Date) => Promise<boolean>;
  /** The project's shop settings, or null when it has none. */
  getShop: (projectId: string) => Promise<Shop | null>;
  /** The catalog snapshot for a mode, or null when the site has never been built in that mode. */
  getCatalog: (projectId: string, mode: 'live' | 'draft') => Promise<ShopCatalog | null>;
  /** A tenant context for a project, WITHOUT a user — the public endpoints have no session. */
  systemContext: (projectId: string) => ProjectContext;
  /** Absolute base for URLs handed to a provider (return/cancel/webhook). */
  publicBaseUrl: () => string;
  /** The published site's own base, for the buyer's return destination. */
  siteBaseUrl: (projectId: string) => Promise<string | null>;
  /** Whether the instance permits payments at all. */
  paymentsEnabled: () => Promise<boolean>;
  io: ExecutorIo;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** Permissive CORS, as for `/f/` — an exported site posts here cross-origin, with no credentials. */
function setCors(reply: FastifyReply): void {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-methods', 'POST, OPTIONS');
  reply.header('access-control-allow-headers', 'content-type');
  reply.header('access-control-max-age', '600');
}

const isCaptchaField = (key: string): boolean => (CAPTCHA_RESPONSE_FIELDS as readonly string[]).includes(key);

const CheckoutBodySchema = z.object({
  // ★ sku + qty ONLY. There is deliberately no price, total or currency in this shape.
  items: z.array(CheckoutItemSchema).min(1).max(MAX_CHECKOUT_LINES),
  fields: z.record(z.string().max(100), z.union([z.string().max(MAX_FIELD_VALUE_LEN), z.array(z.string().max(1000)).max(100)])).default({}),
  [HONEYPOT_FIELD]: z.string().max(1000).optional(),
  [TIMETRAP_FIELD]: z.string().max(32).optional(),
  [INTERACTION_FIELD]: z.string().max(32).optional(),
  [POW_FIELD]: z.string().max(4096).optional(),
  'h-captcha-response': z.string().max(8192).optional(),
  'g-recaptcha-response': z.string().max(8192).optional(),
  /**
   * The opaque token of the buyer's OWN previous unpaid attempt, to be cancelled before this one
   * reserves.
   *
   * ★ Checkout -> Back -> Checkout used to open a fresh provider session and a fresh stock
   * reservation on every click, so one indecisive buyer could hold several units of a low-stock item
   * until the 36h sweep released them. Possession of the token is the authority to supersede: it is
   * 24 random bytes the browser only has because the server issued it for that cart.
   */
  supersede: z.string().min(1).max(128).optional(),
});

/** Flattens submitted fields to a text map, exactly as the form endpoint does. */
function flattenFields(raw: Record<string, string | string[]>): Record<string, string> | { error: string } {
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS) return { error: `too many fields (the maximum is ${MAX_FIELDS})` };
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (isCaptchaField(key)) continue;
    const text = Array.isArray(value) ? value.join(', ') : value;
    if (text.length > MAX_FIELD_VALUE_LEN) return { error: `"${key}" is too long` };
    // eslint-disable-next-line security/detect-object-injection -- prototype keys excluded above; `out` is a fresh literal
    out[key] = text;
  }
  return out;
}

/** The `checkout` channel with this key, or undefined. */
function findChannel(shop: Shop | null, key: string): Extract<ShopChannel, { kind: 'checkout' }> | undefined {
  const channel = (shop?.channels ?? []).find((c) => c.kind === 'checkout' && c.key === key);
  return channel?.kind === 'checkout' ? channel : undefined;
}

/** A channel's declared buyer fields as Form fields, so the shared validator can be reused. */
function toFormFields(channel: Extract<ShopChannel, { kind: 'checkout' }>): FormField[] {
  return (channel.fields ?? []).map(
    (f) =>
      ({
        name: f.key,
        label: f.key,
        type: (['textarea', 'email', 'tel', 'number', 'url', 'date'].includes(f.type) ? f.type : 'text') as FormField['type'],
        ...(f.required ? { required: true } : {}),
      }) as FormField,
  );
}

/**
 * Joins a site base and a same-site path into an absolute URL, and REFUSES to leave the site.
 *
 * ★★ The schema already rejects everything that could change the authority (`//`, a scheme, a
 * backslash, control characters), so this is defence in depth — and it is the layer that does not
 * depend on having enumerated every such trick correctly. The resolved URL is compared against the
 * site's OWN origin, so any value that escapes falls back to the site root rather than sending a
 * paying customer to someone else's page with their transaction token attached.
 *
 * Same posture as `originAllowed` in the executor: a URL is checked by PARSING it, never by
 * inspecting the string it came from.
 */
function absolute(base: string, path: string | undefined, fallback: string): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  const resolved = new URL(path ?? fallback, root);
  const expected = new URL(root);
  if (resolved.origin !== expected.origin) return expected.toString();
  return resolved.toString();
}

export function registerPaymentRoutes(app: FastifyInstance, deps: PaymentRoutesDeps): void {
  const { transactions, stock, gateways, captcha, getProjectCaptcha, getPowSecret, getShop, getCatalog, systemContext, io, rl } = deps;

  // ---- proof-of-work challenge, and its PREVIEW twin -------------------------------------------
  //
  // ★ Both paths ship. A missing preview challenge is exactly what made proof-of-work forms silently
  // never POST on the one surface an author tests on.
  const challenge = async (req: FastifyRequest<{ Params: { projectId: string; channelKey: string } }>, reply: FastifyReply): Promise<unknown> => {
    setCors(reply);
    reply.header('cache-control', 'no-store');
    return reply.send(createPowChallenge(getPowSecret(), powScope(req.params.projectId, `pay:${req.params.channelKey}`)));
  };
  for (const path of ['/pay/:projectId/:channelKey/challenge', '/pay/:projectId/:channelKey/preview/challenge']) {
    app.options(path, { config: rl(20) }, async (_req, reply) => {
      setCors(reply);
      return reply.code(204).send();
    });
    app.get<{ Params: { projectId: string; channelKey: string } }>(path, { config: rl(30) }, challenge);
  }

  app.options('/pay/:projectId/:channelKey', { config: rl(20) }, async (_req, reply) => {
    setCors(reply);
    return reply.code(204).send();
  });

  // ---- create a checkout session ----------------------------------------------------------------
  app.post<{ Params: { projectId: string; channelKey: string }; Querystring: { preview?: string } }>(
    '/pay/:projectId/:channelKey',
    { config: rl(10), bodyLimit: MAX_CHECKOUT_BODY_BYTES },
    async (req, reply) => {
      setCors(reply);
      const { projectId, channelKey } = req.params;
      // A draft preview may only ever transact in TEST mode against the draft snapshot.
      const previewMode = req.query.preview === '1';

      if (!(await deps.paymentsEnabled())) return reply.code(503).send({ error: 'payments are not enabled on this instance' });

      const shop = await getShop(projectId);
      const channel = findChannel(shop, channelKey);
      // 404 gates the endpoint, and deliberately reveals nothing about whether the PROJECT exists.
      if (!channel || shop?.enabled !== true) return reply.code(404).send({ error: 'not found' });

      const parsed = CheckoutBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
      const bodyFields = flattenFields(parsed.data.fields as Record<string, string | string[]>);
      if ('error' in bodyFields) return reply.code(400).send({ error: 'invalid request', reason: bodyFields.error });

      /** Counts a refusal and answers the buyer generically. ★ Never names the gate that fired. */
      const refuse = async (reason: string): Promise<unknown> => {
        app.log.info({ projectId, channelKey, reason }, 'checkout refused by a bot trap');
        await transactions.recordFiltered(projectId, channelKey, reason).catch(() => undefined);
        // ★ An ERROR, not a silent 200: a buyer needs the response to proceed, and a silent success
        // with no redirect is a lost sale nobody can explain. Generic, so no gate is named.
        return reply.code(400).send({ error: 'checkout_unavailable' });
      };

      // Cheapest gates first, exactly as the form endpoint orders them.
      // eslint-disable-next-line security/detect-object-injection -- module-constant field names from @sitewright/schema
      const honeypot = (parsed.data[HONEYPOT_FIELD] ?? '').trim() !== '';
      // eslint-disable-next-line security/detect-object-injection -- module-constant field name
      const elapsed = Number(parsed.data[TIMETRAP_FIELD] ?? 0);
      if (honeypot) return refuse('honeypot');
      if (!Number.isFinite(elapsed) || elapsed < MIN_SUBMIT_ELAPSED_MS) return refuse('too-fast');

      // Interaction gate: the weakest possible test — SOME trusted input of any kind. Anything
      // sharper costs real buyers (keyboard-only visitors, autofill, screen readers).
      // eslint-disable-next-line security/detect-object-injection -- module-constant field name
      const ix = /^(\d{1,6})\.(\d{1,6})\.(\d{1,4})$/.exec((parsed.data[INTERACTION_FIELD] ?? '').trim());
      if (!ix || Number(ix[1]) + Number(ix[2]) === 0) return refuse('no-interaction');

      // Definition-aware validation — the server backstop for the browser's own.
      const invalid = validateFormSubmission(toFormFields(channel), bodyFields);
      if (invalid.length > 0) return reply.code(400).send({ error: 'invalid fields', fields: invalid });

      if (channel.pow) {
        // Verifying CONSUMES the solution, and the scope ties it to THIS channel — so the work a
        // visitor paid buys this one checkout and nothing further, here or at any other endpoint.
          // eslint-disable-next-line security/detect-object-injection -- module-constant field name
        const verdict = await verifyPowSolution(getPowSecret(), powScope(projectId, `pay:${channelKey}`), parsed.data[POW_FIELD], (c, e) =>
          deps.claimPowChallenge(c, e),
        );
        if (verdict !== 'ok') return refuse(`pow-${verdict}`);
      }

      if (channel.captcha) {
        let config: Awaited<ReturnType<typeof getProjectCaptcha>>;
        try {
          config = await getProjectCaptcha(projectId);
        } catch {
          app.log.error({ projectId, channelKey }, 'captcha secret decryption failed; refusing checkout');
          return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
        }
        if (!config?.secret) return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
        const token = parsed.data['h-captcha-response'] ?? parsed.data['g-recaptcha-response'];
        const ok = await captcha.verify({
          provider: config.provider,
          secret: config.secret,
          token,
          remoteip: req.ip,
          ...(config.minScore !== undefined ? { minScore: config.minScore } : {}),
        });
        if (!ok) return reply.code(400).send({ error: 'captcha verification failed' });
      }

      // ---- credentials and mode -------------------------------------------------------------
      const ctx = systemContext(projectId);
      const resolved = await gateways.resolveCredentials(ctx);
      if (!resolved.ok) {
        // A configuration problem is logged for the OPERATOR and generic to the buyer, who cannot act
        // on "the gateway is unverified".
        app.log.warn({ projectId, channelKey, reason: resolved.reason, missing: resolved.missing }, 'checkout refused: the gateway is not usable');
        return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
      }
      // ★ A draft preview is FORCED to test mode. Combined with per-mode credentials, an author's dry
      // run can never transact against the live account.
      if (previewMode && resolved.mode !== 'test') {
        return reply.code(400).send({ error: 'a preview checkout requires test mode' });
      }
      if (channel.gatewayId !== resolved.gateway.id) {
        app.log.warn({ projectId, channelKey, want: channel.gatewayId, have: resolved.gateway.id }, 'checkout refused: the channel names a different gateway than the project configured');
        return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
      }

      // ---- re-price, server-side ------------------------------------------------------------
      const catalog = await getCatalog(projectId, previewMode ? 'draft' : 'live');
      if (!catalog) return reply.code(503).send({ error: 'this shop has no published price list yet' });
      if (shop.currency?.code && catalog.currency !== shop.currency.code) {
        // The snapshot was built under a different settlement currency — charging against it would
        // mean charging in a currency the shop no longer uses.
        app.log.warn({ projectId, snapshot: catalog.currency, configured: shop.currency.code }, 'checkout refused: the price list predates a currency change');
        return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
      }
      const priced = priceOrder(parsed.data.items, catalog, shop.pricing);
      if (!priced.ok) {
        // These ARE actionable by the buyer: an item is gone, or the cart is malformed. Naming the
        // SKU is the difference between a recoverable cart and an abandoned one.
        const status = priced.reason === 'unknown-sku' ? 409 : 400;
        return reply.code(status).send({ error: priced.reason, ...('sku' in priced ? { sku: priced.sku } : {}) });
      }

      if ((await transactions.countOpen(projectId)) >= MAX_OPEN_TRANSACTIONS) {
        app.log.warn({ projectId }, 'checkout refused: too many unresolved sessions');
        return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
      }

      // ---- hold stock ------------------------------------------------------------------------
      //
      // ★★ A PREVIEW CHECKOUT NEVER TOUCHES THE STOCK LEDGER.
      //
      // The ledger is not mode-scoped — availability is a fact about real inventory, not about which
      // credentials happen to be in use — so a dry run that reserved from it would hold real units
      // for the full reservation TTL, and one that reached `paid` would increment real `sold`
      // permanently. `sold` is never decremented, so an admin verifying a gateway, or an author
      // testing their checkout page, would quietly make a SKU unavailable to actual buyers.
      //
      // Skipping the reserve rather than adding a `mode` column is the honest shape: there is no
      // such thing as "preview inventory" to hold, and the dry run's purpose is to prove the request,
      // redirect, webhook and notification path works — none of which needs a real hold.
      const held = priced.lines.map((l) => ({ sku: l.sku, qty: l.qty }));

      // ★ Supersede the buyer's own prior attempt FIRST, so its units are back before this one asks
      // for them — otherwise a buyer re-confirming the last item in stock would be refused by their
      // own abandoned hold. Narrow on purpose: same project, same channel, still `created`. Anything
      // else (another channel, already paid, already cancelled) is left exactly as it is.
      if (parsed.data.supersede) {
        const prior = await transactions.byPublicToken(projectId, parsed.data.supersede);
        if (prior && prior.status === 'created' && prior.channelKey === channelKey) {
          if (await transactions.advance(prior.id, 'cancelled')) {
            if (!prior.preview) {
              await stock.release(projectId, prior.lines.map((l) => ({ sku: l.sku, qty: l.qty }))).catch(() => undefined);
            }
          }
        }
      }

      if (!previewMode) {
        const reserved = await stock.reserve(projectId, held);
        if (!reserved.ok) {
          if (reserved.reason === 'out-of-stock') {
            return reply.code(409).send({ error: 'out_of_stock', sku: reserved.sku, available: reserved.available });
          }
          return reply.code(503).send({ error: 'checkout is temporarily unavailable' });
        }
      }

      // ---- open the transaction, then ask the provider ---------------------------------------
      const customerEmail = pickEmail(bodyFields);
      let txn: TransactionRow;
      try {
        txn = await transactions.create({
          projectId,
          channelKey,
          gatewayId: resolved.gateway.id,
          mode: resolved.mode,
          currency: priced.currency,
          amounts: priced.amounts,
          lines: priced.lines,
          buyer: bodyFields,
          catalogDigest: priced.catalogDigest,
          owesNotification: true,
          ...(previewMode ? { preview: true } : {}),
          ...(customerEmail ? { customerEmail } : {}),
        });
      } catch (err) {
        if (!previewMode) await stock.release(projectId, held).catch(() => undefined);
        throw err;
      }

      const siteBase = (await deps.siteBaseUrl(projectId)) ?? deps.publicBaseUrl();
      const apiBase = deps.publicBaseUrl().replace(/\/+$/, '');
      const scope: InterpolationScope = {
        cred: resolved.cred,
        amount: { minor: priced.amounts.totalMinor, decimal: fromMinorUnits(priced.amounts.totalMinor, priced.currency), currency: priced.currency },
        txn: { id: txn.id, publicToken: txn.publicToken, reference: txn.id },
        url: {
          // ★ The return destination carries the opaque token, and the thank-you page reads its
          // status from the platform. The URL itself is never evidence of payment.
          return: withToken(absolute(siteBase, channel.returnPath, '/'), txn.publicToken),
          cancel: absolute(siteBase, channel.cancelPath, '/'),
          webhook: `${apiBase}/pay/${projectId}/webhook/${resolved.gateway.id}`,
        },
        field: bodyFields,
        text: { order_name: priced.orderName },
      };

      try {
        const session = await createCheckoutSession(resolved.gateway, resolved.mode, scope, io);
        await transactions.attachProviderRef(txn.id, session.ref);
        return reply.send({
          // ★ The AUTHORITATIVE breakdown goes back, so the drawer's review step shows the server's
          // numbers rather than its own. A client showing one total while the provider charges
          // another is the worst defect this feature can have.
          token: txn.publicToken,
          redirectUrl: session.redirectUrl,
          currency: priced.currency,
          amounts: priced.amounts,
          display: describeAmounts(priced.amounts, priced.currency),
          // Each line already FORMATTED, for the same reason as the totals: the review step must not
          // compute anything, or it can disagree with what is charged.
          lines: describeLines(priced.lines, priced.currency),
        });
      } catch (err) {
        // The provider never opened a session, so nothing can resolve this transaction. Give the
        // stock back and close the row rather than leaving a hold nobody will ever release.
        if (!previewMode) await stock.release(projectId, held).catch(() => undefined);
        await transactions.advance(txn.id, 'failed').catch(() => undefined);
        const kind = err instanceof GatewayError ? err.kind : 'upstream';
        app.log.error({ projectId, channelKey, kind, errMsg: err instanceof Error ? err.message : 'unknown' }, 'could not create a checkout session');
        return reply.code(502).send({ error: 'the payment provider could not start a checkout' });
      }
    },
  );

  // ---- webhook ----------------------------------------------------------------------------------
  //
  // ★★ REGISTERED IN ITS OWN ENCAPSULATED SCOPE, so it can have a RAW-BODY parser without changing
  // any other route.
  //
  // Fastify scopes content-type parsers per plugin, which is the only way to do this: the app
  // already installs a global JSON parser, and a signature verified over a RE-SERIALIZED body fails
  // for every provider — key order, whitespace and number formatting all differ on the wire. A route
  // that verified `JSON.stringify(req.body)` would reject every genuine webhook, which is a failure
  // mode that looks exactly like a misconfigured secret.
  void app.register(async (scope) => {
    scope.removeContentTypeParser(JSON_MIME);
    scope.addContentTypeParser(JSON_MIME, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    // ★★ On `scope`, NOT `app`. A parser registered on an encapsulated scope applies only to routes
    // registered on THAT scope — hanging the route off the outer `app` silently left it on the global
    // JSON parser, so `req.body` arrived as an object and the handler fell back to re-serializing it.
    // Compact provider JSON round-trips byte-identically, which is why every webhook test still
    // passed; pretty-printed JSON (what providers actually send) did not, and was rejected as a bad
    // signature. The webhook is the sole source of truth for payment, so this failed closed on every
    // real payment while looking exactly like a misconfigured secret.
    scope.post<{ Params: { projectId: string; gatewayId: string } }>(
      '/pay/:projectId/webhook/:gatewayId',
      { config: rl(120), bodyLimit: MAX_WEBHOOK_BYTES },
      async (req, reply) => {
        const { projectId, gatewayId } = req.params;
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}), 'utf8');

        const resolved = await gateways.resolveCredentials(systemContext(projectId));
        // ★ 400, with no detail, for everything unresolvable. A webhook endpoint must not be an oracle
        // for which projects exist or which gateways they use.
        if (!resolved.ok || resolved.gateway.id !== gatewayId) return reply.code(400).send({ error: 'invalid' });

        const outcome = await interpretWebhook(resolved.gateway, resolved.mode, raw, req.headers, resolved.cred, io);
        if (!outcome.ok) {
          app.log.warn({ projectId, gatewayId, reason: outcome.reason }, 'webhook refused');
          await transactions.recordFiltered(projectId, `webhook:${gatewayId}`, outcome.reason).catch(() => undefined);
          return reply.code(400).send({ error: 'invalid' });
        }
        const verdict = outcome.verdict;

        // ★ From here the event is VERIFIED, so every exit is 200: providers retry non-2xx
        // indefinitely, and re-delivering an event the platform has already handled (or deliberately
        // ignored) achieves nothing but load.
        if (!(await transactions.claimEvent(gatewayId, verdict.eventId))) {
          app.log.info({ projectId, gatewayId, eventId: verdict.eventId }, 'webhook already handled (replay)');
          return reply.send({ ok: true, duplicate: true });
        }

        const txn = await transactions.byProviderRef(gatewayId, verdict.ref);
        if (!txn || txn.projectId !== projectId) {
          app.log.warn({ projectId, gatewayId }, 'verified webhook for an unknown transaction');
          return reply.send({ ok: true, unmatched: true });
        }

        // Mollie's shape: the body said only "something changed". Ask the provider what.
        let kind = verdict.kind;
        if (kind === 'recheck') {
          try {
            const status = await fetchProviderStatus(resolved.gateway, resolved.mode, statusScope(resolved.cred, txn), io);
            kind = status.kind === 'recheck' ? 'unknown' : status.kind;
          } catch (err) {
            app.log.warn({ projectId, gatewayId, errMsg: err instanceof Error ? err.message : 'unknown' }, 'could not re-read a payment status');
            // Leave it alone; the reconciler will try again. 200 so the provider stops retrying.
            return reply.send({ ok: true, deferred: true });
          }
        }
        if (kind === 'unknown') return reply.send({ ok: true, ignored: true });

        if (kind === 'paid') {
          // ★★ THE CROSS-CHECK. A provider claiming a different amount than the platform computed means
          // the template, the currency or the event mapping is wrong — and recording a payment the shop
          // did not ask for, in either direction, is worse than leaving it unresolved for an operator.
          if (!amountMatches({ totalMinor: txn.amounts.totalMinor, currency: txn.currency }, verdict)) {
            app.log.error(
              { projectId, gatewayId, txnId: txn.id, expectedMinor: txn.amounts.totalMinor, expectedCurrency: txn.currency, claimedMinor: verdict.amountMinor, claimedCurrency: verdict.currency },
              'webhook refused: the amount the provider reported does not match the order',
            );
            await transactions.recordFiltered(projectId, `webhook:${gatewayId}`, 'amount-mismatch').catch(() => undefined);
            return reply.send({ ok: true, mismatch: true });
          }
          const payerEmail = payerEmailFrom(raw);
          const advanced = await transactions.advance(txn.id, 'paid', {
            owesNotification: true,
            // ★ Prefer the PROVIDER's payer email: it is verified by the payment itself. Fall back to
            // the buyer's submitted field.
            ...(payerEmail ?? txn.customerEmail ? { customerEmail: payerEmail ?? txn.customerEmail! } : {}),
            ...(verdict.ref ? { providerPaymentRef: verdict.ref } : {}),
          });
          // ★ A preview rehearsal reserved nothing, so committing would increment `sold` against
          // stock it never held — permanently understating what a real buyer can order.
          if (advanced.outcome === 'advanced' && !txn.preview) {
            await stock.commit(projectId, txn.lines.map((l) => ({ sku: l.sku, qty: l.qty })));
          }
          return reply.send({ ok: true });
        }

        // ★★ A REFUND REPORTED BY THE PROVIDER — almost always one issued in their own dashboard,
        // which is a thing merchants really do. The event's amount decides whether this is a full or
        // a PARTIAL refund: marking an order fully refunded because a provider sent back €5 of €50
        // tells the shop it owes nothing more and hides the other €45 from every total.
        if (kind === 'refunded') {
          // An event with no amount means the whole order: a provider that reports an amount is
          // telling us something, and one that does not is reporting the only refund it can express.
          const reported = verdict.amountMinor ?? txn.amounts.totalMinor - txn.refundedMinor;
          // Clamped: a provider repeating an event, or reporting a cumulative figure where we
          // expected an increment, must not drive the balance past the order.
          const add = Math.max(0, Math.min(reported, txn.amounts.totalMinor - txn.refundedMinor));
          if (add > 0) await transactions.claimRefund(projectId, txn.id, add);
          await transactions.settleRefund(projectId, txn.id);
          // ★ No restock. The platform cannot know whether goods came back, and here there is not
          // even an operator in the loop to ask — see `uncommit`.
          return reply.send({ ok: true });
        }

        const advanced = await transactions.advance(txn.id, kind);
        if (advanced.outcome === 'advanced' && !txn.preview && (kind === 'failed' || kind === 'expired' || kind === 'cancelled')) {
          // Give the hold back — this order will never be paid.
          await stock.release(projectId, txn.lines.map((l) => ({ sku: l.sku, qty: l.qty })));
        }
        return reply.send({ ok: true });
      },
    );
  });

  // ---- status poll ------------------------------------------------------------------------------
  app.options('/pay/:projectId/txn/:token', { config: rl(60) }, async (_req, reply) => {
    setCors(reply);
    return reply.code(204).send();
  });
  app.get<{ Params: { projectId: string; token: string } }>('/pay/:projectId/txn/:token', { config: rl(120) }, async (req, reply) => {
    setCors(reply);
    // ★ Never cached. A shared cache holding one buyer's order under a URL is exactly the leak the
    // opaque token exists to prevent.
    reply.header('cache-control', 'no-store');
    const txn = await transactions.byPublicToken(req.params.projectId, req.params.token);
    if (!txn) return reply.code(404).send({ error: 'not found' });
    // `toPublic` allowlists: no merchant address, no provider refs, no gateway id, no token.
    return reply.send({ transaction: transactions.toPublic(txn) });
  });
}

/**
 * Appends the status token to a return URL.
 *
 * ★ Built with `searchParams`, not by concatenating `?t=` / `&t=`. A `returnPath` may legitimately
 * carry its own query string or a FRAGMENT (`/thank-you/#order`), and a string append puts the token
 * inside the fragment, where the thank-you page's `?t=` lookup never finds it — the page then shows
 * "we could not find your order" after a successful payment, which is the worst possible moment for
 * it. Setting the param moves it to the right component whatever the path already contained.
 */
function withToken(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set('t', token);
  return u.toString();
}

/** Scope for a status re-read: credentials plus the reference. No amount is needed to ASK. */
function statusScope(cred: Readonly<Record<string, string>>, txn: TransactionRow): InterpolationScope {
  return {
    cred,
    amount: { minor: txn.amounts.totalMinor, decimal: fromMinorUnits(txn.amounts.totalMinor, txn.currency), currency: txn.currency },
    txn: { id: txn.id, publicToken: txn.publicToken, reference: txn.providerRef ?? txn.id },
    url: { return: '', cancel: '', webhook: '' },
    field: {},
    text: {},
  };
}

/** Longest address this will accept. RFC 5321's limit, and the bound that makes EMAIL_RE cheap. */
const MAX_EMAIL_LEN = 320;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether a submitted value is a usable address.
 *
 * ★★ THE LENGTH CHECK RUNS FIRST, AND THE ORDER IS THE WHOLE POINT. `[^\s@]+` followed by a literal
 * `.` is an ambiguous overlap (the class contains `.`), so this pattern is quadratic: at the
 * checkout's own 10,000-character field cap one `.test()` costs ~20 ms, and a single unauthenticated
 * POST naming all four candidate keys burns ~80 ms of the shared event loop. On the webhook path the
 * body cap is 256 KB, where the same shape reaches multiple seconds.
 *
 * The regex is not the bug — testing it before the cheap bound is. Reordering costs nothing and
 * removes the class, which is the same lesson as dropping author-supplied patterns from
 * `CredentialField`: run the cheap, certain check before the expensive, ambiguous one.
 *
 * Exported so the cost can be MEASURED directly. Asserting the timing through the HTTP route cannot
 * discriminate: request overhead swamps the ~80 ms the bug costs there, so a threshold loose enough
 * to be stable is loose enough to pass with the bug present — which the first version of that test
 * did.
 */
export function usableEmail(v: string | undefined): v is string {
  if (!v || v.length > MAX_EMAIL_LEN) return false;
  if (/[\r\n]/.test(v)) return false;
  return EMAIL_RE.test(v);
}

/** A plausible customer address from the submitted fields, for the receipt. */
function pickEmail(fields: Record<string, string>): string | undefined {
  for (const key of ['email', 'e_mail', 'mail', 'customer_email']) {
    // eslint-disable-next-line security/detect-object-injection -- `key` is from a literal list above; own-property checked
    const v = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
    if (usableEmail(v)) return v;
  }
  return undefined;
}

/**
 * The payer email a provider reported, when its event carries one.
 *
 * Read from a small set of known paths rather than from a gateway-declared one: this value decides
 * where a receipt is SENT, so it must not be something an editable record can point at an arbitrary
 * field of an attacker-shaped body.
 */
function payerEmailFrom(raw: Buffer): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
  for (const path of [
    'data.object.customer_details.email',
    'data.object.customer_email',
    'resource.payer.email_address',
    'resource.payment_source.paypal.email_address',
    'payer.email',
  ]) {
    const v = readStringPath(body, path);
    if (usableEmail(v)) return v;
  }
  return undefined;
}
