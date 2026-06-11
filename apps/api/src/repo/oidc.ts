import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { oidcIdentities, oidcLoginStates } from '../db/schema.js';

/** A login attempt's state lives this long between the authorize redirect and the callback. */
const STATE_TTL_MS = 1000 * 60 * 10; // 10 minutes

/** The row id is the SHA-256 of the raw state (the raw value round-trips via the IdP). */
function stateId(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/**
 * Storage for the OIDC login flow: single-use `oidc_login_states` (state→nonce/PKCE bridge) and the
 * durable `oidc_identities` link ((issuer, subject)→user). State tokens are stored hashed; the raw
 * value is the CSRF `state` parameter carried via the IdP.
 */
export class OidcRepository {
  constructor(private readonly db: Database) {}

  // ---- login states ----

  /**
   * Persists the per-attempt secrets keyed by the SHA-256 of `state` (the openid-client-generated
   * CSRF state that travels via the IdP and returns in the callback). Also opportunistically prunes
   * expired rows.
   */
  async createLoginState(
    input: { state: string; providerId: string; nonce: string; pkceVerifier: string },
    now: Date = new Date(),
  ): Promise<void> {
    await this.db.delete(oidcLoginStates).where(lt(oidcLoginStates.expiresAt, now));
    await this.db.insert(oidcLoginStates).values({
      id: stateId(input.state),
      providerId: input.providerId,
      nonce: input.nonce,
      pkceVerifier: input.pkceVerifier,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      createdAt: now,
    });
  }

  /**
   * Consumes a login state (single-use): claims it with an atomic DELETE…RETURNING so two concurrent
   * callbacks can't both succeed, then returns it only if it existed, is unexpired, and was issued for
   * the SAME provider (binds the callback to its authorize request).
   */
  async consumeLoginState(
    state: string,
    providerId: string,
    now: Date = new Date(),
  ): Promise<{ nonce: string; pkceVerifier: string } | null> {
    const [row] = await this.db.delete(oidcLoginStates).where(eq(oidcLoginStates.id, stateId(state))).returning();
    if (!row) return null;
    if (row.providerId !== providerId || row.expiresAt.getTime() <= now.getTime()) return null;
    return { nonce: row.nonce, pkceVerifier: row.pkceVerifier };
  }

  // ---- identities ----

  /** The user linked to an external `(issuer, subject)`, or null. */
  async findUserByIdentity(issuer: string, subject: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: oidcIdentities.userId })
      .from(oidcIdentities)
      .where(and(eq(oidcIdentities.issuer, issuer), eq(oidcIdentities.subject, subject)));
    return row?.userId ?? null;
  }

  /** Links `(issuer, subject)` → userId (idempotent); refreshes email + lastLoginAt on re-login. */
  async linkIdentity(
    input: { userId: string; issuer: string; subject: string; email: string | null },
    now: Date = new Date(),
  ): Promise<void> {
    const existing = await this.findUserByIdentity(input.issuer, input.subject);
    if (existing) {
      await this.db
        .update(oidcIdentities)
        .set({ email: input.email, lastLoginAt: now })
        .where(and(eq(oidcIdentities.issuer, input.issuer), eq(oidcIdentities.subject, input.subject)));
      return;
    }
    await this.db.insert(oidcIdentities).values({
      id: newId(),
      userId: input.userId,
      issuer: input.issuer,
      subject: input.subject,
      email: input.email,
      createdAt: now,
      lastLoginAt: now,
    });
  }
}
