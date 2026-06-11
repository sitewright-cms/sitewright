import { and, eq, lt } from 'drizzle-orm';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { userPasskeys, webauthnChallenges } from '../db/schema.js';

/** A WebAuthn challenge lives this long between an options request and its verify. */
const CHALLENGE_TTL_MS = 1000 * 60 * 5; // 5 minutes

export type ChallengeType = 'reg' | 'auth';

/** A passkey as shown in the Security tab (no secrets — id/public key are non-secret but omitted). */
export interface PasskeyView {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** The stored fields needed to verify an authentication assertion. */
export interface StoredPasskey {
  userId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
}

/**
 * Credential + challenge storage for passkeys (WebAuthn). Challenges are single-use and short-lived;
 * the row id is an opaque handle returned to the client and presented back at verify (so usernameless
 * authentication, which has no userId yet, still has somewhere to anchor the expected challenge).
 */
export class PasskeyRepository {
  constructor(private readonly db: Database) {}

  // ---- challenges ----

  /** Stores a challenge and returns the opaque handle the client echoes back at verify. */
  async createChallenge(type: ChallengeType, challenge: string, userId: string | null, now: Date = new Date()): Promise<string> {
    // Opportunistically prune expired challenges (the unauthenticated /options route is the growth
    // vector — abandoned flows never reach consume). The expires_at index keeps this cheap.
    await this.db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now));
    const id = newId();
    await this.db.insert(webauthnChallenges).values({ id, userId, challenge, type, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS), createdAt: now });
    return id;
  }

  /**
   * Consumes a challenge (single-use): deletes the row and returns it only if it exists, is the
   * expected type, and is unexpired. Deleting unconditionally also prunes a stale/expired handle.
   */
  async consumeChallenge(handle: string, type: ChallengeType, now: Date = new Date()): Promise<{ userId: string | null; challenge: string } | null> {
    const [row] = await this.db.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, handle));
    if (!row) return null;
    await this.db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, handle));
    if (row.type !== type || row.expiresAt.getTime() <= now.getTime()) return null;
    return { userId: row.userId, challenge: row.challenge };
  }

  // ---- passkeys ----

  async listForUser(userId: string): Promise<PasskeyView[]> {
    return this.db
      .select({ id: userPasskeys.id, name: userPasskeys.name, createdAt: userPasskeys.createdAt, lastUsedAt: userPasskeys.lastUsedAt })
      .from(userPasskeys)
      .where(eq(userPasskeys.userId, userId));
  }

  /** The user's existing credentials, for excludeCredentials / allowCredentials. */
  async credentialsForUser(userId: string): Promise<{ id: string; transports?: string[] }[]> {
    const rows = await this.db.select({ id: userPasskeys.id, transports: userPasskeys.transports }).from(userPasskeys).where(eq(userPasskeys.userId, userId));
    return rows.map((r) => ({ id: r.id, transports: r.transports ?? undefined }));
  }

  async getById(id: string): Promise<StoredPasskey | null> {
    const [row] = await this.db.select().from(userPasskeys).where(eq(userPasskeys.id, id));
    if (!row) return null;
    return { userId: row.userId, publicKey: row.publicKey, counter: row.counter, transports: row.transports ?? undefined };
  }

  async create(
    p: { id: string; userId: string; publicKey: string; counter: number; transports?: string[]; deviceType?: string; backedUp: boolean; name: string },
    now: Date = new Date(),
  ): Promise<void> {
    await this.db.insert(userPasskeys).values({
      id: p.id,
      userId: p.userId,
      publicKey: p.publicKey,
      counter: p.counter,
      transports: p.transports ?? null,
      deviceType: p.deviceType ?? null,
      backedUp: p.backedUp,
      name: p.name,
      createdAt: now,
      lastUsedAt: null,
    });
  }

  /** Advances the signature counter + stamps last-used after a successful authentication. */
  async recordUse(id: string, counter: number, now: Date = new Date()): Promise<void> {
    await this.db.update(userPasskeys).set({ counter, lastUsedAt: now }).where(eq(userPasskeys.id, id));
  }

  /** Renames a passkey the caller owns. False if no such passkey for this user. */
  async rename(userId: string, id: string, name: string): Promise<boolean> {
    const res = await this.db
      .update(userPasskeys)
      .set({ name })
      .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
      .returning({ id: userPasskeys.id });
    return res.length > 0;
  }

  /** Removes a passkey the caller owns. False if no such passkey for this user. */
  async remove(userId: string, id: string): Promise<boolean> {
    const res = await this.db
      .delete(userPasskeys)
      .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
      .returning({ id: userPasskeys.id });
    return res.length > 0;
  }
}
