import { describe, it, expect } from 'vitest';
import {
  CurrencyCodeSchema,
  minorUnitExponent,
  toMinorUnits,
  fromMinorUnits,
  MAX_MINOR_AMOUNT,
  PaymentGatewayInputSchema,
  PaymentGatewayStoredSchema,
  PaymentBindingStoredSchema,
  PaymentBindingInputSchema,
  toPublicGateway,
  maskBinding,
  validateCredentialValue,
  isSafeFieldPattern,
  canTransitionPayment,
  FULFILMENT_TRANSITIONS,
  composeAmounts,
  ShopPricingSchema,
  TRANSACTION_STATUSES,
  type CredentialField,
  type PaymentGatewayStored,
  type TransactionLine,
} from '../src/payments.js';

// ---------------------------------------------------------------------------------------------
// Money. Every case here is one a wrong answer would charge a real buyer the wrong amount.
// ---------------------------------------------------------------------------------------------

describe('minor units', () => {
  it('uses the ISO exponent, not a default of 2', () => {
    expect(minorUnitExponent('EUR')).toBe(2);
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KRW')).toBe(0);
    expect(minorUnitExponent('BHD')).toBe(3);
    expect(minorUnitExponent('TND')).toBe(3);
  });

  it('is case- and whitespace-insensitive, and falls back to 2 for an unknown code', () => {
    expect(minorUnitExponent(' jpy ')).toBe(0);
    expect(minorUnitExponent('ZZZ')).toBe(2);
  });

  it('converts exact decimals', () => {
    expect(toMinorUnits('19.99', 'EUR')).toEqual({ ok: true, minor: 1999 });
    expect(toMinorUnits('19.9', 'EUR')).toEqual({ ok: true, minor: 1990 });
    expect(toMinorUnits('19', 'EUR')).toEqual({ ok: true, minor: 1900 });
    expect(toMinorUnits('0', 'EUR')).toEqual({ ok: true, minor: 0 });
    expect(toMinorUnits('0.05', 'EUR')).toEqual({ ok: true, minor: 5 });
  });

  it('treats trailing zeros as representable, not as over-precision', () => {
    // `19.9900` IS exactly 1999 minor units. Rejecting it would fail a perfectly ordinary price.
    expect(toMinorUnits('19.9900', 'EUR')).toEqual({ ok: true, minor: 1999 });
    expect(toMinorUnits('5.000', 'JPY')).toEqual({ ok: true, minor: 5 });
  });

  it('★ REJECTS a price it cannot represent exactly, rather than rounding it', () => {
    // The whole point: 19.999 is neither 19.99 nor 20.00, and silently choosing one charges an
    // amount that appears nowhere in the project.
    expect(toMinorUnits('19.999', 'EUR')).toEqual({ ok: false, reason: 'not-representable', decimals: 3, allowed: 2 });
    expect(toMinorUnits('1.5', 'JPY')).toEqual({ ok: false, reason: 'not-representable', decimals: 1, allowed: 0 });
  });

  it('accepts three decimals only where the currency has three', () => {
    expect(toMinorUnits('1.234', 'BHD')).toEqual({ ok: true, minor: 1234 });
    expect(toMinorUnits('1.234', 'EUR')).toMatchObject({ ok: false, reason: 'not-representable' });
  });

  it('rejects everything that is not a plain decimal', () => {
    for (const bad of ['', ' ', 'abc', '1e3', '0x10', '1,99', '+1.00', '1.2.3', '.5', '1.', 'Infinity', 'NaN']) {
      expect(toMinorUnits(bad, 'EUR').ok, bad).toBe(false);
    }
  });

  it('★ distinguishes a negative price from garbage, so the publish error can say which', () => {
    expect(toMinorUnits('-1.00', 'EUR')).toEqual({ ok: false, reason: 'negative' });
    expect(toMinorUnits('nope', 'EUR')).toEqual({ ok: false, reason: 'not-a-number' });
  });

  it('bounds the magnitude before it can become Infinity', () => {
    expect(toMinorUnits('9'.repeat(40), 'EUR')).toEqual({ ok: false, reason: 'too-large' });
    expect(toMinorUnits(String(MAX_MINOR_AMOUNT), 'EUR')).toEqual({ ok: false, reason: 'too-large' });
    // A leading-zero run is not magnitude.
    expect(toMinorUnits('0000019.99', 'EUR')).toEqual({ ok: true, minor: 1999 });
  });

  it('round-trips through fromMinorUnits', () => {
    for (const [v, c] of [['19.99', 'EUR'], ['5', 'JPY'], ['1.234', 'BHD'], ['0', 'USD']] as const) {
      const r = toMinorUnits(v, c);
      expect(r.ok).toBe(true);
      if (r.ok) expect(toMinorUnits(fromMinorUnits(r.minor, c), c)).toEqual({ ok: true, minor: r.minor });
    }
    expect(fromMinorUnits(1999, 'EUR')).toBe('19.99');
    expect(fromMinorUnits(5, 'JPY')).toBe('5');
    expect(fromMinorUnits(1234, 'BHD')).toBe('1.234');
    expect(fromMinorUnits(5, 'EUR')).toBe('0.05');
    expect(fromMinorUnits(0, 'EUR')).toBe('0.00');
  });

  it('validates the currency code shape', () => {
    expect(CurrencyCodeSchema.safeParse('EUR').success).toBe(true);
    expect(CurrencyCodeSchema.safeParse(' EUR ').success).toBe(true); // trimmed
    for (const bad of ['eur', 'EU', 'EURO', 'E1R', '']) expect(CurrencyCodeSchema.safeParse(bad).success, bad).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Pricing composition
// ---------------------------------------------------------------------------------------------

const line = (unitMinor: number, qty = 1): TransactionLine => ({ sku: 's' + unitMinor, name: 'n', unitMinor, qty, lineMinor: unitMinor * qty });

describe('composeAmounts', () => {
  it('sums lines with no pricing config', () => {
    expect(composeAmounts([line(1000), line(250, 2)], undefined)).toEqual({ subtotalMinor: 1500, shippingMinor: 0, taxMinor: 0, totalMinor: 1500 });
  });

  it('adds flat shipping and waives it over the threshold', () => {
    const p = ShopPricingSchema.parse({ shipping: { flatMinor: 499, freeOverMinor: 5000 } });
    expect(composeAmounts([line(1000)], p).shippingMinor).toBe(499);
    expect(composeAmounts([line(5000)], p).shippingMinor).toBe(0);
    // At exactly the threshold shipping is free — "free over 50" reading as 49.99 would be a surprise.
    expect(composeAmounts([line(4999)], p).shippingMinor).toBe(499);
  });

  it('never charges shipping on an empty order', () => {
    const p = ShopPricingSchema.parse({ shipping: { flatMinor: 499 } });
    expect(composeAmounts([], p)).toEqual({ subtotalMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 0 });
  });

  it('★ inclusive tax backs the tax out and leaves the total unchanged', () => {
    const p = ShopPricingSchema.parse({ tax: { rateBp: 1900, mode: 'inclusive' } });
    const a = composeAmounts([line(11900)], p);
    expect(a.totalMinor).toBe(11900); // the authored price already contained it
    expect(a.taxMinor).toBe(1900);
  });

  it('exclusive tax adds on top', () => {
    const p = ShopPricingSchema.parse({ tax: { rateBp: 1900, mode: 'exclusive' } });
    const a = composeAmounts([line(10000)], p);
    expect(a.taxMinor).toBe(1900);
    expect(a.totalMinor).toBe(11900);
  });

  it('taxes shipping as part of the supply', () => {
    const p = ShopPricingSchema.parse({ shipping: { flatMinor: 1000 }, tax: { rateBp: 1000, mode: 'exclusive' } });
    const a = composeAmounts([line(10000)], p);
    expect(a.subtotalMinor).toBe(10000);
    expect(a.shippingMinor).toBe(1000);
    expect(a.taxMinor).toBe(1100); // 10% of 11000, not of 10000
    expect(a.totalMinor).toBe(12100);
  });

  it('is deterministic and integral for awkward rates', () => {
    const p = ShopPricingSchema.parse({ tax: { rateBp: 735, mode: 'exclusive' } });
    const a = composeAmounts([line(333), line(333), line(1)], p);
    expect(Number.isInteger(a.taxMinor)).toBe(true);
    expect(a.totalMinor).toBe(a.subtotalMinor + a.shippingMinor + a.taxMinor);
    // Same inputs, same answer, every time — no float ordering in the result.
    expect(composeAmounts([line(333), line(333), line(1)], p)).toEqual(a);
  });

  it('a zero rate adds nothing', () => {
    const p = ShopPricingSchema.parse({ tax: { rateBp: 0, mode: 'exclusive' } });
    expect(composeAmounts([line(1000)], p)).toMatchObject({ taxMinor: 0, totalMinor: 1000 });
  });
});

// ---------------------------------------------------------------------------------------------
// Gateway definitions (level 1)
// ---------------------------------------------------------------------------------------------

const baseGateway = {
  id: 'acme',
  name: 'Acme Pay',
  apiBase: { test: 'https://api-test.acme.test', live: 'https://api.acme.test' },
  auth: { kind: 'bearer', secretField: 'secretKey' },
  credentialFields: [
    { key: 'secretKey', label: 'Secret key', kind: 'secret', required: true, perMode: true, modePrefix: { test: 'sk_test_', live: 'sk_live_' } },
    { key: 'whsec', label: 'Webhook secret', kind: 'secret', required: true, perMode: true },
  ],
  checkout: {
    request: { method: 'POST', path: '/v1/sessions', format: 'json', headers: {}, body: { amount: '${AMOUNT:minor}' } },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'whsec' },
  events: { refPath: 'data.id', typePath: 'type', types: { 'payment.succeeded': 'paid' } },
  allowedOrigins: ['https://api-test.acme.test', 'https://api.acme.test', 'https://pay.acme.test'],
  enabled: true,
};

describe('PaymentGatewayInputSchema', () => {
  it('accepts a complete definition', () => {
    expect(PaymentGatewayInputSchema.safeParse(baseGateway).success).toBe(true);
  });

  it('★ refuses to let the platform set verified/builtin from input', () => {
    const parsed = PaymentGatewayInputSchema.parse({ ...baseGateway, verified: true, builtin: true });
    expect('verified' in parsed).toBe(false);
    expect('builtin' in parsed).toBe(false);
  });

  it('requires both an apiBase for test and for live', () => {
    expect(PaymentGatewayInputSchema.safeParse({ ...baseGateway, apiBase: { live: 'https://api.acme.test' } }).success).toBe(false);
  });

  it('requires https for every apiBase', () => {
    const bad = { ...baseGateway, apiBase: { test: 'http://api-test.acme.test', live: 'https://api.acme.test' } };
    expect(PaymentGatewayInputSchema.safeParse(bad).success).toBe(false);
  });

  it('★ requires at least one admin-approved origin, and that the apiBases are inside it', () => {
    expect(PaymentGatewayInputSchema.safeParse({ ...baseGateway, allowedOrigins: [] }).success).toBe(false);
    const outside = { ...baseGateway, allowedOrigins: ['https://pay.acme.test'] };
    const r = PaymentGatewayInputSchema.safeParse(outside);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('not in allowedOrigins');
  });

  it('rejects an origin carrying a path', () => {
    expect(PaymentGatewayInputSchema.safeParse({ ...baseGateway, allowedOrigins: ['https://api.acme.test/v1'] }).success).toBe(false);
  });

  it('★ rejects a credential field that is referenced but never declared', () => {
    const r = PaymentGatewayInputSchema.safeParse({
      ...baseGateway,
      verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'nope' },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('not declared as a credential field');
  });

  it('rejects duplicate credential field keys', () => {
    const dup = { ...baseGateway, credentialFields: [...baseGateway.credentialFields, { key: 'whsec', label: 'again' }] };
    const r = PaymentGatewayInputSchema.safeParse(dup);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('duplicate credential field');
  });

  it('rejects a choice field with no options', () => {
    const bad = { ...baseGateway, credentialFields: [{ key: 'region', label: 'Region', kind: 'choice' }] };
    expect(PaymentGatewayInputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a request path that is not a path', () => {
    for (const path of ['v1/x', '//evil.test/x', '/x\nY']) {
      const bad = { ...baseGateway, checkout: { ...baseGateway.checkout, request: { ...baseGateway.checkout.request, path } } };
      expect(PaymentGatewayInputSchema.safeParse(bad).success, path).toBe(false);
    }
  });

  it('rejects a proto-ish or malformed gateway id', () => {
    for (const id of ['__proto__', 'constructor', 'Acme', '1acme', 'a'.repeat(65), '']) {
      expect(PaymentGatewayInputSchema.safeParse({ ...baseGateway, id }).success, id).toBe(false);
    }
  });

  it('bounds the webhook tolerance so it cannot become an unbounded replay window', () => {
    const mk = (toleranceSeconds: number) => ({
      ...baseGateway,
      verification: { scheme: 'hmac-timestamped', header: 'x-sig', timestampKey: 't', signatureKey: 'v1', toleranceSeconds, secretField: 'whsec' },
    });
    expect(PaymentGatewayInputSchema.safeParse(mk(300)).success).toBe(true);
    expect(PaymentGatewayInputSchema.safeParse(mk(86_400)).success).toBe(false);
    expect(PaymentGatewayInputSchema.safeParse(mk(1)).success).toBe(false);
  });
});

describe('★ the stored schema stays permissive', () => {
  it('parses a row the INPUT schema would refuse, so one bad row cannot make the instance unreadable', () => {
    // Stored settings are re-parsed on every read. A stored schema as strict as the input one would
    // turn a single bad row into a denial of service on the operator's own instance.
    const loose = { ...baseGateway, allowedOrigins: [], apiBase: { live: 'https://api.acme.test' } };
    expect(PaymentGatewayInputSchema.safeParse(loose).success).toBe(false);
    expect(PaymentGatewayStoredSchema.safeParse(loose).success).toBe(true);
  });
});

describe('toPublicGateway', () => {
  it('★ allowlists fields — no request templates, no origins, no auth, no verification', () => {
    const stored = PaymentGatewayStoredSchema.parse({ ...baseGateway, verified: true });
    const pub = toPublicGateway(stored);
    const json = JSON.stringify(pub);
    expect(pub.id).toBe('acme');
    expect(pub.credentialFields).toHaveLength(2);
    expect(pub.refunds).toBe(false);
    for (const leak of ['allowedOrigins', 'apiBase', 'verification', 'auth', 'checkout', 'events', 'whsec' + '":']) {
      expect(json, leak).not.toContain(leak);
    }
    // The credential field KEYS are legitimately public — the editor renders a form from them.
    expect(json).toContain('"key":"whsec"');
  });

  it('reports refund support from the presence of a refund template', () => {
    const stored = PaymentGatewayStoredSchema.parse({ ...baseGateway, refund: { request: { path: '/v1/refunds' } } });
    expect(toPublicGateway(stored).refunds).toBe(true);
  });
});

describe('isSafeFieldPattern', () => {
  it('accepts a plain shape check', () => {
    expect(isSafeFieldPattern('sk_(test|live)_[A-Za-z0-9]{10,64}')).toBe(true);
  });
  it('★ refuses the constructs that make a stored regex a denial-of-service surface', () => {
    expect(isSafeFieldPattern('(a+)+')).toBe(false); // nested quantifier
    expect(isSafeFieldPattern('(a)\\1')).toBe(false); // backreference
    expect(isSafeFieldPattern('(?=a)b')).toBe(false); // lookahead
    expect(isSafeFieldPattern('(?<=a)b')).toBe(false); // lookbehind
    expect(isSafeFieldPattern('a'.repeat(300))).toBe(false); // unbounded length
    expect(isSafeFieldPattern('([')).toBe(false); // does not compile
  });
});

// ---------------------------------------------------------------------------------------------
// Project bindings (level 2)
// ---------------------------------------------------------------------------------------------

const fields: CredentialField[] = [
  { key: 'secretKey', label: 'Secret key', kind: 'secret', required: true, perMode: true, modePrefix: { test: 'sk_test_', live: 'sk_live_' } },
  { key: 'whsec', label: 'Webhook secret', kind: 'secret', required: true, perMode: true },
  { key: 'region', label: 'Region', kind: 'choice', required: false, perMode: false, options: ['eu', 'us'] },
];

describe('maskBinding', () => {
  it('★ never returns a secret, and gives presence plus a shape hint only', () => {
    const stored = PaymentBindingStoredSchema.parse({
      gatewayId: 'acme',
      mode: 'test',
      values: { test: { secretKey: 'sk_test_abcdef123456', whsec: { iv: 'i', ct: 'c', tag: 't' }, region: 'eu' } },
    });
    const pub = maskBinding(stored, fields);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('abcdef123456');
    expect(json).not.toContain('sk_test_a');
    const test = pub.fields.test;
    expect(test.find((f) => f.key === 'secretKey')).toEqual({ key: 'secretKey', hasValue: true, display: '••••3456' });
    // An encrypted envelope yields presence only — a ciphertext tail is not a hint about plaintext.
    expect(test.find((f) => f.key === 'whsec')).toEqual({ key: 'whsec', hasValue: true, display: '••••' });
    // A non-secret is readable config, so it is shown.
    expect(test.find((f) => f.key === 'region')).toEqual({ key: 'region', hasValue: true, display: 'eu' });
  });

  it('gives a short value no tail at all', () => {
    const stored = PaymentBindingStoredSchema.parse({ gatewayId: 'acme', mode: 'test', values: { test: { secretKey: 'short' } } });
    expect(maskBinding(stored, fields).fields.test.find((f) => f.key === 'secretKey')?.display).toBe('••••');
  });

  it('★ reports BOTH modes, so live keys are visible as present while editing test', () => {
    const stored = PaymentBindingStoredSchema.parse({
      gatewayId: 'acme',
      mode: 'test',
      values: { test: { secretKey: 'sk_test_x', whsec: 'w' }, live: { secretKey: 'sk_live_y', whsec: 'w2' } },
    });
    const pub = maskBinding(stored, fields);
    expect(pub.fields.live.find((f) => f.key === 'secretKey')?.hasValue).toBe(true);
    expect(pub.fields.test.find((f) => f.key === 'secretKey')?.hasValue).toBe(true);
  });

  it('★ completeness is judged against the ACTIVE mode only', () => {
    const stored = PaymentBindingStoredSchema.parse({
      gatewayId: 'acme',
      mode: 'live',
      values: { test: { secretKey: 'sk_test_x', whsec: 'w' } },
    });
    const pub = maskBinding(stored, fields);
    expect(pub.complete).toBe(false);
    expect(pub.missing).toEqual(['secretKey', 'whsec']);
  });

  it('an empty string is not a value', () => {
    const stored = PaymentBindingStoredSchema.parse({ gatewayId: 'acme', mode: 'test', values: { test: { secretKey: '', whsec: 'w' } } });
    const pub = maskBinding(stored, fields);
    expect(pub.missing).toEqual(['secretKey']);
    expect(pub.fields.test.find((f) => f.key === 'secretKey')?.hasValue).toBe(false);
  });

  it('an optional field being absent does not make a binding incomplete', () => {
    const stored = PaymentBindingStoredSchema.parse({ gatewayId: 'acme', mode: 'test', values: { test: { secretKey: 'sk_test_x', whsec: 'w' } } });
    expect(maskBinding(stored, fields).complete).toBe(true);
  });

  it('★ declaration drift surfaces as incomplete + orphaned, never as a dropped value', () => {
    const stored = PaymentBindingStoredSchema.parse({
      gatewayId: 'acme',
      mode: 'test',
      values: { test: { secretKey: 'sk_test_x', whsec: 'w', retired: 'old', region: 'eu' } },
    });
    // An admin ADDS a required field: every binding becomes incomplete at once, in the editor.
    const withNew = maskBinding(stored, [...fields, { key: 'merchantId', label: 'Merchant id', kind: 'secret', required: true, perMode: false }]);
    expect(withNew.complete).toBe(false);
    expect(withNew.missing).toEqual(['merchantId']);
    // An admin REMOVES a field: the stored value is ORPHANED, not deleted — an admin may be mid-edit.
    expect(withNew.orphaned).toEqual(['retired']);
  });
});

describe('PaymentBindingInputSchema', () => {
  it('carries only the mode being edited, so saving test keys cannot wipe live ones', () => {
    const parsed = PaymentBindingInputSchema.parse({ gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_x' } });
    expect(parsed.mode).toBe('test');
    expect(parsed.values).toEqual({ secretKey: 'sk_test_x' });
  });
  it('rejects an unknown mode', () => {
    expect(PaymentBindingInputSchema.safeParse({ gatewayId: 'acme', mode: 'sandbox', values: {} }).success).toBe(false);
  });
});

describe('validateCredentialValue', () => {
  const secret = fields[0]!;
  it('★ names the expected prefix — pasting a live key into test mode is the commonest misconfiguration', () => {
    expect(validateCredentialValue(secret, 'test', 'sk_test_abc')).toBeNull();
    const err = validateCredentialValue(secret, 'test', 'sk_live_abc');
    expect(err).toContain('test mode');
    expect(err).toContain('sk_test_');
    expect(validateCredentialValue(secret, 'live', 'sk_live_abc')).toBeNull();
    expect(validateCredentialValue(secret, 'live', 'sk_test_abc')).toContain('sk_live_');
  });

  it('rejects line breaks (a header-injection shape)', () => {
    expect(validateCredentialValue(fields[1]!, 'test', 'abc\r\nX: y')).toContain('line breaks');
  });

  it('enforces a required field but allows an optional blank', () => {
    expect(validateCredentialValue(fields[1]!, 'test', '')).toContain('required');
    expect(validateCredentialValue(fields[2]!, 'test', '')).toBeNull();
  });

  it('enforces choice membership and bool typing', () => {
    expect(validateCredentialValue(fields[2]!, 'test', 'eu')).toBeNull();
    expect(validateCredentialValue(fields[2]!, 'test', 'apac')).toContain('must be one of');
    const flag: CredentialField = { key: 'live', label: 'Live', kind: 'bool', required: true, perMode: false };
    expect(validateCredentialValue(flag, 'test', true)).toBeNull();
    expect(validateCredentialValue(flag, 'test', 'yes')).toContain('true or false');
  });

  it('applies a declared pattern anchored at both ends', () => {
    const f: CredentialField = { key: 'k', label: 'K', kind: 'secret', required: true, perMode: false, pattern: '[0-9]{4}' };
    expect(validateCredentialValue(f, 'test', '1234')).toBeNull();
    expect(validateCredentialValue(f, 'test', 'x1234y')).toContain('expected format');
  });

  it('ignores a pattern that failed the safety subset rather than compiling it', () => {
    const f: CredentialField = { key: 'k', label: 'K', kind: 'secret', required: true, perMode: false, pattern: '(a+)+' };
    expect(validateCredentialValue(f, 'test', 'whatever')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------------------------

describe('canTransitionPayment', () => {
  it('★ a terminal status cannot be un-done — a re-delivered old event must not un-pay an order', () => {
    expect(canTransitionPayment('paid', 'failed')).toBe(false);
    expect(canTransitionPayment('paid', 'expired')).toBe(false);
    expect(canTransitionPayment('paid', 'pending')).toBe(false);
    expect(canTransitionPayment('failed', 'paid')).toBe(false);
    expect(canTransitionPayment('expired', 'paid')).toBe(false);
    expect(canTransitionPayment('cancelled', 'paid')).toBe(false);
  });

  it('★ refunds are the only move out of paid, because they are a real later event', () => {
    expect(canTransitionPayment('paid', 'refunded')).toBe(true);
    expect(canTransitionPayment('paid', 'partially_refunded')).toBe(true);
    expect(canTransitionPayment('partially_refunded', 'refunded')).toBe(true);
    expect(canTransitionPayment('refunded', 'paid')).toBe(false);
    expect(canTransitionPayment('partially_refunded', 'paid')).toBe(false);
  });

  it('moves forward out of created/pending', () => {
    expect(canTransitionPayment('created', 'pending')).toBe(true);
    expect(canTransitionPayment('created', 'paid')).toBe(true);
    expect(canTransitionPayment('pending', 'paid')).toBe(true);
    expect(canTransitionPayment('pending', 'failed')).toBe(true);
  });

  it('never returns to created, and never reports a no-op as a transition', () => {
    for (const from of TRANSACTION_STATUSES) {
      expect(canTransitionPayment(from, 'created'), from).toBe(false);
      expect(canTransitionPayment(from, from), from).toBe(false);
    }
  });
});

describe('FULFILMENT_TRANSITIONS', () => {
  it('is terminal at done and cancelled', () => {
    expect(FULFILMENT_TRANSITIONS.done).toEqual([]);
    expect(FULFILMENT_TRANSITIONS.cancelled).toEqual([]);
  });
  it('never moves backwards', () => {
    const order = ['new', 'packed', 'shipped', 'done'] as const;
    for (const [i, from] of order.entries()) {
      for (const to of FULFILMENT_TRANSITIONS[from]) {
        if (to === 'cancelled') continue;
        expect(order.indexOf(to as (typeof order)[number]), `${from}->${to}`).toBeGreaterThan(i);
      }
    }
  });
});
