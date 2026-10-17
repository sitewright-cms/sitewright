import { describe, it, expect } from 'vitest';
import { PaymentGatewayInputSchema, GATEWAY_PLACEHOLDERS } from '@sitewright/schema';
import { BUILTIN_GATEWAYS } from '../src/payments/builtin-gateways.js';
import { interpolateString, type InterpolationScope } from '../src/payments/interpolate.js';

const SCOPE: InterpolationScope = {
  cred: { apiKey: 'k' },
  amount: { minor: 100, decimal: '1.00', currency: 'EUR' },
  txn: { id: 't', publicToken: 'p', reference: 'r' },
  url: { return: 'https://r', cancel: 'https://c', webhook: 'https://w' },
  field: {},
  text: {},
};

/** A valid custom definition to vary — the shape the input schema demands. */
const BASE = {
  id: 'acme',
  name: 'Acme Pay',
  apiBase: { test: 'https://api.acme.example', live: 'https://api.acme.example' },
  auth: { kind: 'bearer', secretField: 'apiKey' },
  credentialFields: [
    { key: 'apiKey', label: 'API key', kind: 'secret', required: true, perMode: true },
    { key: 'whsec', label: 'Webhook secret', kind: 'secret', required: true, perMode: true },
    { key: 'merchantId', label: 'Merchant id', kind: 'public', required: true, perMode: true },
  ],
  checkout: {
    request: { method: 'POST', path: '/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}', ref: '${TXN:reference}' } },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'whsec' },
  events: { refPath: 'id', types: {}, defaultKind: 'paid' },
  allowedOrigins: ['https://api.acme.example'],
};
const withBody = (body: unknown, extra: Record<string, unknown> = {}) => ({ ...BASE, checkout: { ...BASE.checkout, request: { ...BASE.checkout.request, body, ...extra } } });
const messages = (input: unknown): string[] => {
  const r = PaymentGatewayInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('a gateway definition is checked where an agent can still fix it', () => {
  it('★ every built-in survives the round trip an agent makes: fork it, then write it back', () => {
    // fork_gateway_definition copies a built-in; put_gateway_definition sends it through the STRICT
    // input schema. A built-in that failed it would make "start from the closest one" a dead end.
    for (const builtin of BUILTIN_GATEWAYS) {
      expect(messages({ ...builtin, id: `${builtin.id}_copy` }), builtin.id).toEqual([]);
    }
  });

  it('accepts every placeholder the host substitutes', () => {
    expect(messages(BASE)).toEqual([]);
    expect(messages(withBody({ a: '${AMOUNT:currency_lower}', b: 'Order ${TEXT:order_name} for ${FIELD:email}', c: '${URL:webhook}', d: '${CRED:merchantId}' }))).toEqual([]);
  });

  it('refuses a placeholder the host would send as literal text, or reject only at checkout', () => {
    expect(messages(withBody({ a: '${cred:apiKey}' }))[0]).toMatch(/is not a placeholder/);
    expect(messages(withBody({ a: '${ CRED:apiKey }' }))[0]).toMatch(/is not a placeholder/);
    expect(messages(withBody({ a: '${CRED:secretKey}' }))[0]).toMatch(/not declared in credentialFields/);
    expect(messages(withBody({ a: '${AMOUNT:cents}' }))[0]).toMatch(/is not one of \$\{AMOUNT:minor\}/);
    expect(messages(withBody({ a: '${TXN:providerRef}' }))[0]).toMatch(/TXN/);
    expect(messages(withBody({ a: '${SECRET:x}' }))[0]).toMatch(/unknown namespace/);
    // The number form is honoured only as a whole body value.
    expect(messages(withBody({ a: 'total ${#AMOUNT:minor}' }))[0]).toMatch(/whole body value/);
    expect(messages(withBody({}, { path: '/s/${#AMOUNT:minor}' }))[0]).toMatch(/whole body value/);
    // Headers and paths are checked too, and the message names where.
    expect(messages(withBody({}, { headers: { authorization: 'Bearer ${CRED:missing}' } }))[0]).toMatch(/^checkout\.request\.headers:/);
  });

  it('★ a SECRET never goes in a body or a path — the provider may print it on its own checkout page', () => {
    // A whole-value secret in a display field is exactly what a buyer would read off the hosted page.
    for (const body of [{ description: '${CRED:apiKey}' }, { product_data: { name: '${CRED:apiKey}' } }, { merchant_key: '${CRED:whsec}' }]) {
      expect(messages(withBody(body)).join(' '), JSON.stringify(body)).toMatch(/is a secret field, and a secret never goes in a request body/);
    }
    expect(messages(withBody({}, { path: '/s/${CRED:apiKey}' })).join(' ')).toMatch(/secret field and may not be in a path/);
    // Headers are how real providers take a secret (and `auth`, which every built-in uses).
    for (const value of ['${CRED:apiKey}', 'Bearer ${CRED:apiKey}', 'Basic ${CRED:apiKey}', 'Token ${CRED:apiKey}']) {
      expect(messages(withBody({}, { headers: { authorization: value } })), value).toEqual([]);
    }
  });

  it('★ a non-secret key is a whole body value or a path segment — never inside other text, a name, or a query', () => {
    expect(messages(withBody({ merchant: '${CRED:merchantId}' }))).toEqual([]);
    expect(messages(withBody({}, { path: '/merchants/${CRED:merchantId}/sessions' }))).toEqual([]);
    expect(messages(withBody({ success_url: 'https://evil.example/?k=${CRED:merchantId}' })).join(' ')).toMatch(/WHOLE body value/);
    expect(messages(withBody({ success_url: '${URL:return}&k=${CRED:merchantId}' })).join(' ')).toMatch(/WHOLE body value/);
    expect(messages(withBody({ nested: [{ note: 'id ${CRED:merchantId}' }] })).join(' ')).toMatch(/WHOLE body value/);
    expect(messages(withBody({ '${CRED:merchantId}': 'x' })).join(' ')).toMatch(/body field NAME/);
    expect(messages(withBody({}, { path: '/s?m=${CRED:merchantId}' })).join(' ')).toMatch(/not be in a query string/);
  });

  it('★ a header carries a key only alone or after a fixed scheme — never next to a buyer\'s field', () => {
    expect(messages(withBody({}, { headers: { 'x-callback': '${FIELD:cb}?k=${CRED:apiKey}' } })).join(' ')).toMatch(/puts a key next to other text/);
    expect(messages(withBody({}, { headers: { 'x-key': 'k=${CRED:apiKey}' } })).join(' ')).toMatch(/puts a key next to other text/);
    expect(messages(withBody({}, { headers: { 'x-${CRED:apiKey}': 'v' } })).join(' ')).toMatch(/header NAME/);
  });

  it('★ a literal address in a template must be one of the provider\'s own allowed origins', () => {
    expect(messages(withBody({ webhook: 'https://evil.example/hook' })).join(' ')).toMatch(/not on allowedOrigins/);
    expect(messages(withBody({}, { headers: { 'x-callback': 'https://evil.example' } })).join(' ')).toMatch(/not on allowedOrigins/);
    // In a path query too, and scheme-relative.
    expect(messages(withBody({}, { path: '/s?return=https://evil.example' })).join(' ')).toMatch(/not on allowedOrigins/);
    expect(messages(withBody({ cancel_url: '//evil.example/x' })).join(' ')).toMatch(/not on allowedOrigins/);
    expect(messages(withBody({}, { path: '/s?return=//evil.example' })).join(' ')).toMatch(/not on allowedOrigins/);
    // A doubled slash inside a path is not an address.
    expect(messages(withBody({}, { path: '/v1//sessions' }))).toEqual([]);
    expect(messages(withBody({ terms: 'https://API.acme.example/terms' }))).toEqual([]);
    // The shop's own addresses come from the host.
    expect(messages(withBody({ return_url: '${URL:return}', notify: '${URL:webhook}' }))).toEqual([]);
  });

  it('★ the fields that sign webhooks and requests must be secret fields', () => {
    const publicSigner = {
      ...BASE,
      credentialFields: [BASE.credentialFields[0], { key: 'whsec', label: 'Webhook secret', kind: 'public', required: true, perMode: true }],
    };
    expect(messages(publicSigner).join(' ')).toMatch(/"whsec" signs or authenticates requests, so it must be a secret field/);
    const publicAuth = {
      ...BASE,
      credentialFields: [{ key: 'apiKey', label: 'API key', kind: 'public', required: true, perMode: true }, BASE.credentialFields[1]],
    };
    expect(messages(publicAuth).join(' ')).toMatch(/"apiKey" signs or authenticates/);
  });

  it('refuses a private, loopback or local host — but not a public name that merely starts like one', () => {
    for (const host of ['https://localhost', 'https://localhost.', 'https://127.0.0.1', 'https://10.0.0.5', 'https://[::1]', 'https://pay.internal', 'https://metadata.google.internal.', 'https://printer.local', 'https://intranet']) {
      expect(messages({ ...BASE, apiBase: { test: host, live: host }, allowedOrigins: [host] }).join(' '), host).toMatch(/not a public host/);
    }
    const lookalike = 'https://fdpay.example';
    expect(messages({ ...BASE, apiBase: { test: lookalike, live: lookalike }, allowedOrigins: [lookalike] })).toEqual([]);
  });

  it('★ the lint and the interpolator agree on every key — neither may drift from the other', () => {
    for (const [ns, keys] of Object.entries(GATEWAY_PLACEHOLDERS)) {
      for (const key of keys ?? ['anything']) {
        const token = ns === 'CRED' ? '${CRED:apiKey}' : `\${${ns}:${key}}`;
        expect(() => interpolateString(token, SCOPE), token).not.toThrow();
      }
    }
    // And an interpolator namespace the lint does not know would be refused at write time: probe it.
    expect(() => interpolateString('${NOPE:x}', SCOPE)).toThrow();
  });
});
