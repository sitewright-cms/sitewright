import type { PaymentGatewayStored } from '@sitewright/schema';

/**
 * BUILT-IN GATEWAY DEFINITIONS — read-only records that an admin FORKS to edit.
 *
 * ★ These are DATA, not code. Each one is exactly what an admin could have typed into the UI (or an
 * agent written over MCP), which is the point: the reference implementations and an operator's own
 * gateways are the same kind of thing, so there is no privileged path a custom gateway cannot reach.
 *
 * ★ They ship DISABLED and UNVERIFIED. A gateway cannot take live money until a test-mode checkout
 * has actually succeeded against it, so an instance that merely upgraded has gained three options
 * and no live payment surface.
 *
 * The three are deliberately different shapes, because an interface that fits only one is generic by
 * assertion rather than in fact:
 *   - Stripe signs the whole event with a timestamp inside the header;
 *   - PayPal needs a token exchange, then verifies its signature over an API CALL;
 *   - Mollie's webhook carries only an id, so a verified event means "go and ask", not "it is paid".
 */

/** Stripe Checkout Sessions. Form-encoded request; `hmac-timestamped` webhook. */
const stripe: PaymentGatewayStored = {
  id: 'stripe',
  name: 'Stripe Checkout',
  description: 'Hosted Stripe Checkout session. Cards, wallets and local methods, with a real test mode.',
  kind: 'declarative',
  // Stripe uses one host for both modes and distinguishes them by the key, so both bases are equal.
  // Keeping the field per-mode anyway means the test/live distinction is never implicit.
  apiBase: { test: 'https://api.stripe.com', live: 'https://api.stripe.com' },
  auth: { kind: 'bearer', secretField: 'secretKey' },
  credentialFields: [
    {
      key: 'secretKey',
      label: 'Secret key',
      kind: 'secret',
      required: true,
      perMode: true,
      hint: 'Stripe dashboard → Developers → API keys. The TEST key starts sk_test_, the live key sk_live_.',
      docsUrl: 'https://dashboard.stripe.com/apikeys',
      modePrefix: { test: 'sk_test_', live: 'sk_live_' },
    },
    {
      key: 'webhookSecret',
      label: 'Webhook signing secret',
      kind: 'secret',
      required: true,
      perMode: true,
      hint: 'Shown once when you add the endpoint URL in Stripe → Developers → Webhooks. Starts whsec_.',
      modePrefix: { test: 'whsec_', live: 'whsec_' },
    },
  ],
  checkout: {
    request: {
      method: 'POST',
      path: '/v1/checkout/sessions',
      // Stripe's API is form-encoded, including its bracketed array notation.
      format: 'form',
      headers: {},
      body: {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': '${AMOUNT:currency_lower}',
        'line_items[0][price_data][unit_amount]': '${AMOUNT:minor}',
        'line_items[0][price_data][product_data][name]': '${TEXT:order_name}',
        success_url: '${URL:return}',
        cancel_url: '${URL:cancel}',
        client_reference_id: '${TXN:reference}',
        'metadata[sw_txn]': '${TXN:id}',
      },
    },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  status: {
    request: { method: 'GET', path: '/v1/checkout/sessions/${TXN:reference}', format: 'json', headers: {} },
    statePath: 'payment_status',
    states: { paid: 'paid', unpaid: 'recheck', no_payment_required: 'paid' },
  },
  verification: {
    scheme: 'hmac-timestamped',
    header: 'stripe-signature',
    timestampKey: 't',
    signatureKey: 'v1',
    toleranceSeconds: 300,
    secretField: 'webhookSecret',
  },
  events: {
    eventIdPath: 'id',
    refPath: 'data.object.id',
    typePath: 'type',
    types: {
      'checkout.session.completed': 'paid',
      'checkout.session.async_payment_succeeded': 'paid',
      'checkout.session.async_payment_failed': 'failed',
      'checkout.session.expired': 'expired',
      'charge.refunded': 'refunded',
    },
    amountMinorPath: 'data.object.amount_total',
    currencyPath: 'data.object.currency',
  },
  refund: {
    request: { method: 'POST', path: '/v1/refunds', format: 'form', headers: {}, body: { payment_intent: '${TXN:reference}', amount: '${AMOUNT:minor}' } },
  },
  allowedOrigins: ['https://api.stripe.com', 'https://checkout.stripe.com'],
  verified: false,
  enabled: false,
  builtin: true,
};

/**
 * PayPal Orders v2.
 *
 * ★ The shape that proves the interface: its webhook signature can only be checked by asking PayPal,
 * so `verification` is `remote-verify` and the host performs the call. A declarative record cannot
 * and must not do that itself.
 */
const paypal: PaymentGatewayStored = {
  id: 'paypal',
  name: 'PayPal',
  description: 'PayPal hosted approval. Separate sandbox and live hosts, and a server-side webhook verification call.',
  kind: 'declarative',
  apiBase: { test: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' },
  auth: {
    kind: 'oauth2-client-credentials',
    tokenPath: '/v1/oauth2/token',
    clientIdField: 'clientId',
    clientSecretField: 'clientSecret',
    tokenPathInResponse: 'access_token',
  },
  credentialFields: [
    { key: 'clientId', label: 'Client ID', kind: 'public', required: true, perMode: true, hint: 'PayPal Developer → Apps & Credentials. Sandbox and live apps have different IDs.' },
    { key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true, perMode: true },
    { key: 'webhookId', label: 'Webhook ID', kind: 'public', required: true, perMode: true, hint: 'The ID PayPal assigns after you add the webhook URL. Required to verify an event.' },
  ],
  checkout: {
    request: {
      method: 'POST',
      path: '/v2/checkout/orders',
      format: 'json',
      headers: {},
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: '${TXN:id}',
            invoice_id: '${TXN:reference}',
            // PayPal takes a DECIMAL string, not minor units — which is exactly why the amount is
            // offered in both shapes rather than the host guessing.
            amount: { currency_code: '${AMOUNT:currency}', value: '${AMOUNT:decimal}' },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              return_url: '${URL:return}',
              cancel_url: '${URL:cancel}',
            },
          },
        },
      },
    },
    refPath: 'id',
    // The approval URL is one entry of a links array, so the path indexes into it.
    redirectUrlPath: 'links[1].href',
  },
  status: {
    request: { method: 'GET', path: '/v2/checkout/orders/${TXN:reference}', format: 'json', headers: {} },
    statePath: 'status',
    states: { COMPLETED: 'paid', APPROVED: 'recheck', CREATED: 'recheck', VOIDED: 'cancelled', PAYER_ACTION_REQUIRED: 'recheck' },
  },
  verification: {
    scheme: 'remote-verify',
    path: '/v1/notifications/verify-webhook-signature',
    resultPath: 'verification_status',
    successValue: 'SUCCESS',
  },
  events: {
    eventIdPath: 'id',
    refPath: 'resource.id',
    typePath: 'event_type',
    types: {
      'CHECKOUT.ORDER.APPROVED': 'recheck',
      'CHECKOUT.ORDER.COMPLETED': 'paid',
      'PAYMENT.CAPTURE.COMPLETED': 'paid',
      'PAYMENT.CAPTURE.DENIED': 'failed',
      'PAYMENT.CAPTURE.REFUNDED': 'refunded',
    },
    amountDecimalPath: 'resource.amount.value',
    currencyPath: 'resource.amount.currency_code',
  },
  allowedOrigins: ['https://api-m.sandbox.paypal.com', 'https://api-m.paypal.com', 'https://www.sandbox.paypal.com', 'https://www.paypal.com'],
  verified: false,
  enabled: false,
  builtin: true,
};

/**
 * Mollie.
 *
 * ★ The third shape, and the one the `recheck` verdict exists for: Mollie's webhook body is just an
 * id. A verified Mollie webhook means "something changed, go and ask" — never "this is paid" — so
 * mapping it to `paid` would accept an unpaid order on an attacker's say-so.
 */
const mollie: PaymentGatewayStored = {
  id: 'mollie',
  name: 'Mollie',
  description: 'European methods (iDEAL, Bancontact, SEPA, cards). Its webhook carries only an id, so status is re-fetched.',
  kind: 'declarative',
  apiBase: { test: 'https://api.mollie.com', live: 'https://api.mollie.com' },
  auth: { kind: 'bearer', secretField: 'apiKey' },
  credentialFields: [
    {
      key: 'apiKey',
      label: 'API key',
      kind: 'secret',
      required: true,
      perMode: true,
      hint: 'Mollie dashboard → Developers → API keys. The mode is carried by the key itself.',
      modePrefix: { test: 'test_', live: 'live_' },
    },
  ],
  checkout: {
    request: {
      method: 'POST',
      path: '/v2/payments',
      format: 'json',
      headers: {},
      body: {
        amount: { currency: '${AMOUNT:currency}', value: '${AMOUNT:decimal}' },
        description: '${TEXT:order_name}',
        redirectUrl: '${URL:return}',
        cancelUrl: '${URL:cancel}',
        webhookUrl: '${URL:webhook}',
        metadata: { sw_txn: '${TXN:id}' },
      },
    },
    refPath: 'id',
    redirectUrlPath: '_links.checkout.href',
  },
  status: {
    request: { method: 'GET', path: '/v2/payments/${TXN:reference}', format: 'json', headers: {} },
    statePath: 'status',
    states: {
      paid: 'paid',
      failed: 'failed',
      canceled: 'cancelled',
      expired: 'expired',
      open: 'recheck',
      pending: 'recheck',
      authorized: 'recheck',
    },
  },
  // Mollie signs with a plain body HMAC when webhook signing is enabled.
  verification: { scheme: 'hmac-sha256-header', header: 'x-mollie-signature', encoding: 'hex', secretField: 'apiKey' },
  events: {
    refPath: 'id',
    // ★ No typePath: the body has no event type at all. Hence defaultKind `recheck`.
    types: {},
    defaultKind: 'recheck',
  },
  refund: {
    request: { method: 'POST', path: '/v2/payments/${TXN:reference}/refunds', format: 'json', headers: {}, body: { amount: { currency: '${AMOUNT:currency}', value: '${AMOUNT:decimal}' } } },
  },
  allowedOrigins: ['https://api.mollie.com', 'https://www.mollie.com'],
  verified: false,
  enabled: false,
  builtin: true,
};

/**
 * A gateway that talks to nothing — the one the test suite and an operator's first dry run use.
 *
 * ★ It exists so the WHOLE pipeline can be exercised without a provider account: create a session,
 * receive a signed webhook, verify it, advance the transaction, commit stock, send both emails. It
 * is `test`-only by construction: its live apiBase points at a host that does not resolve, so a
 * mis-click cannot turn it into a live payment surface.
 */
const mock: PaymentGatewayStored = {
  id: 'mock',
  name: 'Mock gateway (testing only)',
  description: 'Takes no real money. Exercises the full checkout, webhook and notification path for a dry run.',
  kind: 'declarative',
  apiBase: { test: 'https://mock-pay.invalid', live: 'https://mock-pay.invalid' },
  auth: { kind: 'bearer', secretField: 'apiKey' },
  credentialFields: [
    { key: 'apiKey', label: 'API key', kind: 'secret', required: true, perMode: true, hint: 'Any value. This gateway contacts nothing.' },
    { key: 'webhookSecret', label: 'Webhook secret', kind: 'secret', required: true, perMode: true, hint: 'Used to sign the simulated webhook.' },
  ],
  checkout: {
    request: {
      method: 'POST',
      path: '/sessions',
      format: 'json',
      headers: {},
      body: { amount: '${#AMOUNT:minor}', currency: '${AMOUNT:currency}', reference: '${TXN:reference}', return_url: '${URL:return}' },
    },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  status: {
    request: { method: 'GET', path: '/sessions/${TXN:reference}', format: 'json', headers: {} },
    statePath: 'state',
    states: { paid: 'paid', failed: 'failed', open: 'recheck' },
  },
  verification: { scheme: 'hmac-sha256-header', header: 'x-mock-signature', encoding: 'hex', secretField: 'webhookSecret' },
  events: {
    eventIdPath: 'event_id',
    refPath: 'session_id',
    typePath: 'type',
    types: { 'session.paid': 'paid', 'session.failed': 'failed', 'session.expired': 'expired', 'session.refunded': 'refunded' },
    amountMinorPath: 'amount',
    currencyPath: 'currency',
  },
  allowedOrigins: ['https://mock-pay.invalid'],
  verified: false,
  enabled: false,
  builtin: true,
};

/** Every built-in, by id. Read-only: writes go to a FORK. */
export const BUILTIN_GATEWAYS: readonly PaymentGatewayStored[] = Object.freeze([stripe, paypal, mollie, mock]);

export const BUILTIN_GATEWAY_IDS: ReadonlySet<string> = new Set(BUILTIN_GATEWAYS.map((g) => g.id));

/** True when `id` names a built-in, which may be forked but never edited or deleted in place. */
export function isBuiltinGateway(id: string): boolean {
  return BUILTIN_GATEWAY_IDS.has(id);
}
