import { and, count, eq, isNull, lt, or } from 'drizzle-orm';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { mfaLoginTickets, userMfaRecoveryCodes, userMfaTotp } from '../db/schema.js';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import { EncryptionUnavailableError } from './instance-settings.js';
import {
  checkTotpStep,
  generateRecoveryCodes,
  generateTicket,
  generateTotpSecret,
  hashRecoveryCode,
  ticketId,
  totpKeyuri,
} from '../auth/totp.js';

/** A pending login ticket lives this long between the password/passkey step and the TOTP step. */
const TICKET_TTL_MS = 1000 * 60 * 5; // 5 minutes

/** A recoverable MFA error (wrong code, no enrolment in progress) → a 400 at the route. */
export class MfaError extends Error {
  constructor(message = 'mfa error') {
    super(message);
    this.name = 'MfaError';
  }
}

/**
 * Lifecycle for the TOTP second factor: enrolment (secret → confirm), verification (login step 2 +
 * recovery codes), and the short-lived login tickets bridging the two login steps. The secret must
 * be recoverable to verify codes, so it is stored ENCRYPTED at rest (AES-256-GCM via crypto/secret.ts)
 * under the operator's key — without a key, TOTP is unavailable (503), like the instance secrets.
 * Recovery codes and ticket tokens are stored hashed (SHA-256). An in-progress enrolment secret is
 * staged in `pendingSecret` so re-enrolling never tears down the live factor.
 */
export class MfaRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey?: Buffer,
  ) {}

  private requireKey(): Buffer {
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    return this.encryptionKey;
  }

  /** Fresh recovery codes: the insert rows (hashed) plus the plaintext set to show the user once. */
  private buildRecoveryCodes(userId: string): { rows: (typeof userMfaRecoveryCodes.$inferInsert)[]; codes: string[] } {
    const codes = generateRecoveryCodes();
    const now = new Date();
    const rows = codes.map((c) => ({ id: newId(), userId, codeHash: hashRecoveryCode(c), usedAt: null, createdAt: now }));
    return { rows, codes };
  }

  /** Whether the user has a CONFIRMED TOTP factor (this is what gates login). */
  async isTotpEnabled(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ confirmedAt: userMfaTotp.confirmedAt })
      .from(userMfaTotp)
      .where(eq(userMfaTotp.userId, userId));
    return !!row?.confirmedAt;
  }

  /**
   * Begins (or restarts) TOTP enrolment: a fresh secret is generated and STAGED in `pendingSecret`,
   * leaving any live confirmed secret untouched (so re-enrolling never momentarily disables the
   * factor). Returns the secret + otpauth URI for the QR; nothing is enabled until /confirm.
   * `issuer` is the platform name shown in the authenticator app (defaults to the built-in name).
   */
  async beginTotpSetup(userId: string, accountEmail: string, issuer?: string): Promise<{ secret: string; otpauthUri: string }> {
    const key = this.requireKey();
    const secret = generateTotpSecret();
    const enc = encryptSecret(secret, key);
    const [existing] = await this.db.select({ userId: userMfaTotp.userId }).from(userMfaTotp).where(eq(userMfaTotp.userId, userId));
    if (existing) {
      await this.db.update(userMfaTotp).set({ pendingSecret: enc }).where(eq(userMfaTotp.userId, userId));
    } else {
      await this.db.insert(userMfaTotp).values({ userId, secret: null, pendingSecret: enc, lastUsedStep: null, confirmedAt: null, createdAt: new Date() });
    }
    return { secret, otpauthUri: totpKeyuri(accountEmail, secret, issuer) };
  }

  /**
   * Confirms enrolment: verifies a code against the STAGED secret, promotes it to the live secret +
   * marks it confirmed (recording the used step so it can't be replayed), and issues a fresh batch of
   * recovery codes (returned ONCE) — all atomically. Throws {@link MfaError} if there's no pending
   * setup or the code is wrong.
   */
  async confirmTotpSetup(userId: string, code: string): Promise<string[]> {
    const key = this.requireKey();
    const [row] = await this.db.select().from(userMfaTotp).where(eq(userMfaTotp.userId, userId));
    if (!row?.pendingSecret) throw new MfaError('no TOTP setup in progress');
    if (checkTotpStep(code, decryptSecret(row.pendingSecret, key)) === null) {
      throw new MfaError('that code is not valid — try again');
    }
    const pending = row.pendingSecret;
    const { rows, codes } = this.buildRecoveryCodes(userId);
    await this.db.transaction(async (tx) => {
      // Promote the staged secret to live. `lastUsedStep` is left for the first LOGIN to claim, so a
      // user enrolling can immediately sign in elsewhere with the same code (replay protection then
      // applies to every subsequent login).
      await tx
        .update(userMfaTotp)
        .set({ secret: pending, pendingSecret: null, confirmedAt: new Date(), lastUsedStep: null })
        .where(eq(userMfaTotp.userId, userId));
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
      await tx.insert(userMfaRecoveryCodes).values(rows);
    });
    return codes;
  }

  /**
   * Verifies a live TOTP code for a CONFIRMED user (login step 2). Returns false if not enrolled, the
   * code is wrong, OR it is a replay — the used step is claimed atomically (an UPDATE that only
   * advances `lastUsedStep`), so a given code (and its ±90s window) succeeds at most once.
   */
  async verifyTotpCode(userId: string, code: string): Promise<boolean> {
    const key = this.requireKey();
    const [row] = await this.db.select().from(userMfaTotp).where(eq(userMfaTotp.userId, userId));
    if (!row?.confirmedAt || !row.secret) return false;
    const step = checkTotpStep(code, decryptSecret(row.secret, key));
    if (step === null) return false;
    const claimed = await this.db
      .update(userMfaTotp)
      .set({ lastUsedStep: step })
      .where(and(eq(userMfaTotp.userId, userId), or(isNull(userMfaTotp.lastUsedStep), lt(userMfaTotp.lastUsedStep, step))))
      .returning({ userId: userMfaTotp.userId });
    return claimed.length > 0;
  }

  /** Consumes an unused recovery code (single-use, claimed atomically). True iff one matched. */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const hash = hashRecoveryCode(code);
    const claimed = await this.db
      .update(userMfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(userMfaRecoveryCodes.userId, userId),
          eq(userMfaRecoveryCodes.codeHash, hash),
          isNull(userMfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userMfaRecoveryCodes.id });
    return claimed.length > 0;
  }

  /** Replaces all recovery codes with a fresh batch (atomically); returns the plaintext set once. */
  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const { rows, codes } = this.buildRecoveryCodes(userId);
    await this.db.transaction(async (tx) => {
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
      await tx.insert(userMfaRecoveryCodes).values(rows);
    });
    return codes;
  }

  /** How many recovery codes are still unused (0 if TOTP isn't enabled) — surfaced in the Security tab. */
  async remainingRecoveryCodes(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(userMfaRecoveryCodes)
      .where(and(eq(userMfaRecoveryCodes.userId, userId), isNull(userMfaRecoveryCodes.usedAt)));
    return row?.value ?? 0;
  }

  /** Disables TOTP entirely: wipes the secret and all recovery codes atomically (no lockout risk). */
  async disableTotp(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(userMfaTotp).where(eq(userMfaTotp.userId, userId));
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
    });
  }

  // ---- login tickets (bridge password/passkey step → TOTP step) ----

  /** Issues a single-use login ticket for `userId`; returns the raw token (only its hash is stored). */
  async createLoginTicket(userId: string, now: Date = new Date()): Promise<string> {
    const { token, id } = generateTicket();
    await this.db.insert(mfaLoginTickets).values({ id, userId, expiresAt: new Date(now.getTime() + TICKET_TTL_MS), createdAt: now });
    return token;
  }

  /**
   * Resolves a ticket to its userId if it exists and is unexpired — WITHOUT consuming it, so the
   * second factor can be retried (within the TTL + the route's rate limit) after a fat-fingered code.
   * An expired ticket is pruned here and resolves to null.
   */
  async resolveLoginTicket(token: string, now: Date = new Date()): Promise<string | null> {
    const id = ticketId(token);
    const [row] = await this.db.select().from(mfaLoginTickets).where(eq(mfaLoginTickets.id, id));
    if (!row) return null;
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.db.delete(mfaLoginTickets).where(eq(mfaLoginTickets.id, id));
      return null;
    }
    return row.userId;
  }

  /** Consumes (deletes) a ticket once the second factor succeeds — single-use. */
  async consumeLoginTicket(token: string): Promise<void> {
    await this.db.delete(mfaLoginTickets).where(eq(mfaLoginTickets.id, ticketId(token)));
  }
}
