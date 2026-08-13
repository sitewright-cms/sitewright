import { and, eq, isNotNull, lt, lte, notExists, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  apiKeys,
  content,
  mfaLoginTickets,
  oauthAuthCodes,
  oauthClients,
  oauthDeviceCodes,
  oauthRefreshTokens,
  oidcLoginStates,
  projects,
  sessions,
  webauthnChallenges,
} from '../db/schema.js';

/** How long soft-deleted media stays in the Recycle Bin before it is permanently purged. */
export const MEDIA_RECYCLE_RETENTION_DAYS = 90;

/**
 * Deletes expired ephemeral auth rows: server sessions, MFA login tickets, WebAuthn challenges,
 * OIDC login states, and the OAuth grant rows (access keys, refresh tokens, authorization codes,
 * device codes). Each is already unusable once past its `expiresAt` (the access paths reject
 * expired rows), so this is pure housekeeping — safe to run anytime, and idempotent. Driven by a
 * periodic timer in createApp (so abandoned rows from never-completed flows don't accumulate), but
 * also callable directly.
 *
 * ★ WHY THE OAUTH ROWS BELONG HERE. They are not one-per-login — they are one-per-HOUR of every
 * connected agent. An access token lives an hour (ACCESS_TTL_MS) and each refresh writes BOTH a new
 * `api_keys` row and a new `oauth_refresh_tokens` row, so a single agent connected for its full
 * 8-hour session cap leaves ~8 of each behind, permanently. Nothing removed them: they were deleted
 * only when the whole user or project was deleted. Inert rows (every access path rejects them) but
 * unbounded — the same shape of leak as the derived-storage one, in the DB instead of on disk.
 */
export async function sweepExpiredAuthRows(db: Database, now: Date = new Date()): Promise<void> {
  // `<=` matches the access-path checks (validateSession / resolveLoginTicket treat expiresAt == now
  // as expired), so the sweep never removes a row those paths would still accept.
  await db.delete(sessions).where(lte(sessions.expiresAt, now));
  await db.delete(mfaLoginTickets).where(lte(mfaLoginTickets.expiresAt, now));
  await db.delete(webauthnChallenges).where(lte(webauthnChallenges.expiresAt, now));
  await db.delete(oidcLoginStates).where(lte(oidcLoginStates.expiresAt, now));
  // OAuth ACCESS tokens only (`source='oauth'`). A PAT is user-managed and listed in the editor's
  // API Keys screen — an expired one is something its owner should SEE and rotate, not something
  // housekeeping silently erases out from under them.
  await db.delete(apiKeys).where(and(eq(apiKeys.source, 'oauth'), lte(apiKeys.expiresAt, now)));
  // Expired refresh tokens. This cannot weaken reuse-detection: OAuthRepository.refresh clamps each
  // rotated successor to `min(ancestor.expiresAt, instance cap)`, so a successor NEVER outlives the
  // token it came from and a chain expires as a unit — an expired row can't be the ancestor of a
  // live one. Presenting a swept token fails with the same `invalid_grant` the expiry check gives.
  await db.delete(oauthRefreshTokens).where(lte(oauthRefreshTokens.expiresAt, now));
  // Authorization + device codes, expired only. A CONSUMED-but-live row must stay: it is precisely
  // what refuses a replay inside the redemption window (redeemAuthCode checks `consumedAt`).
  await db.delete(oauthAuthCodes).where(lte(oauthAuthCodes.expiresAt, now));
  await db.delete(oauthDeviceCodes).where(lte(oauthDeviceCodes.expiresAt, now));
}

/**
 * How long a dynamically-registered OAuth client survives with nothing referencing it. Generous on
 * purpose: the row is tiny, and the cost of dropping one a client still wanted is a re-registration.
 */
export const OAUTH_CLIENT_RETENTION_DAYS = 30;

/**
 * Deletes RFC 7591 dynamic client registrations that are older than the retention window and have
 * NOTHING pointing at them — no refresh token, no authorization code, no device code.
 *
 * ★ WHY THIS IS NOT COSMETIC. `oauth_clients` had no removal path at all, and registration is open
 * (that is what DCR is): every MCP host that connects registers a row, and a host re-registers
 * whenever it loses its client id. The table is capped at MAX_TOTAL_CLIENTS (10k) as a
 * disk-exhaustion guard, and past that `register()` fails with "client registration is temporarily
 * unavailable" — except nothing ever removed a row, so "temporarily" was permanent: an instance
 * that reached the cap could never accept a new MCP client again. A monotonic counter guarded by a
 * hard ceiling needs an eviction path, or the ceiling is just a deadline.
 *
 * Run AFTER sweepExpiredAuthRows so an expired token can't keep a dead registration alive.
 */
export async function reapUnusedOAuthClients(db: Database, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - OAUTH_CLIENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const unreferenced = (table: typeof oauthRefreshTokens | typeof oauthAuthCodes | typeof oauthDeviceCodes): SQL =>
    notExists(db.select({ one: sql`1` }).from(table).where(eq(table.clientId, oauthClients.id)));
  await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, cutoff),
        unreferenced(oauthRefreshTokens),
        unreferenced(oauthAuthCodes),
        unreferenced(oauthDeviceCodes),
      ),
    );
}

/**
 * Permanently purges media in the Recycle Bin (soft-deleted) that is older than the retention window
 * (default 90 days) — removes both the DB row AND the on-disk binary. Idempotent housekeeping, driven
 * by the same periodic timer as the auth sweep. A binary removal failure is swallowed (a leaked file is
 * GC-able) so one bad asset never blocks purging the rest.
 */
export async function reapDeletedMedia(
  db: Database,
  storage: { remove: (slug: string, id: string) => Promise<void> },
  now: Date = new Date(),
  retentionDays: number = MEDIA_RECYCLE_RETENTION_DAYS,
): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const rows = await db
    .select({ id: content.id, entityId: content.entityId, slug: projects.slug })
    .from(content)
    .innerJoin(projects, eq(content.projectId, projects.id))
    .where(and(eq(content.kind, 'media'), isNotNull(content.deletedAt), lt(content.deletedAt, cutoff)));
  for (const row of rows) {
    await db.delete(content).where(eq(content.id, row.id));
    try {
      await storage.remove(row.slug, row.entityId);
    } catch {
      /* best-effort — a leaked binary is GC-able; keep purging the rest */
    }
  }
}
