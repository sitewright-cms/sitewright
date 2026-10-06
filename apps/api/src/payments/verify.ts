import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GatewayVerification } from '@sitewright/schema';

/**
 * WEBHOOK SIGNATURE VERIFICATION — implemented by the HOST, for every gateway, always.
 *
 * ★★ THIS IS THE ONE THING A STORED GATEWAY MAY NEVER DO. A record allowed to supply its own verify
 * step would be trusted to answer "is this payment real?", and the cheapest possible implementation
 * of that function returns true. So a gateway NAMES a scheme from the closed set below and supplies
 * only parameters — which header, which encoding, how much clock skew.
 *
 * Every comparison is constant-time. Every failure is closed: an unparseable header, a missing
 * secret, a stale timestamp and a wrong digest all produce the same refusal, and none of them says
 * which.
 */

/** Why a webhook was refused. Returned to the caller for COUNTING, never to the provider. */
export type VerifyFailure =
  | 'no-signature'
  | 'malformed-signature'
  | 'no-secret'
  | 'bad-signature'
  | 'stale-timestamp'
  | 'unsupported';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/** Constant-time compare of two ASCII digests. Length mismatch is reported without a timing leak. */
function safeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` throws on unequal lengths, so equalise first and fold the length check into
  // the result. Comparing a against itself keeps the work (and the time) constant either way.
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Lower-cases and trims a header value; arrays (a repeated header) collapse to the first. */
function headerValue(headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | undefined {
   
  const raw = headers[name.toLowerCase()];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return undefined;
  // Trim FIRST, then judge emptiness: a whitespace-only header is ABSENT, not malformed. Reporting
  // it as a bad signature would tell an operator to go looking at their secret.
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Parses Stripe-style `t=123,v1=abc,v1=def` into a key → values map. */
function parseElements(value: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k || !v) continue;
    const list = out.get(k) ?? [];
    list.push(v);
    out.set(k, list);
  }
  return out;
}

const hmacHex = (secret: string, payload: Buffer | string): string => createHmac('sha256', secret).update(payload).digest('hex');
const hmacB64 = (secret: string, payload: Buffer | string): string => createHmac('sha256', secret).update(payload).digest('base64');

/**
 * Verifies a webhook against the gateway's DECLARED scheme.
 *
 * `raw` must be the EXACT bytes the provider sent. ★ Verifying a re-serialized body silently fails
 * for every provider — key order, whitespace and number formatting all change — which is why the
 * webhook route registers its own raw-body parser instead of using the app's global JSON one.
 *
 * `remote-verify` (PayPal) cannot be answered here because it requires a network call; it returns
 * `unsupported` so the caller performs it. Keeping it out of this function is deliberate: everything
 * in here is pure and synchronous, and therefore trivially testable against known vectors.
 */
export function verifyWebhookSignature(
  verification: GatewayVerification,
  raw: Buffer,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  secret: string | undefined,
  nowMs: number,
): VerifyResult {
  if (verification.scheme === 'remote-verify') return { ok: false, reason: 'unsupported' };
  // Fail CLOSED on a missing secret. A gateway configured without its webhook secret must refuse
  // every event, not accept them unverified — "we could not check" is not "it is fine".
  if (!secret) return { ok: false, reason: 'no-secret' };

  const header = headerValue(headers, verification.header);
  if (!header) return { ok: false, reason: 'no-signature' };

  if (verification.scheme === 'hmac-sha256-header') {
    let provided = header;
    if (verification.valuePrefix) {
      if (!provided.startsWith(verification.valuePrefix)) return { ok: false, reason: 'malformed-signature' };
      provided = provided.slice(verification.valuePrefix.length);
    }
    const expected = verification.encoding === 'base64' ? hmacB64(secret, raw) : hmacHex(secret, raw);
    // Hex is case-insensitive on the wire; base64 is not.
    const a = verification.encoding === 'base64' ? provided : provided.toLowerCase();
    const b = verification.encoding === 'base64' ? expected : expected.toLowerCase();
    return safeEqualStrings(a, b) ? { ok: true } : { ok: false, reason: 'bad-signature' };
  }

  // hmac-timestamped (Stripe's shape): HMAC over `<timestamp>.<raw body>`, with the timestamp
  // carried in the same header so it is covered by the signature and cannot be moved.
  const elements = parseElements(header);
  const ts = elements.get(verification.timestampKey)?.[0];
  const signatures = elements.get(verification.signatureKey) ?? [];
  if (!ts || signatures.length === 0) return { ok: false, reason: 'malformed-signature' };
  if (!/^\d{1,15}$/.test(ts)) return { ok: false, reason: 'malformed-signature' };

  // ★ Skew is checked in BOTH directions. A future timestamp is just as much a replay primitive as
  // an old one: accepting it would let a captured event be re-dated and reused indefinitely.
  const tsMs = Number(ts) * 1000;
  if (Math.abs(nowMs - tsMs) > verification.toleranceSeconds * 1000) return { ok: false, reason: 'stale-timestamp' };

  const expected = hmacHex(secret, Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), raw]));
  // A provider may send several signatures during a secret rotation; any one matching is a pass, and
  // every candidate is compared in constant time.
  let matched = false;
  for (const sig of signatures) {
    if (safeEqualStrings(sig.toLowerCase(), expected)) matched = true;
  }
  return matched ? { ok: true } : { ok: false, reason: 'bad-signature' };
}
