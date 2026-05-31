import { createHash, randomBytes } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh RFC 7636 code verifier (43 chars of unreserved base64url). */
export function generateVerifier(): string {
  return base64url(randomBytes(32));
}

/** The S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** An opaque value for the OAuth `state` parameter (CSRF binding). */
export function generateState(): string {
  return base64url(randomBytes(16));
}
