import { generateSecret, generateURI, verifySync } from 'otplib';
import { createHash, randomBytes, randomInt } from 'node:crypto';

// TOTP second factor (RFC 6238) on otplib's defaults: 30-second period, 6 digits, SHA-1 — the
// combination every authenticator app assumes, and the one existing enrolments were created with.
//
// A ±1 time-step window absorbs clock skew between the server and the app without materially
// widening the brute-force space (still 6 digits over ~90s; login is rate-limited besides).
//
// ★★ otplib 13 EXPRESSES THAT WINDOW IN SECONDS, where 12 expressed it in STEPS. v12 was
// `authenticator.options = { window: 1 }` — one 30-second step either side. The v13 spelling is
// `epochTolerance`, documented as "time tolerance in SECONDS", so carrying the old literal across
// would have silently narrowed ±30s to ±1s: still a working login for anyone whose clock is exact,
// and a mysterious intermittent failure for everyone else. It is derived from the period here so the
// two can never drift apart.
const TOTP_PERIOD_SECONDS = 30;
const TOTP_TOLERANCE_SECONDS = TOTP_PERIOD_SECONDS;

/** Fallback issuer label (the `<issuer>:` prefix on the account) when no platform name is configured. */
const DEFAULT_ISSUER = 'SiteWright';

/** A fresh base32 TOTP secret — the value the authenticator app stores. */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** The `otpauth://` URI an authenticator app imports (rendered as a QR + shown as text in the editor).
 *  `issuer` is the platform name shown in the app; existing enrolments keep whatever they imported. */
export function totpKeyuri(accountName: string, secret: string, issuer: string = DEFAULT_ISSUER): string {
  return generateURI({ issuer, label: accountName, secret });
}

/** The current TOTP step (floor(epoch / 30s)) — the counter codes are derived from. */
export function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * If `token` is a currently-valid 6-digit code for `secret` (±1 step), returns its ABSOLUTE step
 * (currentStep + matched delta); otherwise null. The step lets the caller reject replays — a code at
 * or below the last accepted step is refused, so an intercepted code can't be reused within its ±90s
 * validity window. A recovery code (non-numeric) returns null and is handled separately. Never throws.
 */
export function checkTotpStep(token: string, secret: string): number | null {
  const cleaned = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;
  try {
    // `delta` is still counted in STEPS (v13: "the offset from the current time step where the token
    // matched"), so the absolute step the caller stores for replay rejection is unchanged.
    const result = verifySync({ token: cleaned, secret, epochTolerance: TOTP_TOLERANCE_SECONDS });
    if (!result.valid) return null;
    return currentTotpStep() + result.delta;
  } catch {
    // otplib throws on a structurally invalid secret/token — treat as a failed check, never a 500.
    return null;
  }
}

// ---- recovery codes ----

const RECOVERY_CODE_COUNT = 10;
// 10 chars from a Crockford-ish alphabet (no 0/O/1/I/L to avoid transcription errors), grouped
// XXXXX-XXXXX for readability. ~32^10 ≈ 2^50 of entropy per code.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A single human-friendly recovery code, e.g. `K7QF2-MN9PX`. */
export function generateRecoveryCode(): string {
  let s = '';
  for (let i = 0; i < 10; i += 1) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** A fresh batch of recovery codes (plaintext — shown to the user exactly once). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

/**
 * SHA-256 of a recovery code, normalized first (upper-case, strip spaces/dashes) so the stored hash
 * is insensitive to how the user types it back. Only the hash is ever persisted.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

// ---- login tickets ----

/** A new login ticket: the raw token (returned to the client once) + its stored id (SHA-256). */
export function generateTicket(): { token: string; id: string } {
  const token = randomBytes(32).toString('hex');
  return { token, id: ticketId(token) };
}

/** The stored id for a raw ticket token (only the hash is persisted, never the token). */
export function ticketId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
