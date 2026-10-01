import { describe, it, expect } from 'vitest';
import { generateSync } from 'otplib';
import { checkTotpStep, currentTotpStep, totpKeyuri, generateTotpSecret } from '../src/auth/totp.js';

/**
 * The TOTP algorithm itself, pinned to RFC 6238 rather than to a library version.
 *
 * ★ WHY THIS FILE EXISTS. Upgrading otplib (12 → 13) rewrites how codes are produced, and the failure
 * mode of getting it wrong is the worst kind: every already-enrolled authenticator app silently stops
 * matching, and the only symptom is users who cannot log in. A test that generates a code with the
 * new library and feeds it back to the new library would pass while agreeing on the WRONG answer.
 * RFC 6238's published vectors are the independent check — if these pass, an app enrolled under the
 * old version still works under the new one.
 */

// RFC 6238 Appendix B: the seed is ASCII "12345678901234567890", base32-encoded.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP matches RFC 6238', () => {
  // The RFC publishes 8-digit codes; a 6-digit code is the same truncation mod 10^6, i.e. the last
  // six digits — which is what every authenticator app shows.
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('at epoch %i produces %s', (epoch, expected) => {
    expect(generateSync({ secret: RFC_SECRET, epoch })).toBe(expected);
  });
});

describe('checkTotpStep', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts the current code and reports its absolute step', () => {
    const code = generateSync({ secret: RFC_SECRET, epoch: now() });
    expect(checkTotpStep(code, RFC_SECRET)).toBe(currentTotpStep());
  });

  it('absorbs ±1 step of clock skew, and no more', () => {
    // ★ THE MIGRATION TRAP. otplib 12 counted this window in STEPS (`window: 1`); 13 counts it in
    // SECONDS (`epochTolerance`). Carrying the literal `1` across would narrow ±30s to ±1s — still a
    // working login for anyone whose clock is exact, and an intermittent mystery for everyone else.
    // These two assertions are the difference between those spellings.
    const behind = generateSync({ secret: RFC_SECRET, epoch: now() - 30 });
    const ahead = generateSync({ secret: RFC_SECRET, epoch: now() + 30 });
    expect(checkTotpStep(behind, RFC_SECRET)).toBe(currentTotpStep() - 1);
    expect(checkTotpStep(ahead, RFC_SECRET)).toBe(currentTotpStep() + 1);

    // Two steps out is refused — the window must not have silently widened either.
    expect(checkTotpStep(generateSync({ secret: RFC_SECRET, epoch: now() - 90 }), RFC_SECRET)).toBeNull();
    expect(checkTotpStep(generateSync({ secret: RFC_SECRET, epoch: now() + 90 }), RFC_SECRET)).toBeNull();
  });

  it('refuses anything that is not a six-digit code, without throwing', () => {
    for (const bad of ['', '12345', '1234567', 'ABCDEF', 'K7QF2-MN9PX', '12 34 56 78']) {
      expect(checkTotpStep(bad, RFC_SECRET)).toBeNull();
    }
    // A structurally invalid secret must fail closed rather than 500 the login route.
    expect(checkTotpStep('123456', 'not-base32!!')).toBeNull();
  });

  it('tolerates the spaces an authenticator app puts in the middle of a code', () => {
    const code = generateSync({ secret: RFC_SECRET, epoch: now() });
    expect(checkTotpStep(`${code.slice(0, 3)} ${code.slice(3)}`, RFC_SECRET)).toBe(currentTotpStep());
  });
});

describe('enrolment', () => {
  it('emits an otpauth:// URI an authenticator app can import', () => {
    const uri = totpKeyuri('ada@example.com', RFC_SECRET, 'ACME Co');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain('issuer=ACME%20Co');
    // The label carries the account, so two accounts on one issuer stay distinguishable in the app.
    expect(decodeURIComponent(uri)).toContain('ada@example.com');
  });

  it('generates a base32 secret that verifies against itself', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32, no padding
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(checkTotpStep(generateSync({ secret }), secret)).toBe(currentTotpStep());
  });
});
