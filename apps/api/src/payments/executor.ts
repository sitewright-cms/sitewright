import { createHash } from 'node:crypto';
import type { GatewayEventKind, PaymentGatewayStored, PaymentMode } from '@sitewright/schema';
import { interpolateString, interpolateValue, readStringPath, readPath, InterpolationError, type InterpolationScope } from './interpolate.js';
import { verifyWebhookSignature, type VerifyFailure } from './verify.js';

/**
 * THE GATEWAY EXECUTOR — the host half of a declarative gateway.
 *
 * ★ Everything that can be lied about happens HERE, not in the stored record: credential
 * substitution, the admin-approved origin check, HTTPS enforcement, signature verification, and the
 * cross-check of the amount a provider claims against the amount the platform computed.
 *
 * The record contributes only SHAPE — which path, which headers, which field holds the id.
 */

/** Minimal fetch surface, injected so tests feed canned responses (the StockProvider precedent). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ExecutorIo {
  fetch: FetchLike;
  now: () => number;
  /** Structured log. ★ A URL or body is NEVER passed to it — a provider key can ride in either. */
  log?: { warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void };
}

/** Whole-operation deadline for one provider call. A trickling server must not hold a worker. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Bound on a provider response we will parse. A payment session response is a few KB. */
const MAX_RESPONSE_BYTES = 512 * 1024;

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'upstream' | 'response',
    /** Upstream status, when the failure was one. Lets a caller tell a rejected key from an outage. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Normalises an origin for comparison: lowercase, no trailing slash, default port removed.
 *
 * Done by parsing rather than by string munging, so `https://API.Stripe.com:443/` and
 * `https://api.stripe.com` compare equal and `https://api.stripe.com.evil.test` does not.
 */
function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * ★★ THE BINDING GUARD. Every URL the host calls, and every URL it hands a buyer, must sit on an
 * origin an INSTANCE ADMIN approved.
 *
 * This is the one lever a malicious or mistaken gateway definition would otherwise pull: pointing
 * `redirectUrl` at a lookalike checkout and collecting the payment itself. The allowlist is an
 * admin-only field stored apart from the editable body, so the author of a gateway is not the
 * approver of its destinations.
 */
export function originAllowed(gateway: PaymentGatewayStored, url: string): boolean {
  const origin = normalizeOrigin(url);
  if (!origin) return false;
  return gateway.allowedOrigins.some((o) => normalizeOrigin(o) === origin);
}

/** Joins the gateway's mode-specific base with an interpolated path, and re-checks the origin. */
function buildUrl(gateway: PaymentGatewayStored, mode: PaymentMode, path: string): string {
  // eslint-disable-next-line security/detect-object-injection -- mode is a validated enum member
  const base = gateway.apiBase[mode];
  if (!base) throw new GatewayError(`the gateway has no ${mode} API base`, 'config');
  // `new URL(path, base)` resolves `..` and an absolute path against the base, so a template cannot
  // escape the host — and the origin check below is the real guard regardless.
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  if (!originAllowed(gateway, url)) {
    throw new GatewayError('the request URL is not on an approved origin for this gateway', 'config');
  }
  return url;
}

/** Form-encodes a flat object, the shape Stripe's API wants. Nested values are already flattened. */
function formEncode(body: unknown): string {
  const params = new URLSearchParams();
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      params.append(k, typeof v === 'string' ? v : String(v));
    }
  }
  return params.toString();
}

/** Performs one provider call with a hard deadline and a response-size bound. */
async function callProvider(
  io: ExecutorIo,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<unknown> {
  const controller = new AbortController();
  // ★ A whole-operation deadline, not a per-socket inactivity timeout: a server that trickles one
  // byte a second would otherwise hold this open indefinitely.
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await io.fetch(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: controller.signal });
  } catch (err) {
    // ★ Only a short reason escapes. A fetch error can carry the resolved IP and the full URL, and
    // for several providers the URL carries the key.
    throw new GatewayError(`the payment provider could not be reached (${err instanceof Error ? err.name : 'network error'})`, 'upstream');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new GatewayError('the payment provider returned an oversized response', 'response', res.status);
  if (!res.ok) {
    // ★ The STATUS only. A provider error body routinely echoes the request back, key included.
    throw new GatewayError(`the payment provider rejected the request (HTTP ${res.status})`, 'upstream', res.status);
  }
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayError('the payment provider returned a response that was not JSON', 'response', res.status);
  }
}

/** Resolves the Authorization header for a gateway, performing a token exchange when required. */
async function authHeaders(
  gateway: PaymentGatewayStored,
  mode: PaymentMode,
  cred: Readonly<Record<string, string>>,
  io: ExecutorIo,
): Promise<Record<string, string>> {
  const auth = gateway.auth;
  const need = (key: string): string => {
    // eslint-disable-next-line security/detect-object-injection -- own-property checked; `key` is a gateway-declared field name and cred is a flat string map
    const v = Object.prototype.hasOwnProperty.call(cred, key) ? cred[key] : undefined;
    if (!v) throw new GatewayError(`the credential "${key}" has no value for ${mode} mode`, 'config');
    return v;
  };
  switch (auth.kind) {
    case 'none':
      return {};
    case 'bearer':
      return { authorization: `Bearer ${need(auth.secretField)}` };
    case 'basic':
      return { authorization: `Basic ${Buffer.from(`${need(auth.userField)}:${need(auth.secretField)}`).toString('base64')}` };
    case 'oauth2-client-credentials': {
      const url = buildUrl(gateway, mode, auth.tokenPath);
      const basic = Buffer.from(`${need(auth.clientIdField)}:${need(auth.clientSecretField)}`).toString('base64');
      const json = await callProvider(
        io,
        url,
        'POST',
        { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        'grant_type=client_credentials',
      );
      const token = readStringPath(json, auth.tokenPathInResponse);
      if (!token) throw new GatewayError('the payment provider did not return an access token', 'response');
      return { authorization: `Bearer ${token}` };
    }
  }
}

export interface CheckoutSession {
  /** The provider's id for the session — the webhook's join key. */
  ref: string;
  /** The hosted-checkout URL. ★ Already origin-checked by this module before it is returned. */
  redirectUrl: string;
}

/**
 * Creates a hosted-checkout session.
 *
 * ★ The amount comes in through `scope.amount`, already computed by the platform from its own
 * catalog snapshot. Nothing a browser sent reaches this function.
 */
export async function createCheckoutSession(
  gateway: PaymentGatewayStored,
  mode: PaymentMode,
  scope: InterpolationScope,
  io: ExecutorIo,
): Promise<CheckoutSession> {
  const req = gateway.checkout.request;
  let url: string;
  let headers: Record<string, string>;
  let body: string | undefined;
  try {
    url = buildUrl(gateway, mode, interpolateString(req.path, scope));
    const interpolatedHeaders = interpolateValue(req.headers, scope) as Record<string, string>;
    headers = {
      accept: 'application/json',
      ...(req.format === 'form' ? { 'content-type': 'application/x-www-form-urlencoded' } : { 'content-type': 'application/json' }),
      ...interpolatedHeaders,
      ...(await authHeaders(gateway, mode, scope.cred, io)),
    };
    if (req.method !== 'GET' && req.body !== undefined) {
      const interpolated = interpolateValue(req.body, scope);
      body = req.format === 'form' ? formEncode(interpolated) : JSON.stringify(interpolated);
    }
  } catch (err) {
    // An interpolation failure is a CONFIG problem — a template referencing something that is not
    // there — and must read as one rather than as a provider outage.
    if (err instanceof InterpolationError) throw new GatewayError(err.message, 'config');
    throw err;
  }
  const json = await callProvider(io, url, req.method, headers, body);
  const ref = readStringPath(json, gateway.checkout.refPath);
  const redirectUrl = readStringPath(json, gateway.checkout.redirectUrlPath);
  if (!ref) throw new GatewayError('the payment provider did not return a session reference', 'response');
  if (!redirectUrl) throw new GatewayError('the payment provider did not return a checkout URL', 'response');
  // ★★ THE REDIRECT IS RE-CHECKED AGAINST THE ADMIN'S ALLOWLIST. Even a genuine provider response is
  // not trusted to name where a buyer goes: this is the step that makes a compromised or mistaken
  // gateway definition unable to send a customer to a lookalike checkout.
  if (!originAllowed(gateway, redirectUrl)) {
    throw new GatewayError('the payment provider returned a checkout URL on an unapproved origin', 'response');
  }
  return { ref, redirectUrl };
}

/** A provider's authoritative view of one payment. */
export interface ProviderStatus {
  kind: GatewayEventKind;
  /** The raw provider state string, for diagnostics. Never shown to a buyer. */
  raw: string;
}

/** Re-reads a payment's status — the reconciliation path, and Mollie's `recheck` resolution. */
export async function fetchProviderStatus(
  gateway: PaymentGatewayStored,
  mode: PaymentMode,
  scope: InterpolationScope,
  io: ExecutorIo,
): Promise<ProviderStatus> {
  const cfg = gateway.status;
  if (!cfg) throw new GatewayError('this gateway cannot report a payment status', 'config');
  const url = buildUrl(gateway, mode, interpolateString(cfg.request.path, scope));
  const headers = {
    accept: 'application/json',
    ...(interpolateValue(cfg.request.headers, scope) as Record<string, string>),
    ...(await authHeaders(gateway, mode, scope.cred, io)),
  };
  const json = await callProvider(io, url, cfg.request.method, headers, undefined);
  const raw = readStringPath(json, cfg.statePath) ?? '';
  // eslint-disable-next-line security/detect-object-injection -- `raw` indexes a gateway-declared literal map; a miss yields undefined
  const mapped = cfg.states[raw];
  // ★ An UNKNOWN state is `recheck`, never `paid` and never `failed`. A provider adding a state the
  // record has not been taught about must leave the order alone, not resolve it by guesswork.
  return { kind: mapped ?? 'recheck', raw };
}

/** What a provider said about a refund we asked for. */
export interface RefundResult {
  /** The provider's id for the refund, when it returns one. Recorded for reconciliation by hand. */
  ref?: string;
}

/**
 * Asks the provider to refund part or all of a payment.
 *
 * ★★ THE AMOUNT COMES FROM `scope.amount`, which the CALLER has already claimed against the
 * transaction's remaining refundable balance. Nothing here decides how much to send back — this
 * function's whole job is to shape the request, sign it, and report whether the provider accepted.
 *
 * ★ A failure must be distinguishable, because the caller rolls its claim back on a definite refusal
 * and deliberately does NOT on an ambiguous one (a timeout may mean the refund happened). That is
 * what `GatewayError.kind` carries: `config` is a template problem, `upstream` is the provider
 * saying no or being unreachable, `response` is a reply we cannot read.
 */
export async function refundPayment(
  gateway: PaymentGatewayStored,
  mode: PaymentMode,
  scope: InterpolationScope,
  io: ExecutorIo,
): Promise<RefundResult> {
  const cfg = gateway.refund;
  // ★ Refused rather than silently succeeding. A gateway with no refund template cannot refund, and
  // reporting success would leave an order marked refunded with the customer's money still taken.
  if (!cfg) throw new GatewayError('this gateway cannot issue refunds', 'config');
  const req = cfg.request;
  let url: string;
  let headers: Record<string, string>;
  let body: string | undefined;
  try {
    url = buildUrl(gateway, mode, interpolateString(req.path, scope));
    headers = {
      accept: 'application/json',
      ...(req.format === 'form' ? { 'content-type': 'application/x-www-form-urlencoded' } : { 'content-type': 'application/json' }),
      ...(interpolateValue(req.headers, scope) as Record<string, string>),
      ...(await authHeaders(gateway, mode, scope.cred, io)),
    };
    if (req.method !== 'GET' && req.body !== undefined) {
      const interpolated = interpolateValue(req.body, scope);
      body = req.format === 'form' ? formEncode(interpolated) : JSON.stringify(interpolated);
    }
  } catch (err) {
    if (err instanceof InterpolationError) throw new GatewayError(err.message, 'config');
    throw err;
  }
  const json = await callProvider(io, url, req.method, headers, body);
  // The id is optional: several providers answer a refund with the PAYMENT object rather than a
  // refund object, and the platform's record of the refund is its own row either way.
  const ref = readStringPath(json, 'id');
  return ref ? { ref } : {};
}

/** What a verified webhook turned out to mean. */
export interface WebhookVerdict {
  eventId: string;
  ref: string;
  kind: GatewayEventKind | 'unknown';
  /**
   * The amount the provider claims, when it echoed one.
   *
   * ★ Carried for the caller to CROSS-CHECK against the amount the platform computed, never to use
   * as the amount. A provider echo that disagrees with the transaction means something is wrong with
   * the configuration or the event, and the order must not be resolved on the provider's figure.
   *
   * Offered in both shapes because providers differ: Stripe sends minor units, PayPal a decimal string.
   */
  amountMinor?: number;
  amountDecimal?: string;
  currency?: string;
}

export type WebhookOutcome = { ok: true; verdict: WebhookVerdict } | { ok: false; reason: VerifyFailure | 'malformed-body' | 'no-ref' };

/**
 * Verifies a webhook and maps it onto a verdict.
 *
 * `raw` must be the EXACT bytes the provider sent. Verifying a re-serialized body fails for every
 * provider — key order, spacing and number formatting all differ — which is why the route registers
 * its own raw-body parser rather than using the app's global JSON one.
 */
export async function interpretWebhook(
  gateway: PaymentGatewayStored,
  mode: PaymentMode,
  raw: Buffer,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  cred: Readonly<Record<string, string>>,
  io: ExecutorIo,
): Promise<WebhookOutcome> {
  const v = gateway.verification;
  if (v.scheme === 'remote-verify') {
    const outcome = await verifyRemote(gateway, mode, raw, headers, cred, io);
    if (!outcome) return { ok: false, reason: 'bad-signature' };
  } else {
    const secret = Object.prototype.hasOwnProperty.call(cred, v.secretField) ? cred[v.secretField] : undefined;
    const result = verifyWebhookSignature(v, raw, headers, secret, io.now());
    if (!result.ok) return { ok: false, reason: result.reason };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed-body' };
  }
  const map = gateway.events;
  const ref = readStringPath(body, map.refPath);
  // A verified event the platform cannot tie to a transaction is acknowledged (so the provider stops
  // retrying) but acted on by nothing.
  if (!ref) return { ok: false, reason: 'no-ref' };
  const typeString = map.typePath ? readStringPath(body, map.typePath) : undefined;
  // eslint-disable-next-line security/detect-object-injection -- indexes a gateway-declared literal map; a miss yields undefined
  const mapped = typeString !== undefined ? map.types[typeString] : map.defaultKind;
  // ★ `unknown`, not a guess. A provider introducing a new event type must not be able to resolve an
  // order by accident — in either direction.
  const kind: GatewayEventKind | 'unknown' = mapped ?? 'unknown';
  // The event id is the idempotency key. When a provider sends none, derive one from the bytes: a
  // replay is byte-identical, so the digest is a sound substitute.
  const eventId = (map.eventIdPath ? readStringPath(body, map.eventIdPath) : undefined) ?? `sha:${createHash('sha256').update(raw).digest('hex')}`;

  const amountMinor = map.amountMinorPath ? Number(readStringPath(body, map.amountMinorPath)) : undefined;
  const amountDecimal = map.amountDecimalPath ? readStringPath(body, map.amountDecimalPath) : undefined;
  const currency = map.currencyPath ? readStringPath(body, map.currencyPath)?.toUpperCase() : undefined;
  return {
    ok: true,
    verdict: {
      eventId,
      ref,
      kind,
      ...(amountMinor !== undefined && Number.isFinite(amountMinor) ? { amountMinor } : {}),
      ...(amountDecimal !== undefined ? { amountDecimal } : {}),
      ...(currency ? { currency } : {}),
    },
  };
}

/** PayPal's shape: ask the provider whether the signature it sent is its own. */
async function verifyRemote(
  gateway: PaymentGatewayStored,
  mode: PaymentMode,
  raw: Buffer,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  cred: Readonly<Record<string, string>>,
  io: ExecutorIo,
): Promise<boolean> {
  const v = gateway.verification;
  if (v.scheme !== 'remote-verify') return false;
  const header = (name: string): string => {
    // eslint-disable-next-line security/detect-object-injection -- fixed literal header names below
    const h = headers[name];
    const value = Array.isArray(h) ? h[0] : h;
    return typeof value === 'string' ? value : '';
  };
  const webhookId = Object.prototype.hasOwnProperty.call(cred, 'webhookId') ? cred.webhookId : undefined;
  // Fail CLOSED: with no webhook id there is nothing to verify against.
  if (!webhookId) return false;
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return false;
  }
  const url = buildUrl(gateway, mode, v.path);
  const payload = {
    auth_algo: header('paypal-auth-algo'),
    cert_url: header('paypal-cert-url'),
    transmission_id: header('paypal-transmission-id'),
    transmission_sig: header('paypal-transmission-sig'),
    transmission_time: header('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: body,
  };
  // ★ The cert URL is PayPal's, and the HOST never fetches it — PayPal does, inside its own verify
  // call. Fetching an attacker-supplied cert_url here would be a textbook SSRF.
  if (Object.values(payload).some((x) => x === '')) return false;
  try {
    const headersOut = { 'content-type': 'application/json', accept: 'application/json', ...(await authHeaders(gateway, mode, cred, io)) };
    const json = await callProvider(io, url, 'POST', headersOut, JSON.stringify(payload));
    return readStringPath(json, v.resultPath) === v.successValue;
  } catch {
    // An outage must not wave an event through. The provider will retry.
    return false;
  }
}

/** Reads a nested value for a caller that needs the raw JSON (e.g. a payer email). */
export { readPath, readStringPath };
