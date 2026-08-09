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
 * hashes. Verification is a hash and a constant-time compare — no state, no lookup, no network.
 *
 * STATELESS BY DESIGN. The expiry rides INSIDE the signed salt, so nothing is stored and nothing has to
 * be cleaned up. That does mean a challenge is replayable until it expires: the window is short, and the
 * honeypot, time-trap, interaction gate and rate limiter all still apply to the replayed submission.
 * A single-use guard would need shared state across processes, which is a cost this does not yet earn.
 *
 * WHAT IT IS FOR. Cost, not identity. It cannot tell a human from a script — nothing client-side can.
 * It makes bulk submission expensive, which is a different and more achievable goal.
 */

/** How long a challenge stays solvable. Long enough to fill a form, short enough to bound replay. */
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
const sign = (secret: string, challenge: string): string => createHmac('sha256', secret).update(challenge).digest('hex');

const equals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * Mint a challenge. The salt carries its own expiry (`<random>.<expiresAtMs>`) and is covered by the
 * signature, so a client cannot extend its own deadline.
 */
export function createPowChallenge(
  secret: string,
  maxnumber: number = DEFAULT_MAX_NUMBER,
  nowMs: number = Date.now(),
): PowChallenge {
  const salt = `${randomBytes(12).toString('hex')}.${nowMs + CHALLENGE_TTL_MS}`;
  const number = Math.floor(Math.random() * (maxnumber + 1));
  const challenge = sha256Hex(salt + String(number));
  return { algorithm: 'SHA-256', challenge, salt, signature: sign(secret, challenge), maxnumber };
}

export type PowResult = 'ok' | 'missing' | 'malformed' | 'expired' | 'bad-signature' | 'wrong-answer';

/**
 * Verify a solution. Returns a REASON rather than a boolean so the drop can be counted specifically —
 * "expired" (a visitor who left the tab open) and "wrong-answer" (a client that did not do the work)
 * are very different signals, and telling them apart is the only way to know whether the difficulty or
 * the TTL is costing real leads.
 *
 * The signature is checked BEFORE the hash: it is the cheap constant-time test, and it means a forged
 * challenge never reaches the (attacker-controlled) hash input at all.
 */
export function verifyPowSolution(secret: string, encoded: string | undefined, nowMs: number = Date.now()): PowResult {
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
  if (!equals(signature, sign(secret, challenge))) return 'bad-signature';
  // Only NOW is the salt trustworthy — its expiry is covered by the signature just verified.
  const expiresAt = Number(salt.slice(salt.lastIndexOf('.') + 1));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return 'expired';
  return equals(sha256Hex(salt + String(number)), challenge) ? 'ok' : 'wrong-answer';
}
