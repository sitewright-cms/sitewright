import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Proof-of-work for form submissions — an ALTCHA-compatible challenge, implemented here rather than
 * taken as a dependency.
 *
 * WHY IMPLEMENTED, NOT VENDORED. The interaction gate beside it is ours regardless (ALTCHA has no such
 * thing), so there is one gate, one score and one drop-reason pipeline either way; vendoring would mean
 * gluing a foreign web component into a gate we own. The widget is also another shipped asset on a
 * publish path that is deliberately per-page and lean, and two new runtime dependencies on the PUBLIC
 * form endpoint is the most exposed place this repo could take them. What is left to write is not
 * delicate: an HMAC-signed challenge and a hash check.
 *
 * WHY ALTCHA'S WIRE FORMAT ANYWAY. Porting a proven design beats inventing one, and it keeps the exit
 * cheap: if this ever stops being worth owning, `altcha-lib` is a compatible swap rather than a rewrite.
 *
 * THE MECHANISM. The server picks a secret number in [0, maxnumber], publishes `sha256(salt + number)`
 * and an HMAC over it, and the client scans until it finds the number. Expected work is maxnumber/2
 * hashes. Verification is a hash and a constant-time compare.
 *
 * WHAT IT IS FOR. Cost, not identity. It cannot tell a human from a script — nothing client-side can.
 * It makes bulk submission expensive, which is a different and more achievable goal.
 *
 * ★ ONE SOLVE MUST BUY EXACTLY ONE SUBMISSION. This started out fully stateless — the expiry rode
 * inside the signed salt and nothing was stored — which meant a solved challenge stayed valid for its
 * whole TTL and could be replayed, and sprayed at every other form on the instance. Cost per submission
 * is the ENTIRE point of proof-of-work, and "one solve, then thirty minutes of free posting" is not a
 * weaker version of that guarantee, it is the absence of one. Two things now hold it up:
 *
 *   1. SCOPE. The HMAC covers the form the challenge was minted for, so a solve for one form is
 *      `bad-signature` at any other. The scope never travels on the wire — both ends derive it from the
 *      URL — so the format stays ALTCHA-compatible and the client needed no change.
 *   2. SINGLE USE. A verified solution is CLAIMED through an atomic insert; a second attempt to claim
 *      the same challenge is `replayed`. Claiming happens LAST, after the work has been checked, so a
 *      forged or expired challenge never reaches the store — an attacker must burn the same CPU as a
 *      real visitor to write one row, which is what bounds the store's growth.
 *
 * The TTL still bounds how long an UNUSED challenge lives, and the honeypot, time-trap, interaction
 * gate and rate limiter all still apply on top.
 */

/** How long a challenge stays solvable. Long enough to fill a form, short enough to bound the store. */
const CHALLENGE_TTL_MS = 30 * 60 * 1000;
/** Expected work is HALF this. Sized so a mid-range phone solves it in a few hundred ms. */
export const DEFAULT_MAX_NUMBER = 50_000;

export interface PowChallenge {
  algorithm: 'SHA-256';
  challenge: string;
  salt: string;
  signature: string;
  maxnumber: number;
}

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Binds a challenge to ONE form. JSON-encoded rather than joined with a separator so the encoding is
 * injective: ids arrive from the URL, and `["a","b:c"]` must never sign the same bytes as `["a:b","c"]`.
 */
export const powScope = (projectId: string, formId: string): string => JSON.stringify([projectId, formId]);

const sign = (secret: string, scope: string, challenge: string): string =>
  createHmac('sha256', secret).update(`${scope}\n${challenge}`).digest('hex');

const equals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * Mint a challenge for one form. The salt carries its own expiry (`<random>.<expiresAtMs>`) and the
 * signature covers both the challenge and the scope, so a client can neither extend its own deadline
 * nor move its solution to another form.
 */
export function createPowChallenge(
  secret: string,
  scope: string,
  maxnumber: number = DEFAULT_MAX_NUMBER,
  nowMs: number = Date.now(),
): PowChallenge {
  const salt = `${randomBytes(12).toString('hex')}.${nowMs + CHALLENGE_TTL_MS}`;
  const number = Math.floor(Math.random() * (maxnumber + 1));
  const challenge = sha256Hex(salt + String(number));
  return { algorithm: 'SHA-256', challenge, salt, signature: sign(secret, scope, challenge), maxnumber };
}

export type PowResult = 'ok' | 'missing' | 'malformed' | 'expired' | 'bad-signature' | 'wrong-answer' | 'replayed';

/**
 * Records a challenge as spent. MUST be atomic — a check-then-write would let two concurrent posts
 * through on one solve — and MUST return false if this challenge was already claimed.
 */
export type PowClaim = (challenge: string, expiresAt: Date) => Promise<boolean>;

interface ParsedSolution {
  challenge: string;
  salt: string;
  number: number;
  signature: string;
}

function parseSolution(encoded: string | undefined): ParsedSolution | PowResult {
  if (!encoded) return 'missing';
  let parsed: { algorithm?: unknown; challenge?: unknown; salt?: unknown; number?: unknown; signature?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as typeof parsed;
  } catch {
    return 'malformed';
  }
  const { algorithm, challenge, salt, number, signature } = parsed;
  if (
    algorithm !== 'SHA-256' ||
    typeof challenge !== 'string' ||
    typeof salt !== 'string' ||
    typeof signature !== 'string' ||
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    return 'malformed';
  }
  return { challenge, salt, number, signature };
}

/**
 * Verify a solution AND consume it. Returns a REASON rather than a boolean so the drop can be counted
 * specifically — "expired" (a visitor who left the tab open), "wrong-answer" (a client that did no
 * work) and "replayed" (a solution being reused) are entirely different signals, and telling them
 * apart is the only way to know whether the difficulty or the TTL is costing real leads.
 *
 * Consumption is not optional and there is deliberately no non-consuming variant to reach for: a
 * verify that leaves the challenge spendable is the bug this exists to prevent.
 *
 * ORDER MATTERS, cheapest and safest first:
 *   signature — constant-time, and it means a forged challenge never reaches the (attacker-controlled)
 *               hash input, nor the expiry that rides inside the salt it covers;
 *   expiry    — trustworthy only once the signature has vouched for the salt;
 *   answer    — the actual work;
 *   claim     — a write, and only ever for a solution that already paid for it.
 */
export async function verifyPowSolution(
  secret: string,
  scope: string,
  encoded: string | undefined,
  claim: PowClaim,
  nowMs: number = Date.now(),
): Promise<PowResult> {
  const parsed = parseSolution(encoded);
  if (typeof parsed === 'string') return parsed;

  if (!equals(parsed.signature, sign(secret, scope, parsed.challenge))) return 'bad-signature';
  // Only NOW is the salt trustworthy — its expiry is covered by the signature just verified.
  const expiresAt = Number(parsed.salt.slice(parsed.salt.lastIndexOf('.') + 1));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return 'expired';
  if (!equals(sha256Hex(parsed.salt + String(parsed.number)), parsed.challenge)) return 'wrong-answer';

  return (await claim(parsed.challenge, new Date(expiresAt))) ? 'ok' : 'replayed';
}
