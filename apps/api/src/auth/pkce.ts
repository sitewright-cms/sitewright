import { createHash, timingSafeEqual } from 'node:crypto';

/** RFC 7636 code-verifier charset + length (43–128 of unreserved chars). */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url-encoded SHA-256 digest (no padding) is exactly 43 chars. */
const S256_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

/** True when `challenge` is a well-formed S256 (base64url SHA-256) challenge. */
export function isValidS256Challenge(challenge: string): boolean {
  return S256_CHALLENGE_RE.test(challenge);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export function s256Challenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** True when `verifier` is a syntactically valid RFC 7636 code verifier. */
export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

/**
 * Verifies a PKCE S256 challenge: the presented `verifier` must hash to the
 * stored `challenge`. Constant-time compare; rejects malformed verifiers. Only
 * S256 is supported (the `plain` method is refused at the endpoint).
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  const expected = s256Challenge(verifier);
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
