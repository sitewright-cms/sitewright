import { and, eq, isNotNull, lt, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { content, mfaLoginTickets, oidcLoginStates, projects, sessions, webauthnChallenges } from '../db/schema.js';

/** How long soft-deleted media stays in the Recycle Bin before it is permanently purged. */
export const MEDIA_RECYCLE_RETENTION_DAYS = 90;

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
