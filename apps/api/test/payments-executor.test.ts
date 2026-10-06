import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { PaymentGatewayStoredSchema, type PaymentGatewayStored } from '@sitewright/schema';
import {
  createCheckoutSession,
  fetchProviderStatus,
  interpretWebhook,
  originAllowed,
  GatewayError,
  type ExecutorIo,
  type FetchLike,
} from '../src/payments/executor.js';
import type { InterpolationScope } from '../src/payments/interpolate.js';
import { BUILTIN_GATEWAYS } from '../src/payments/builtin-gateways.js';

const NOW = 1_760_000_000_000;

/** A scripted provider: one canned response per call, plus a record of what was sent. */
function scriptedIo(responses: Array<{ ok?: boolean; status?: number; body: unknown }>): ExecutorIo & { calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> } {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    const r = responses[i] ?? responses[responses.length - 1]!;
    i += 1;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return { fetch, now: () => NOW, calls };
}

const gateway = (over: Partial<PaymentGatewayStored> = {}): PaymentGatewayStored =>
  PaymentGatewayStoredSchema.parse({
    id: 'acme',
    name: 'Acme',
    apiBase: { test: 'https://api-test.acme.test', live: 'https://api.acme.test' },
    auth: { kind: 'bearer', secretField: 'secretKey' },
    credentialFields: [
      { key: 'secretKey', label: 'Key', kind: 'secret' },
      { key: 'whsec', label: 'Webhook secret', kind: 'secret' },
    ],
    checkout: {
      request: { method: 'POST', path: '/v1/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}', currency: '${AMOUNT:currency}', ret: '${URL:return}' } },
      refPath: 'id',
      redirectUrlPath: 'url',
    },
    status: { request: { method: 'GET', path: '/v1/sessions/${TXN:reference}', format: 'json', headers: {} }, statePath: 'state', states: { paid: 'paid', open: 'recheck' } },
    verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'whsec' },
    events: { eventIdPath: 'event_id', refPath: 'session_id', typePath: 'type', types: { 'session.paid': 'paid' }, amountMinorPath: 'amount', currencyPath: 'currency' },
    allowedOrigins: ['https://api-test.acme.test', 'https://api.acme.test', 'https://pay.acme.test'],
    enabled: true,
    ...over,
  });

const scope: InterpolationScope = {
  cred: { secretKey: 'sk_test_abc', whsec: 'whsec_abc' },
  amount: { minor: 2498, decimal: '24.98', currency: 'EUR' },
  txn: { id: 'txn_1', publicToken: 'tok_1', reference: 'ref_1' },
  url: { return: 'https://shop.test/thank-you/', cancel: 'https://shop.test/cart/', webhook: 'https://sw.test/pay/p1/webhook/acme' },
  field: { name: 'Ada' },
  text: { order_name: '1x Mug' },
};

describe('originAllowed', () => {
  it('compares parsed origins, so case and a default port do not matter', () => {
    const gw = gateway();
    expect(originAllowed(gw, 'https://pay.acme.test/session/1')).toBe(true);
    expect(originAllowed(gw, 'https://PAY.ACME.TEST/session/1')).toBe(true);
    expect(originAllowed(gw, 'https://pay.acme.test:443/session/1')).toBe(true);
  });

  it('★★ refuses the lookalikes — this is the guard against a gateway redirecting a buyer', () => {
    const gw = gateway();
    for (const url of [
      'https://pay.acme.test.evil.test/x',   // suffix
      'https://evil.test/pay.acme.test',     // path, not host
      'https://pay.acme.test@evil.test/x',   // userinfo
      'http://pay.acme.test/x',              // not https
      'https://pay.acme.test:8443/x',        // different port
      'https://sub.pay.acme.test/x',         // subdomain
      '//pay.acme.test/x',                   // scheme-relative
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(originAllowed(gw, url), url).toBe(false);
    }
  });
});

describe('createCheckoutSession', () => {
  it('sends the interpolated request and returns ref + redirect', async () => {
    const io = scriptedIo([{ body: { id: 'sess_1', url: 'https://pay.acme.test/s/1' } }]);
    const session = await createCheckoutSession(gateway(), 'test', scope, io);
    expect(session).toEqual({ ref: 'sess_1', redirectUrl: 'https://pay.acme.test/s/1' });
    expect(io.calls[0]!.url).toBe('https://api-test.acme.test/v1/sessions');
    // ★ The `#` form produced a JSON NUMBER, and the amount is the platform's, not the cart's.
    expect(JSON.parse(io.calls[0]!.body!)).toEqual({ amount: 2498, currency: 'EUR', ret: 'https://shop.test/thank-you/' });
    expect(io.calls[0]!.headers.authorization).toBe('Bearer sk_test_abc');
  });

  it('★ uses the mode-specific base — test credentials never reach the live host', async () => {
    const io = scriptedIo([{ body: { id: 's', url: 'https://pay.acme.test/s' } }]);
    await createCheckoutSession(gateway(), 'live', scope, io);
    expect(io.calls[0]!.url).toBe('https://api.acme.test/v1/sessions');
  });

  it('★★ REFUSES a redirect URL on an unapproved origin, even from a genuine-looking response', async () => {
    // A compromised or mistaken gateway definition must not be able to send a customer to a
    // lookalike checkout and collect the payment itself.
    const io = scriptedIo([{ body: { id: 's', url: 'https://evil.test/checkout' } }]);
    await expect(createCheckoutSession(gateway(), 'test', scope, io)).rejects.toThrow(/unapproved origin/);
  });

  it('★ refuses a path template that tries to escape the approved host', async () => {
    const gw = gateway({
      checkout: { request: { method: 'POST', path: '/..//evil.test/x', format: 'json', headers: {} }, refPath: 'id', redirectUrlPath: 'url' },
    });
    const io = scriptedIo([{ body: { id: 's', url: 'https://pay.acme.test/s' } }]);
    // Either the URL resolves inside the base (fine) or it leaves it and is refused — never silently
    // sent somewhere else.
    const result = await createCheckoutSession(gw, 'test', scope, io).catch((e: unknown) => e);
    if (result instanceof Error) expect(result.message).toMatch(/approved origin/);
    else expect(io.calls[0]!.url.startsWith('https://api-test.acme.test/')).toBe(true);
  });

  it('form-encodes when the gateway declares it', async () => {
    const gw = gateway({
      checkout: { request: { method: 'POST', path: '/v1/sessions', format: 'form', headers: {}, body: { 'line[0][amt]': '${AMOUNT:minor}' } }, refPath: 'id', redirectUrlPath: 'url' },
    });
    const io = scriptedIo([{ body: { id: 's', url: 'https://pay.acme.test/s' } }]);
    await createCheckoutSession(gw, 'test', scope, io);
    expect(io.calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(io.calls[0]!.body).toBe('line%5B0%5D%5Bamt%5D=2498');
  });

  it('★ a missing credential is a CONFIG error, not an unauthenticated request', async () => {
    const io = scriptedIo([{ body: {} }]);
    const bare = { ...scope, cred: {} };
    const err = await createCheckoutSession(gateway(), 'test', bare, io).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).kind).toBe('config');
    // And nothing was sent — an anonymous call to a payment provider is never an improvement.
    expect(io.calls).toHaveLength(0);
  });

  it('★ an unknown template token is a config error, not a silently blanked field', async () => {
    const gw = gateway({
      checkout: { request: { method: 'POST', path: '/v1/sessions', format: 'json', headers: {}, body: { x: '${AMOUNT:bogus}' } }, refPath: 'id', redirectUrlPath: 'url' },
    });
    const err = await createCheckoutSession(gw, 'test', scope, scriptedIo([{ body: {} }])).catch((e: unknown) => e);
    expect((err as GatewayError).kind).toBe('config');
  });

  it('reports a provider rejection by STATUS only — never the body', async () => {
    const io = scriptedIo([{ ok: false, status: 402, body: { error: { message: 'sk_live_LEAKED_KEY in request' } } }]);
    const err = await createCheckoutSession(gateway(), 'test', scope, io).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(402);
    // A provider error body routinely echoes the request back, key included.
    expect((err as Error).message).not.toContain('LEAKED');
    expect((err as Error).message).toContain('402');
  });

  it('refuses a response missing the reference or the URL', async () => {
    await expect(createCheckoutSession(gateway(), 'test', scope, scriptedIo([{ body: { url: 'https://pay.acme.test/s' } }]))).rejects.toThrow(/session reference/);
    await expect(createCheckoutSession(gateway(), 'test', scope, scriptedIo([{ body: { id: 's' } }]))).rejects.toThrow(/checkout URL/);
  });

  it('refuses a non-JSON and an oversized response', async () => {
    await expect(createCheckoutSession(gateway(), 'test', scope, scriptedIo([{ body: '<html>down</html>' }]))).rejects.toThrow(/not JSON/);
    await expect(createCheckoutSession(gateway(), 'test', scope, scriptedIo([{ body: 'x'.repeat(600 * 1024) }]))).rejects.toThrow(/oversized/);
  });

  it('reports a network failure without the URL', async () => {
    const io: ExecutorIo = { now: () => NOW, fetch: async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:443'); } };
    const err = await createCheckoutSession(gateway(), 'test', scope, io).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('10.1.2.3');
    expect((err as GatewayError).kind).toBe('upstream');
  });

  it('performs an oauth2 token exchange, then uses the token', async () => {
    const gw = gateway({
      auth: { kind: 'oauth2-client-credentials', tokenPath: '/v1/oauth2/token', clientIdField: 'secretKey', clientSecretField: 'whsec', tokenPathInResponse: 'access_token' },
    });
    const io = scriptedIo([{ body: { access_token: 'tok_xyz' } }, { body: { id: 's', url: 'https://pay.acme.test/s' } }]);
    await createCheckoutSession(gw, 'test', scope, io);
    expect(io.calls[0]!.url).toBe('https://api-test.acme.test/v1/oauth2/token');
    expect(io.calls[0]!.body).toBe('grant_type=client_credentials');
    expect(io.calls[1]!.headers.authorization).toBe('Bearer tok_xyz');
  });

  it('refuses when the token exchange returns no token', async () => {
    const gw = gateway({ auth: { kind: 'oauth2-client-credentials', tokenPath: '/t', clientIdField: 'secretKey', clientSecretField: 'whsec', tokenPathInResponse: 'access_token' } });
    await expect(createCheckoutSession(gw, 'test', scope, scriptedIo([{ body: {} }]))).rejects.toThrow(/access token/);
  });
});

describe('fetchProviderStatus', () => {
  it('maps a declared state', async () => {
    const io = scriptedIo([{ body: { state: 'paid' } }]);
    expect(await fetchProviderStatus(gateway(), 'test', scope, io)).toEqual({ kind: 'paid', raw: 'paid' });
  });

  it('★ an UNKNOWN state is `recheck`, never paid and never failed', async () => {
    // A provider adding a state the record has not been taught about must leave the order alone.
    const io = scriptedIo([{ body: { state: 'something_new' } }]);
    expect(await fetchProviderStatus(gateway(), 'test', scope, io)).toEqual({ kind: 'recheck', raw: 'something_new' });
  });

  it('interpolates the reference into the path', async () => {
    const io = scriptedIo([{ body: { state: 'open' } }]);
    await fetchProviderStatus(gateway(), 'test', scope, io);
    expect(io.calls[0]!.url).toBe('https://api-test.acme.test/v1/sessions/ref_1');
  });

  it('refuses a gateway with no status template', async () => {
    const gw = PaymentGatewayStoredSchema.parse({ ...gateway(), status: undefined });
    await expect(fetchProviderStatus(gw, 'test', scope, scriptedIo([{ body: {} }]))).rejects.toThrow(/cannot report/);
  });
});

describe('interpretWebhook', () => {
  const body = Buffer.from(JSON.stringify({ event_id: 'evt_1', session_id: 'sess_1', type: 'session.paid', amount: 2498, currency: 'EUR' }), 'utf8');
  const sig = (b: Buffer, secret = 'whsec_abc') => createHmac('sha256', secret).update(b).digest('hex');
  const io = scriptedIo([{ body: {} }]);

  it('verifies, then maps to a verdict carrying the claimed amount', async () => {
    const r = await interpretWebhook(gateway(), 'test', body, { 'x-sig': sig(body) }, scope.cred, io);
    expect(r).toEqual({ ok: true, verdict: { eventId: 'evt_1', ref: 'sess_1', kind: 'paid', amountMinor: 2498, currency: 'EUR' } });
  });

  it('★ refuses a bad signature before it ever looks at the body', async () => {
    const r = await interpretWebhook(gateway(), 'test', body, { 'x-sig': sig(body, 'wrong') }, scope.cred, io);
    expect(r).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('★ an UNMAPPED event type is `unknown` — not a guess in either direction', async () => {
    const other = Buffer.from(JSON.stringify({ event_id: 'e', session_id: 's', type: 'session.whatever' }), 'utf8');
    const r = await interpretWebhook(gateway(), 'test', other, { 'x-sig': sig(other) }, scope.cred, io);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verdict.kind).toBe('unknown');
  });

  it('refuses a verified event with no reference — there is nothing to tie it to', async () => {
    const noRef = Buffer.from(JSON.stringify({ event_id: 'e', type: 'session.paid' }), 'utf8');
    const r = await interpretWebhook(gateway(), 'test', noRef, { 'x-sig': sig(noRef) }, scope.cred, io);
    expect(r).toEqual({ ok: false, reason: 'no-ref' });
  });

  it('refuses a verified body that is not JSON', async () => {
    const junk = Buffer.from('not json', 'utf8');
    const r = await interpretWebhook(gateway(), 'test', junk, { 'x-sig': sig(junk) }, scope.cred, io);
    expect(r).toEqual({ ok: false, reason: 'malformed-body' });
  });

  it('★ derives an idempotency key from the BYTES when a provider sends no event id', async () => {
    // A replay is byte-identical, so the digest is a sound substitute — Mollie sends no event id.
    const gw = gateway({ events: { refPath: 'id', types: {}, defaultKind: 'recheck' } });
    const mollieBody = Buffer.from(JSON.stringify({ id: 'tr_1' }), 'utf8');
    const r = await interpretWebhook(gw, 'test', mollieBody, { 'x-sig': sig(mollieBody) }, scope.cred, io);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verdict.eventId).toMatch(/^sha:[0-9a-f]{64}$/);
      // ★ And Mollie's verdict is `recheck`, NOT paid: its body is only an id, so treating it as a
      // payment would accept an unpaid order on an attacker's say-so.
      expect(r.verdict.kind).toBe('recheck');
    }
  });

  it('fails closed when the webhook secret is absent', async () => {
    const r = await interpretWebhook(gateway(), 'test', body, { 'x-sig': sig(body) }, { secretKey: 'sk' }, io);
    expect(r).toEqual({ ok: false, reason: 'no-secret' });
  });
});

describe('remote-verify (PayPal shape)', () => {
  const paypal = BUILTIN_GATEWAYS.find((g) => g.id === 'paypal')!;
  const body = Buffer.from(JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'cap_1', amount: { value: '24.98', currency_code: 'EUR' } } }), 'utf8');
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.paypal.com/cert.pem',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-10-06T00:00:00Z',
  };
  const cred = { clientId: 'cid', clientSecret: 'csec', webhookId: 'WH_CFG' };

  it('asks the provider and accepts a SUCCESS verdict', async () => {
    const io = scriptedIo([{ body: { access_token: 't' } }, { body: { verification_status: 'SUCCESS' } }]);
    const r = await interpretWebhook(paypal, 'live', body, headers, cred, io);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verdict.kind).toBe('paid');
    // ★ The platform NEVER fetches cert_url itself — PayPal does, inside its own verify call. A host
    // that fetched an attacker-supplied cert_url would be a textbook SSRF.
    expect(io.calls.every((c) => !c.url.includes('cert.pem'))).toBe(true);
  });

  it('★ refuses anything other than SUCCESS', async () => {
    const io = scriptedIo([{ body: { access_token: 't' } }, { body: { verification_status: 'FAILURE' } }]);
    expect(await interpretWebhook(paypal, 'live', body, headers, cred, io)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('★ fails closed with no webhook id configured, and sends nothing', async () => {
    const io = scriptedIo([{ body: {} }]);
    expect(await interpretWebhook(paypal, 'live', body, headers, { clientId: 'c', clientSecret: 's' }, io)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(io.calls).toHaveLength(0);
  });

  it('★ fails closed when a signature header is missing, and sends nothing', async () => {
    const io = scriptedIo([{ body: {} }]);
    const partial = { ...headers, 'paypal-transmission-sig': undefined };
    expect(await interpretWebhook(paypal, 'live', body, partial, cred, io)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(io.calls).toHaveLength(0);
  });

  it('★ a provider OUTAGE does not wave the event through', async () => {
    const io: ExecutorIo = { now: () => NOW, fetch: async () => { throw new Error('ECONNRESET'); } };
    expect(await interpretWebhook(paypal, 'live', body, headers, cred, io)).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('★ every built-in gateway is internally consistent', () => {
  it('names only credential fields it declares, and keeps its bases inside its approved origins', () => {
    for (const gw of BUILTIN_GATEWAYS) {
      const keys = new Set(gw.credentialFields.map((f) => f.key));
      if (gw.verification.scheme !== 'remote-verify') expect(keys, gw.id).toContain(gw.verification.secretField);
      if (gw.auth.kind === 'bearer') expect(keys, gw.id).toContain(gw.auth.secretField);
      if (gw.auth.kind === 'oauth2-client-credentials') {
        expect(keys, gw.id).toContain(gw.auth.clientIdField);
        expect(keys, gw.id).toContain(gw.auth.clientSecretField);
      }
      for (const base of Object.values(gw.apiBase)) {
        expect(originAllowed(gw, base as string), `${gw.id} ${String(base)}`).toBe(true);
      }
    }
  });

  it('★ ships DISABLED and UNVERIFIED — an upgrade gains options, not a live payment surface', () => {
    for (const gw of BUILTIN_GATEWAYS) {
      expect(gw.enabled, gw.id).toBe(false);
      expect(gw.verified, gw.id).toBe(false);
      expect(gw.builtin, gw.id).toBe(true);
    }
  });

  it('★ the mock gateway cannot become a live payment surface', () => {
    const mock = BUILTIN_GATEWAYS.find((g) => g.id === 'mock')!;
    // Its live base is an unresolvable host, so a mis-click cannot take real money.
    expect(mock.apiBase.live).toContain('.invalid');
  });
});
