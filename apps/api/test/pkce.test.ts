import { describe, it, expect } from 'vitest';
import { s256Challenge, isValidCodeVerifier, verifyPkceS256 } from '../src/auth/pkce.js';

// RFC 7636 Appendix B reference vector.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('PKCE S256', () => {
  it('computes the RFC 7636 reference challenge', () => {
    expect(s256Challenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('verifies a matching verifier/challenge pair', () => {
    expect(verifyPkceS256(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    expect(verifyPkceS256('a'.repeat(43), RFC_CHALLENGE)).toBe(false);
  });

  it('rejects a malformed (too short / illegal char) verifier without hashing', () => {
    expect(verifyPkceS256('too-short', RFC_CHALLENGE)).toBe(false);
    expect(isValidCodeVerifier('short')).toBe(false);
    expect(isValidCodeVerifier('has spaces ' + 'a'.repeat(40))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
  });

  it('rejects when challenge length differs (no partial compare)', () => {
    expect(verifyPkceS256(RFC_VERIFIER, RFC_CHALLENGE.slice(0, 10))).toBe(false);
  });
});
