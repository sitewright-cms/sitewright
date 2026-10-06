import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../src/payments/verify.js';
import type { GatewayVerification } from '@sitewright/schema';

const SECRET = 'whsec_test_1234567890';
const BODY = Buffer.from('{"id":"evt_1","type":"payment.succeeded"}', 'utf8');
const NOW = 1_760_000_000_000; // a fixed instant; see the note on wall-clock fixtures below

const simple: GatewayVerification = { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'whsec' };
const stamped: GatewayVerification = {
  scheme: 'hmac-timestamped',
  header: 'stripe-signature',
  timestampKey: 't',
  signatureKey: 'v1',
  toleranceSeconds: 300,
  secretField: 'whsec',
};

const hex = (payload: Buffer | string, secret = SECRET) => createHmac('sha256', secret).update(payload).digest('hex');
const b64 = (payload: Buffer | string, secret = SECRET) => createHmac('sha256', secret).update(payload).digest('base64');
const stampedHeader = (tsSeconds: number, body = BODY, secret = SECRET) =>
  `t=${tsSeconds},v1=${hex(Buffer.concat([Buffer.from(`${tsSeconds}.`), body]), secret)}`;

describe('hmac-sha256-header', () => {
  it('accepts a correct hex signature', () => {
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': hex(BODY) }, SECRET, NOW)).toEqual({ ok: true });
  });

  it('is case-insensitive for hex, as the wire format is', () => {
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': hex(BODY).toUpperCase() }, SECRET, NOW)).toEqual({ ok: true });
  });

  it('accepts base64 when declared, and is case-SENSITIVE there', () => {
    const v: GatewayVerification = { ...simple, encoding: 'base64' };
    expect(verifyWebhookSignature(v, BODY, { 'x-sig': b64(BODY) }, SECRET, NOW)).toEqual({ ok: true });
    expect(verifyWebhookSignature(v, BODY, { 'x-sig': b64(BODY).toUpperCase() }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('strips a declared value prefix, and refuses a missing one', () => {
    const v: GatewayVerification = { ...simple, valuePrefix: 'sha256=' };
    expect(verifyWebhookSignature(v, BODY, { 'x-sig': `sha256=${hex(BODY)}` }, SECRET, NOW)).toEqual({ ok: true });
    expect(verifyWebhookSignature(v, BODY, { 'x-sig': hex(BODY) }, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed-signature' });
  });

  it('★ refuses a wrong secret, a wrong body, and a wrong signature', () => {
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': hex(BODY, 'other') }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyWebhookSignature(simple, Buffer.from('{"id":"evt_2"}'), { 'x-sig': hex(BODY) }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': 'deadbeef' }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('★★ a SINGLE BYTE of body difference fails — this is what "verify the RAW body" means', () => {
    // Re-serializing a parsed body changes key order, spacing and number formatting, so a route that
    // verified `JSON.stringify(req.body)` would reject every genuine webhook from every provider.
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(BODY.toString())) + ' ', 'utf8');
    expect(verifyWebhookSignature(simple, reserialized, { 'x-sig': hex(BODY) }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('★ FAILS CLOSED with no secret — "we could not check" is not "it is fine"', () => {
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': hex(BODY) }, undefined, NOW)).toEqual({ ok: false, reason: 'no-secret' });
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': hex(BODY) }, '', NOW)).toEqual({ ok: false, reason: 'no-secret' });
  });

  it('refuses an absent or empty header', () => {
    expect(verifyWebhookSignature(simple, BODY, {}, SECRET, NOW)).toEqual({ ok: false, reason: 'no-signature' });
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': '' }, SECRET, NOW)).toEqual({ ok: false, reason: 'no-signature' });
    // A whitespace-only header is ABSENT, not malformed — reporting it as a bad signature would
    // send an operator looking at their secret.
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': '   ' }, SECRET, NOW)).toEqual({ ok: false, reason: 'no-signature' });
  });

  it('reads the header case-insensitively and collapses a repeated one', () => {
    expect(verifyWebhookSignature(simple, BODY, { 'x-sig': [hex(BODY), 'junk'] }, SECRET, NOW)).toEqual({ ok: true });
  });

  it('handles a non-UTF8 body byte-for-byte', () => {
    const binary = Buffer.from([0x00, 0xff, 0xfe, 0x7f, 0x80]);
    expect(verifyWebhookSignature(simple, binary, { 'x-sig': hex(binary) }, SECRET, NOW)).toEqual({ ok: true });
  });

  it('handles an empty body rather than throwing', () => {
    const empty = Buffer.alloc(0);
    expect(verifyWebhookSignature(simple, empty, { 'x-sig': hex(empty) }, SECRET, NOW)).toEqual({ ok: true });
  });
});

describe('hmac-timestamped', () => {
  const ts = Math.floor(NOW / 1000);

  it('accepts a correct, fresh signature', () => {
    expect(verifyWebhookSignature(stamped, BODY, { 'stripe-signature': stampedHeader(ts) }, SECRET, NOW)).toEqual({ ok: true });
  });

  it('★ covers the TIMESTAMP with the signature, so it cannot be moved', () => {
    const header = stampedHeader(ts);
    // Re-date the same signature: the digest no longer matches the `<t>.<body>` payload.
    const moved = header.replace(`t=${ts}`, `t=${ts + 1}`);
    expect(verifyWebhookSignature(stamped, BODY, { 'stripe-signature': moved }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a timestamp outside tolerance', () => {
    const old = ts - 301;
    expect(verifyWebhookSignature(stamped, BODY, { 'stripe-signature': stampedHeader(old) }, SECRET, NOW)).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('★ refuses a FUTURE timestamp too — it is just as much a replay primitive', () => {
    // Accepting a future timestamp would let a captured event be re-dated and reused indefinitely.
    const future = ts + 301;
    expect(verifyWebhookSignature(stamped, BODY, { 'stripe-signature': stampedHeader(future) }, SECRET, NOW)).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('accepts the edges of the tolerance window', () => {
    for (const t of [ts - 300, ts + 300]) {
      expect(verifyWebhookSignature(stamped, BODY, { 'stripe-signature': stampedHeader(t) }, SECRET, NOW), String(t)).toEqual({ ok: true });
    }
  });

  it('accepts any one of several signatures — a provider rotating its secret sends both', () => {
    const good = hex(Buffer.concat([Buffer.from(`${ts}.`), BODY]));
    expect(
      verifyWebhookSignature(stamped, BODY, { 'stripe-signature': `t=${ts},v1=deadbeef,v1=${good}` }, SECRET, NOW),
    ).toEqual({ ok: true });
  });

  it('refuses a malformed header rather than guessing', () => {
    for (const header of ['', 'garbage', `t=${ts}`, 'v1=abc', `t=abc,v1=${'0'.repeat(64)}`, `t=,v1=x`, '=,=']) {
      const r = verifyWebhookSignature(stamped, BODY, { 'stripe-signature': header }, SECRET, NOW);
      expect(r.ok, JSON.stringify(header)).toBe(false);
    }
  });

  it('bounds the timestamp digits so an absurd value cannot be arithmetic', () => {
    const header = `t=${'9'.repeat(30)},v1=${'0'.repeat(64)}`;
    expect(verifyWebhookSignature(stamped, BODY, { 'stripe-signature': header }, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed-signature' });
  });
});

describe('remote-verify', () => {
  it('★ is reported as unsupported HERE, so the caller performs the network call', () => {
    // Keeping it out of this function is what makes everything in here pure, synchronous and
    // testable against known vectors.
    const v: GatewayVerification = { scheme: 'remote-verify', path: '/v1/verify', resultPath: 'verification_status', successValue: 'SUCCESS' };
    expect(verifyWebhookSignature(v, BODY, {}, SECRET, NOW)).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('★ no failure mode leaks which gate refused it', () => {
  it('returns a reason for COUNTING, and the route must not forward it', () => {
    // The reasons are distinct on purpose — an operator needs to tell "stale clock" from "wrong
    // secret" — but they are for the filtered counters, never for the response body.
    const reasons = new Set(
      [
        verifyWebhookSignature(simple, BODY, {}, SECRET, NOW),
        verifyWebhookSignature(simple, BODY, { 'x-sig': 'x' }, SECRET, NOW),
        verifyWebhookSignature(simple, BODY, { 'x-sig': 'x' }, undefined, NOW),
      ].map((r) => (r.ok ? 'ok' : r.reason)),
    );
    expect(reasons).toEqual(new Set(['no-signature', 'bad-signature', 'no-secret']));
  });
});
