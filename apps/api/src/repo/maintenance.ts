import { lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { mfaLoginTickets, oidcLoginStates, sessions, webauthnChallenges } from '../db/schema.js';

/**
 * Deletes expired ephemeral auth rows: server sessions, MFA login tickets, WebAuthn challenges, and
 * OIDC login states. Each is already unusable once past its `expiresAt` (the access paths reject
 * expired rows), so this is pure housekeeping — safe to run anytime, and idempotent. Driven by a
 * periodic timer in createApp (so abandoned rows from never-completed flows don't accumulate), but
 * also callable directly.
 */
export async function sweepExpiredAuthRows(db: Database, now: Date = new Date()): Promise<void> {
  // `<=` matches the access-path checks (validateSession / resolveLoginTicket treat expiresAt == now
  // as expired), so the sweep never removes a row those paths would still accept.
  await db.delete(sessions).where(lte(sessions.expiresAt, now));
  await db.delete(mfaLoginTickets).where(lte(mfaLoginTickets.expiresAt, now));
  await db.delete(webauthnChallenges).where(lte(webauthnChallenges.expiresAt, now));
  await db.delete(oidcLoginStates).where(lte(oidcLoginStates.expiresAt, now));
}
